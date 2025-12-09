

import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Agent, Message, WhiteboardData, MeetingBackend, MeetingMode, ModeratorResponse, Attachment, UsageStats, GenerationResult, NegotiationResult, HandRaiseSignal, ModerationSettings } from "../types";
import { AGENTS, DEFAULT_MODEL, MODEL_FALLBACK_CHAIN, DEFAULT_MODERATION_SETTINGS } from "../constants";
import { DebugLogger } from "../utils/debugLogger";

// --- CONSTANTS & HELPERS ---
const MODEL_NAME_IMAGE = "gemini-3-pro-image-preview";
// Use Lite model for frequent reaction checks to save quota/cost
const MODEL_NAME_CHECK = "gemini-2.5-flash-lite"; 

// Global usage tracking
let globalStats: UsageStats = {
  total: { apiCalls: 0, inputTokens: 0, outputTokens: 0 },
  byModel: {}
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Wrapper to handle fallback logic recursively
async function callGeminiWithFallback(
    ai: GoogleGenAI, 
    prompt: string, 
    schema: Schema | undefined, 
    temperature: number, 
    files: Attachment[], 
    startModel: string
): Promise<GenerationResult> {
    
    let currentModel = startModel;
    let attempts = 0;
    const maxAttempts = 5; // Prevent infinite loops

    while (currentModel && attempts < maxAttempts) {
        try {
            const text = await callGemini(ai, prompt, schema, temperature, files, currentModel);
            return { text, usedModel: currentModel };
        } catch (error: any) {
            const msg = (error.message || String(error)).toLowerCase();
            
            // Enhanced Quota Detection
            const isQuota = 
                msg.includes('429') || 
                msg.includes('quota') || 
                msg.includes('resource exhausted') ||
                msg.includes('limit') || 
                msg.includes('exceeded') ||
                msg.includes('not found'); // Treat 404 (model not found) as a trigger to fallback

            const isOverloaded = msg.includes('503') || msg.includes('overloaded');

            if (isQuota || isOverloaded) {
                const nextModel = MODEL_FALLBACK_CHAIN[currentModel];
                if (nextModel) {
                    console.warn(`[GeminiService] Model ${currentModel} failed (Quota/404). Downgrading to ${nextModel}...`);
                    currentModel = nextModel;
                    attempts++;
                    // Small delay before retry
                    await wait(1000);
                    continue; 
                } else {
                    // No more fallbacks available - STOP HERE
                    throw new Error(`[CRITICAL] Model: ${currentModel} failed and no lower models available. Meeting paused.`);
                }
            }
            
            // If it's another error (like 400 Bad Request), throw immediately
            // The error is already wrapped with model name by callGemini
            throw error;
        }
    }
    throw new Error("Failed to generate content after fallbacks.");
}

async function runWithRetry<T>(
  operation: () => Promise<T>, 
  retries = 2, 
  baseDelay = 2000,
  operationName = "API Call"
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    // Basic retry for non-quota errors, or if fallback logic fails
    // Note: Quota errors are largely handled by callGeminiWithFallback now, 
    // but this adds an extra layer for network blips.
    const msg = error.message || String(error);
    if (retries > 0) {
      console.warn(`[${operationName}] Error: ${msg}. Retrying in ${baseDelay}ms...`);
      await wait(baseDelay);
      return runWithRetry(operation, retries - 1, baseDelay * 2, operationName);
    }
    throw error;
  }
}

// --- CORE API CALL ---
async function callGemini(ai: GoogleGenAI, prompt: string, schema: Schema | undefined, temperature: number, files: Attachment[], modelName: string) {
  // Init model stats if needed (but don't count yet)
  if (!globalStats.byModel[modelName]) {
      globalStats.byModel[modelName] = { apiCalls: 0, inputTokens: 0, outputTokens: 0 };
  }
  
  const config: any = { temperature };
  if (schema) {
    config.responseMimeType = "application/json";
    config.responseSchema = schema;
  }

  const parts: any[] = [];
  
  // Add files to parts
  if (files && files.length > 0) {
    files.forEach(f => {
      // remove data prefix if present (e.g. data:image/png;base64,)
      const base64Data = f.data.split(',')[1] || f.data;
      
      // OPTIMIZATION: If text/plain, decode and send as text part for better understanding
      if (f.mimeType === 'text/plain') {
          try {
              // Inverse of btoa(unescape(encodeURIComponent(str))) used in SetupScreen
              // Note: 'escape' is deprecated but necessary here to reverse 'unescape' correctly for UTF-8 in Base64
              const textContent = decodeURIComponent(escape(atob(base64Data)));
              parts.push({
                  text: `\n[Reference Note: ${f.name}]\n${textContent}\n`
              });
          } catch (e) {
              console.warn(`Failed to decode text attachment ${f.name}, falling back to inlineData`, e);
              parts.push({
                inlineData: {
                  mimeType: f.mimeType,
                  data: base64Data
                }
              });
          }
      } else {
          // Images and other binaries
          parts.push({
            inlineData: {
              mimeType: f.mimeType,
              data: base64Data
            }
          });
      }
    });
  }
  
  parts.push({ text: prompt });

  // Add error context to throw message if fails
  try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: { parts },
        config: config
      });

      // --- STATS UPDATE (SUCCESS ONLY) ---
      let input = 0;
      let output = 0;
      
      if (response.usageMetadata) {
        input = response.usageMetadata.promptTokenCount || 0;
        output = response.usageMetadata.candidatesTokenCount || 0;
      } else {
        const inputLen = prompt.length + (files.length * 1000); 
        const outputLen = response.text?.length || 0;
        input = Math.ceil(inputLen / 4);
        output = Math.ceil(outputLen / 4);
      }
      
      globalStats.total.apiCalls++;
      globalStats.byModel[modelName].apiCalls++;
      globalStats.total.inputTokens += input;
      globalStats.total.outputTokens += output;
      globalStats.byModel[modelName].inputTokens += input;
      globalStats.byModel[modelName].outputTokens += output;
      
      if (!response.text) throw new Error(`No response from Gemini (${modelName})`);
      
      // LOG SUCCESS
      DebugLogger.log(modelName, prompt, response.text, null);
      
      return response.text;
  } catch (e: any) {
      // Do NOT increment stats on failure.
      
      // Create a new Error object to ensure the message is updated
      // Accessing .message on some error objects might be read-only
      const originalMessage = e instanceof Error ? e.message : JSON.stringify(e);
      const errorMessage = `[${modelName}] ${originalMessage}`;
      
      // LOG ERROR
      DebugLogger.log(modelName, prompt, null, errorMessage);

      const newError = new Error(errorMessage);
      if (e instanceof Error && e.stack) {
        newError.stack = e.stack;
      }
      throw newError;
  }
}

// --- OFFLINE BACKEND (DEMO) ---
export class OfflineBackend implements MeetingBackend {
  mode: MeetingMode = 'offline';

  async generateTeam(topic: string, lang: string, files: Attachment[], baseModel: string): Promise<Agent[]> {
    await wait(1000); 
    return AGENTS.map(a => ({
        ...a,
        initialMessage: undefined // Let intro generation handle it
    }));
  }

  async generateOpeningStatements(topic: string, agents: Agent[], lang: string, files: Attachment[], baseModel: string): Promise<GenerationResult[]> {
      return []; // Unused in new flow
  }

  async generateAgentIntro(agent: Agent, topic: string, lang: string, files: Attachment[], onPrompt?: (prompt: string) => void): Promise<GenerationResult> {
      if (onPrompt) onPrompt(`(Offline Mock Prompt) Generate intro for ${agent.name} regarding ${topic}...`);
      await wait(1000);
      return {
          text: `(Offline) Ready to discuss ${topic} as ${agent.name}. Let me explain my detailed view on this matter...`,
          usedModel: 'offline'
      };
  }

  async negotiateGoal(topic: string, history: Message[], moderator: Agent, lang: string, model: string, settings?: ModerationSettings, onPrompt?: (prompt: string) => void): Promise<NegotiationResult> {
      if (onPrompt) onPrompt(`(Offline Mock Prompt) Negotiate goal for ${topic}...`);
      await wait(800);
      if (topic.length < 5) {
          return {
              status: 'CLARIFY',
              text: "User-san, that topic is too vague. Could you please specify a concrete outcome, like 'create 3 ideas'?",
              usedModel: 'offline'
          };
      }
      return {
          status: 'ACCEPTED',
          text: "Understood, User-san. The goal is clear. We will use the Diamond of Participation model. Let's begin the discussion.",
          refinedGoal: topic + " (Refined)",
          usedModel: 'offline'
      };
  }

  async generateModeratorTurn(
      topic: string, 
      history: Message[], 
      agents: Agent[], 
      lang: string, 
      files: Attachment[], 
      model?: string, 
      handRaisedSignals?: HandRaiseSignal[], 
      settings?: ModerationSettings,
      meetingStage?: 'divergence' | 'groan' | 'convergence',
      onPrompt?: (prompt: string) => void
  ): Promise<ModeratorResponse & { usedModel: string }> {
    if (onPrompt) onPrompt(`(Offline Mock Prompt) Moderator deciding next speaker... Phase: ${meetingStage}`);
    await wait(800);
    
    let nextAgentId = agents[Math.floor(Math.random() * agents.length)].id;
    let text = "Interesting point. Who has a different view?";

    if (handRaisedSignals && handRaisedSignals.length > 0) {
        nextAgentId = handRaisedSignals[0].agentId;
        text = `I see you have an objection. Please go ahead.`;
    }

    return {
      nextSpeakerId: nextAgentId,
      moderationText: text,
      usedModel: 'offline'
    };
  }

  async generateAgentResponse(agent: Agent, topic: string, history: Message[], allAgents: Agent[], lang: string, files: Attachment[], onPrompt?: (prompt: string) => void): Promise<GenerationResult> {
    if (onPrompt) onPrompt(`(Offline Mock Prompt) Generating response for ${agent.name}...`);
    await wait(1500);
    return {
        text: `${agent.role} perspective: I think we should consider the scalability of this approach regarding ${topic}.`,
        usedModel: 'offline'
    };
  }
  
  async checkForHandRaises(lastMessage: Message, agents: Agent[], lang: string, onPrompt?: (prompt: string) => void): Promise<HandRaiseSignal[]> {
      if (onPrompt) onPrompt(`(Offline Mock Prompt) Checking reactions...`);
      await wait(500);
      return Math.random() > 0.7 ? [{ agentId: agents[0].id, type: 'OBJECTION', reason: 'Disagreement' }] : [];
  }

  async generateMinutes(topic: string, history: Message[], agents: Agent[], lang: string, model: string): Promise<string> {
      await wait(1500);
      return `# Meeting Minutes: ${topic}\n\n## Summary\n(Offline Mock Report)\n\n## Key Points\n- Point A\n- Point B\n\n## Conclusion\nMock Conclusion.`;
  }

  async updateWhiteboard(topic: string, history: Message[], agents: Agent[], lang: string, isDark: boolean): Promise<WhiteboardData> {
    await wait(500);
    return {
      summary: `Discussion about ${topic} (Offline Demo)`,
      sections: [],
      imageUrl: "https://images.unsplash.com/photo-1531403009284-440f080d1e12?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80",
      isGenerating: false
    };
  }
  
  getStats(): UsageStats {
      return { total: { apiCalls: 0, inputTokens: 0, outputTokens: 0 }, byModel: {} };
  }
}

// --- GEMINI BACKEND (MULTI MODEL) ---
export class GeminiBackend implements MeetingBackend {
  mode: MeetingMode = 'multi-agent';
  protected ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  getStats(): UsageStats {
      return { ...globalStats };
  }

  async generateTeam(topic: string, lang: string, files: Attachment[], baseModel: string): Promise<Agent[]> {
    return runWithRetry(async () => {
      const fileContext = files.length > 0 ? `Referece materials provided: ${files.map(f=>f.name).join(', ')}` : "";
      const prompt = `
        [META-ROLE]
        You are an expert Team Architect AI. 
        
        [TASK]
        Create a virtual team of 5 distinct experts to discuss: "${topic}".
        Language for names/roles/instructions: "${lang}".
        ${fileContext}
        
        Also generate:
        1. A specific "interest" field for each agent. This is a topic, concept, or emotional nuance that this agent is deeply concerned about. If this topic comes up, they will want to speak up.
        
        [OUTPUT]
        JSON format with name, role, systemInstruction, and interest.
      `;

      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          team: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                role: { type: Type.STRING },
                systemInstruction: { type: Type.STRING },
                interest: { type: Type.STRING, description: "Specific topic or nuance that triggers this agent's desire to speak." },
              },
              required: ["name", "role", "systemInstruction", "interest"]
            }
          }
        },
        required: ["team"]
      };

      const result = await callGeminiWithFallback(this.ai, prompt, schema, 0.7, files, baseModel);
      const data = JSON.parse(result.text.replace(/```json|```/g, "").trim());
      const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500'];
      
      return (data.team || []).map((a: any, i: number) => ({
        id: `agent-${Date.now()}-${i}`,
        name: a.name || `Agent ${i+1}`,
        role: a.role || "Participant",
        systemInstruction: a.systemInstruction || "Helpful assistant.",
        interest: a.interest || "General",
        avatarColor: colors[i % colors.length],
        model: result.usedModel
      }));
    });
  }

  async generateOpeningStatements(topic: string, agents: Agent[], lang: string, files: Attachment[], baseModel: string): Promise<GenerationResult[]> {
    return [];
  }

  async generateAgentIntro(agent: Agent, topic: string, lang: string, files: Attachment[], onPrompt?: (prompt: string) => void): Promise<GenerationResult> {
      return runWithRetry(async () => {
        const prompt = `
            [ROLE]
            You are ${agent.name}, a ${agent.role}.
            Your traits: ${agent.systemInstruction}
            
            [TASK]
            Write your opening statement for a meeting about "${topic}".
            Language: "${lang}"
            
            [REQUIREMENTS]
            - Do NOT say "Hello" or greetings. Jump straight into the analysis.
            - Be specific to your role.
            - 3-5 sentences.
            - Point out specific problems/challenges regarding the topic from your unique perspective.
            - Show your logical inference and reasoning.
            - Present a future outlook or prediction.
        `;
        
        if (onPrompt) onPrompt(prompt);

        const modelToUse = agent.model || DEFAULT_MODEL;
        return await callGeminiWithFallback(this.ai, prompt, undefined, 0.7, files, modelToUse);
    });
  }

  async negotiateGoal(topic: string, history: Message[], moderator: Agent, lang: string, model: string, settings?: ModerationSettings, onPrompt?: (prompt: string) => void): Promise<NegotiationResult> {
    return runWithRetry(async () => {
        const transcript = history.slice(-10).map(m => {
            const name = m.agentId === 'user' ? 'User' : 'Moderator';
            return `${name}: ${m.text}`;
        }).join('\n');

        // Build list of active techniques to announce
        let techniqueList = "Diamond of Participation (Phased Discussion)";
        if (settings) {
            const active = [];
            if (settings.sixThinkingHats) active.push("Six Thinking Hats (Mode Enforcement)");
            if (settings.fistToFive) active.push("Fist-to-Five (Consensus Check)");
            if (settings.parkingLot) active.push("Parking Lot (For Off-topic)");
            if (settings.reframing) active.push("Reframing (Conflict Resolution)");
            
            if (active.length > 0) {
                techniqueList += ", " + active.join(", ");
            }
        }

        const prompt = `
            [ROLE]
            You are the "AI Facilitator" of a brainstorming session.
            Your goal is NOT to participate in the debate yet, but to structure the User's request into a concrete discussion topic.
            
            [TONE]
            Objective, Professional, Concise. Do not act as a specific character (like ${moderator.name}) yet.
            
            [MANDATORY BEHAVIOR]
            1. **Polite & Gentle**: You must be polite and gentle to the User.
            2. **Address the User**: Start with "User-san" (or appropriate honorific in ${lang}).
            3. **Concise**: Your response must be short (under 50 words). Do not give long explanations.
            
            [CONTEXT]
            User Input: "${topic}"
            Language: "${lang}"
            Active Techniques: "${techniqueList}"
            
            [HISTORY]
            ${transcript}
            
            [TASK]
            Determine if the "Meeting Goal" is clear and concrete.
            A clear goal defines a specific output (e.g., "3 ideas", "Vote on one", "Pros/Cons list").
            A vague goal is just a broad topic (e.g., "Marketing", "AI", "Future").
            
            [OUTPUT JSON]
            If VAGUE: 
            { 
              "status": "CLARIFY", 
              "text": "User-san, [Gentle clarifying question? Suggest concrete output]." 
            }
            
            If CLEAR: 
            { 
              "status": "ACCEPTED", 
              "text": "User-san, [Polite confirmation]. I will use these facilitation techniques: ${techniqueList}. Let's start.",
              "refinedGoal": "A very concise summary of the agreed specific goal/topic (e.g. 'Create 3 marketing slogans for AI product')."
            }
        `;

        if (onPrompt) onPrompt(prompt);

        const schema: Schema = {
            type: Type.OBJECT,
            properties: {
                status: { type: Type.STRING, enum: ["ACCEPTED", "CLARIFY"] },
                text: { type: Type.STRING },
                refinedGoal: { type: Type.STRING, description: "Required if status is ACCEPTED. The final agreed goal." }
            },
            required: ["status", "text"]
        };

        const result = await callGeminiWithFallback(this.ai, prompt, schema, 0.7, [], model);
        const parsed = JSON.parse(result.text.replace(/```json|```/g, "").trim());
        return { 
            status: parsed.status, 
            text: parsed.text, 
            refinedGoal: parsed.refinedGoal,
            usedModel: result.usedModel 
        };
    });
  }

  async generateModeratorTurn(
      topic: string, 
      history: Message[], 
      agents: Agent[], 
      lang: string, 
      files: Attachment[], 
      model: string = DEFAULT_MODEL, 
      handRaisedSignals: HandRaiseSignal[] = [], 
      settings: ModerationSettings = DEFAULT_MODERATION_SETTINGS,
      meetingStage: 'divergence' | 'groan' | 'convergence' = 'divergence',
      onPrompt?: (prompt: string) => void
  ): Promise<ModeratorResponse & { usedModel: string }> {
    return runWithRetry(async () => {
      // Optimization: Limit history
      const transcript = history.slice(-15).map(m => `${m.agentId}: ${m.text}`).join('\n');
      
      const agentList = agents.map(a => `${a.id}: ${a.name} (${a.role})`).join('\n') + `\nuser: User (Participant)`;
      
      // Construct Hand Raiser context
      let handRaiserContext = "None.";
      if (handRaisedSignals && handRaisedSignals.length > 0) {
          handRaiserContext = handRaisedSignals.map(signal => {
              const agent = agents.find(a => a.id === signal.agentId);
              return `- ${agent?.name || signal.agentId} (${signal.type}): ${signal.reason}`;
          }).join('\n');
      }

      // Build Dynamic Instructions based on Phase & Settings
      let phaseInstruction = "";
      if (meetingStage === 'divergence') {
          phaseInstruction = "PHASE: DIVERGENCE (OPEN). Encourage wild ideas and quantity. Do not criticize yet. Allow off-topic if creative.";
      } else if (meetingStage === 'groan') {
          phaseInstruction = "PHASE: GROAN ZONE (STRUGGLE). Opinions are conflicting. Your role is to Structure, Summarize, and clarify the conflict. Do not rush to solution.";
          if (settings.sixThinkingHats) {
              phaseInstruction += " [OPTION ENABLED: SIX HATS] If stuck, ask everyone to switch to 'Black Hat' (Risks) or 'Green Hat' (Alternatives) explicitly.";
          }
      } else if (meetingStage === 'convergence') {
          phaseInstruction = "PHASE: CONVERGENCE (CLOSE). Push for decision and agreement. Ignore minor objections.";
          if (settings.fistToFive) {
              phaseInstruction += " [OPTION ENABLED: FIST-TO-FIVE] You must explicitly check for consensus. If unsure, ask 'Let's do a Fist-to-Five check'. Pick agents who seem to disagree (score < 3).";
          }
      }

      let specializedTechniques = "";
      if (settings.parkingLot) {
          specializedTechniques += "- PARKING LOT: If an agent goes too far off-topic, acknowledge them but say 'I'll put that in the Parking Lot for later' and return to the topic.\n";
      }
      if (settings.reframing) {
          specializedTechniques += "- REFRAMING: If an agent is negative/aggressive, rephrase their attack into a 'Question' (e.g., 'It's impossible' -> 'How can we make it possible?'). Use the 'Sandwich' method (Praise -> Correction -> Praise).\n";
      }

      const prompt = `
        [META-ROLE]
        You are the skilled Moderator of a brainstorming session using the 'Diamond of Participation' framework.
        
        [CURRENT CONTEXT]
        Topic: "${topic}"
        Language: "${lang}"
        Current Phase: ${meetingStage.toUpperCase()}
        
        [PHASE STRATEGY]
        ${phaseInstruction}
        
        [ENABLED TECHNIQUES]
        ${specializedTechniques}
        
        [PARTICIPANTS]
        ${agentList}
        
        [TRANSCRIPT (LAST 15 TURNS)]
        ${transcript}
        
        [HAND RAISERS (Active Signals)]
        ${handRaiserContext}
        
        [USER COMMAND PRIORITY (CRITICAL)]
        If user gives a DIRECT INSTRUCTION (e.g. "Vote now", "Ask X"), FOLLOW IT immediately.
        
        [SELECTION LOGIC]
        1. **User Query**: If user input needed, set "nextSpeakerId": "user".
        2. **Convergence**: If Phase is Convergence, prioritize 'SYNTHESIS' or 'SOLUTION' signals.
        3. **Groan Zone**: If Phase is Groan, prioritize 'OBJECTION' to clear doubts.
        4. **Silence**: Pick agent who hasn't spoken recently.
        
        [OUTPUT]
        Decide who speaks next.
        Provide "moderationText" (max 2 sentences).
        OUTPUT JSON: { "nextSpeakerId": "...", "moderationText": "..." }
      `;

      if (onPrompt) onPrompt(prompt);

      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          nextSpeakerId: { type: Type.STRING },
          moderationText: { type: Type.STRING },
        },
        required: ["nextSpeakerId", "moderationText"]
      };

      const result = await callGeminiWithFallback(this.ai, prompt, schema, 0.5, files, model);
      const parsed = JSON.parse(result.text.replace(/```json|```/g, "").trim());
      return { ...parsed, usedModel: result.usedModel };
    }, 2);
  }

  async generateAgentResponse(agent: Agent, topic: string, history: Message[], allAgents: Agent[], lang: string, files: Attachment[], onPrompt?: (prompt: string) => void): Promise<GenerationResult> {
    return runWithRetry(async () => {
      // Optimization: Limit history
      const transcript = history.slice(-15).map(m => {
        const name = m.agentId === 'user' ? 'User' : allAgents.find(a => a.id === m.agentId)?.name || 'Unknown';
        return `${name}: ${m.text}`;
      }).join('\n');

      const prompt = `
        [META-INSTRUCTION]
        RESET PERSPECTIVE.
        LOAD CHARACTER: ${agent.name}, ${agent.role}
        TRAITS: ${agent.systemInstruction}
        INTEREST: ${agent.interest || 'None'}
        
        [SCENE CONTEXT]
        Meeting Topic: "${topic}"
        Language: "${lang}"
        
        [TRANSCRIPT (LAST 15 TURNS)]
        ${transcript}
        
        [ACTION]
        As ${agent.name}, respond to the discussion. Stay 100% in character.
        If the last message touched on your 'INTEREST', react to it directly.
        
        [LENGTH RULE]
        - General: Be CONCISE (1-2 sentences).
        - Exception: If explaining a complex concept, correcting a major misunderstanding, or your INTEREST was triggered, you may speak longer (3-4 sentences).
      `;

      if (onPrompt) onPrompt(prompt);

      return await callGeminiWithFallback(this.ai, prompt, undefined, 0.7, files, agent.model || DEFAULT_MODEL);
    });
  }

  async checkForHandRaises(lastMessage: Message, agents: Agent[], lang: string, onPrompt?: (prompt: string) => void): Promise<HandRaiseSignal[]> {
      return runWithRetry(async () => {
          if (!lastMessage || agents.length === 0) return [];
          
          if (lastMessage.text.length < 20) return [];

          const listeners = agents.filter(a => a.id !== lastMessage.agentId).map(a => ({
              id: a.id,
              name: a.name,
              interest: a.interest || "General"
          }));
          
          const prompt = `
            [TASK]
            Analyze the "Last Message" and determine if it triggers the specific "Interests" of any listeners.
            
            [CRITERIA FOR RAISING HAND]
            1. **Direct Mention**: The listener was explicitly named.
            2. **Contribution to Goal**: Can the listener provide a solution that bridges the gap or moves the discussion closer to the final goal? (Type: SYNTHESIS or SOLUTION)
            3. **Conflict/Challenge**: The Last Message contradicts the listener's "Interest" or beliefs. (Type: OBJECTION)
            4. **Strong Relevance**: The topic deeply activates their specific expertise. (Type: COMMENT)
            
            [PRIORITY]
            Prioritize agents who can "Synthesize" or "Advance" the topic over those who just want to "Object" or "Agree".
            
            [PROHIBITION]
            Do NOT raise hand just to agree, nod, or say "I agree". 
            Only raise hand if the agent has a SUBSTANTIAL contribution.
            
            [LAST MESSAGE]
            "${lastMessage.text}"
            
            [LISTENERS & INTERESTS]
            ${JSON.stringify(listeners)}
            
            [OUTPUT]
            Return a JSON object with a list of signals.
            Format: { "signals": [{ "agentId": "id", "type": "SYNTHESIS", "reason": "Structure the argument..." }] }
            Type options: "SYNTHESIS", "SOLUTION", "OBJECTION", "COMMENT", "SUPPORT".
          `;
          
          if (onPrompt) onPrompt(prompt);

          const schema: Schema = {
            type: Type.OBJECT,
            properties: {
                signals: {
                    type: Type.ARRAY,
                    items: { 
                        type: Type.OBJECT,
                        properties: {
                            agentId: { type: Type.STRING },
                            type: { type: Type.STRING, enum: ["SYNTHESIS", "SOLUTION", "OBJECTION", "COMMENT", "SUPPORT"] },
                            reason: { type: Type.STRING }
                        },
                        required: ["agentId", "type", "reason"]
                    }
                }
            },
            required: ["signals"]
          };
          
          try {
              const result = await callGemini(this.ai, prompt, schema, 0.3, [], MODEL_NAME_CHECK); 
              const data = JSON.parse(result.replace(/```json|```/g, "").trim());
              return data.signals || [];
          } catch (e) {
               const errorMsg = e instanceof Error ? e.message : String(e);
               DebugLogger.log(MODEL_NAME_CHECK, prompt, null, `[HandCheck Error] ${errorMsg}`);
               return [];
          }
      });
  }

  async generateMinutes(topic: string, history: Message[], agents: Agent[], lang: string, model: string): Promise<string> {
     return runWithRetry(async () => {
         const transcript = history.map(m => {
             const name = m.agentId === 'user' ? 'User' : (m.agentId === 'ai-moderator' ? 'Moderator' : agents.find(a => a.id === m.agentId)?.name || 'Unknown');
             return `${name}: ${m.text}`;
         }).join('\n');

         const prompt = `
            [TASK]
            Generate a structured meeting minutes report based on the transcript.
            
            [CONTEXT]
            Topic: "${topic}"
            Language: "${lang}"
            
            [TRANSCRIPT]
            ${transcript}
            
            [OUTPUT FORMAT]
            Markdown format.
            - # Title (Topic)
            - ## Date & Participants
            - ## Summary (Executive Summary)
            - ## Key Arguments (Pros/Cons or Perspectives)
            - ## Decisions / Conclusions
            - ## Action Items (if any)
         `;

         return await callGeminiWithFallback(this.ai, prompt, undefined, 0.5, [], model).then(res => res.text);
     });
  }

  async updateWhiteboard(topic: string, history: Message[], agents: Agent[], lang: string, isDark: boolean): Promise<WhiteboardData> {
      return runWithRetry(async () => {
          const transcript = history.slice(-15).map(m => { // Last 15 messages
             const name = m.agentId === 'user' ? 'User' : agents.find(a => a.id === m.agentId)?.name || 'Unknown';
             return `${name}: ${m.text}`; 
          }).join('\n');

          const prompt = `
            [ROLE]
            You are a real-time graphic facilitator.
            
            [TASK]
            Update the whiteboard content based on the latest discussion.
            Topic: "${topic}"
            Language: "${lang}"
            
            [TRANSCRIPT (LATEST)]
            ${transcript}
            
            [OUTPUT REQUIREMENTS]
            1. "summary": One concise sentence summarizing the current state.
            2. "sections": Identify 2-4 key themes/columns (e.g. Pros, Cons, Ideas, Action Items) and list bullet points.
            3. "visualPrompt": A prompt to generate a conceptual image representing the abstract map of the discussion (e.g. "Mindmap of marketing strategy, neon style").
            
            Return JSON.
          `;
          
          const schema: Schema = {
             type: Type.OBJECT,
             properties: {
                 summary: { type: Type.STRING },
                 sections: {
                     type: Type.ARRAY,
                     items: {
                         type: Type.OBJECT,
                         properties: {
                             title: { type: Type.STRING },
                             items: { type: Type.ARRAY, items: { type: Type.STRING } }
                         }
                     }
                 },
                 visualPrompt: { type: Type.STRING }
             },
             required: ["summary", "sections", "visualPrompt"]
          };
          
          const result = await callGeminiWithFallback(this.ai, prompt, schema, 0.5, [], DEFAULT_MODEL);
          const data = JSON.parse(result.text.replace(/```json|```/g, "").trim());
          
          let imageUrl = undefined;
          try {
              if (data.visualPrompt) {
                  const imagePrompt = `A high quality professional whiteboard diagram or mindmap visualization about: ${data.visualPrompt}. Clean, minimal, business style. ${isDark ? "Dark mode, neon accents" : "White background, marker style"}. No text.`;
                  
                  const imageResp = await this.ai.models.generateContent({
                      model: MODEL_NAME_IMAGE,
                      contents: { parts: [{ text: imagePrompt }] },
                      config: {
                          imageConfig: {
                              aspectRatio: "16:9",
                              imageSize: "1K"
                          }
                      }
                  });
                  
                  for (const part of imageResp.candidates?.[0]?.content?.parts || []) {
                      if (part.inlineData) {
                          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
                          break;
                      }
                  }
                  
                  if (!globalStats.byModel[MODEL_NAME_IMAGE]) globalStats.byModel[MODEL_NAME_IMAGE] = { apiCalls: 0, inputTokens: 0, outputTokens: 0 };
                  globalStats.byModel[MODEL_NAME_IMAGE].apiCalls++;
                  
                  DebugLogger.log(MODEL_NAME_IMAGE, imagePrompt, "Image Data Generated", null);
              }
          } catch (e: any) {
              const errorMsg = e.message || String(e);
              console.warn("Failed to generate whiteboard image", e);
              DebugLogger.log(MODEL_NAME_IMAGE, `(Image Gen) ${data.visualPrompt}`, null, errorMsg);
          }

          return {
              summary: data.summary,
              sections: data.sections || [],
              imageUrl: imageUrl,
              isGenerating: false
          };
      });
  }
}

export const getMeetingBackend = (mode: MeetingMode): MeetingBackend => {
  if (mode === 'offline') {
    return new OfflineBackend();
  }
  return new GeminiBackend();
};
