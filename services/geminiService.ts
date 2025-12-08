import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Agent, Message, WhiteboardData, MeetingBackend, MeetingMode, ModeratorResponse, Attachment, UsageStats, GenerationResult } from "../types";
import { AGENTS, DEFAULT_MODEL, MODEL_FALLBACK_CHAIN } from "../constants";

// --- CONSTANTS & HELPERS ---
const MODEL_NAME_IMAGE = "gemini-3-pro-image-preview";
// Use Lite model for frequent reaction checks to save quota/cost
const MODEL_NAME_CHECK = "gemini-2.0-flash-lite-preview-02-05"; 

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
                msg.includes('exceeded');
                
            const isOverloaded = msg.includes('503') || msg.includes('overloaded');

            if (isQuota || isOverloaded) {
                const nextModel = MODEL_FALLBACK_CHAIN[currentModel];
                if (nextModel) {
                    console.warn(`[GeminiService] Model ${currentModel} hit limit. Downgrading to ${nextModel}...`);
                    currentModel = nextModel;
                    attempts++;
                    // Small delay before retry
                    await wait(1000);
                    continue; 
                } else {
                    // No more fallbacks available - STOP HERE
                    throw new Error(`[CRITICAL] Model: ${currentModel} reached quota/limit. No lower models available. Meeting paused.`);
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
      parts.push({
        inlineData: {
          mimeType: f.mimeType,
          data: base64Data
        }
      });
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
      return response.text;
  } catch (e: any) {
      // Do NOT increment stats on failure.
      
      // Create a new Error object to ensure the message is updated
      // Accessing .message on some error objects might be read-only
      const originalMessage = e instanceof Error ? e.message : JSON.stringify(e);
      const errorMessage = `[${modelName}] ${originalMessage}`;
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
        initialMessage: `(Offline) Ready to discuss ${topic} from ${a.role} perspective. I believe we need to focus on core values.`
    }));
  }

  async generateOpeningStatements(topic: string, agents: Agent[], lang: string, files: Attachment[], baseModel: string): Promise<GenerationResult[]> {
      await wait(500);
      return agents.map(a => ({
          text: `(Offline) Ready to discuss ${topic} as ${a.name}. Let me explain my detailed view on this matter...`,
          usedModel: 'offline'
      }));
  }

  async generateModeratorTurn(topic: string, history: Message[], agents: Agent[], lang: string, files: Attachment[], model?: string, handRaisedAgentIds?: string[]): Promise<ModeratorResponse & { usedModel: string }> {
    await wait(800);
    
    let nextAgentId = agents[Math.floor(Math.random() * agents.length)].id;
    let text = "Interesting point. Who has a different view?";

    if (handRaisedAgentIds && handRaisedAgentIds.length > 0) {
        nextAgentId = handRaisedAgentIds[0];
        text = `I see you have something to add. Please go ahead.`;
    }

    return {
      nextSpeakerId: nextAgentId,
      moderationText: text,
      usedModel: 'offline'
    };
  }

  async generateAgentResponse(agent: Agent, topic: string, history: Message[], allAgents: Agent[], lang: string, files: Attachment[]): Promise<GenerationResult> {
    await wait(1500);
    return {
        text: `${agent.role} perspective: I think we should consider the scalability of this approach regarding ${topic}.`,
        usedModel: 'offline'
    };
  }
  
  async checkForHandRaises(lastMessage: Message, agents: Agent[], lang: string): Promise<string[]> {
      await wait(500);
      return Math.random() > 0.7 ? [agents[0].id] : [];
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
        1. A "first_statement" for each agent (NOT a greeting, but a deep analytical statement: 3-5 sentences).
        2. A specific "interest" field for each agent. This is a topic, concept, or emotional nuance that this agent is deeply concerned about. If this topic comes up, they will want to speak up.
        
        [OUTPUT]
        JSON format with name, role, systemInstruction, greeting, and interest.
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
                greeting: { type: Type.STRING, description: "A detailed analytical first statement (3-5 sentences) covering problems, inference, and outlook." },
              },
              required: ["name", "role", "systemInstruction", "interest", "greeting"]
            }
          }
        },
        required: ["team"]
      };

      const result = await callGeminiWithFallback(this.ai, prompt, schema, 0.7, files, baseModel);
      const data = JSON.parse(result.text.replace(/```json|```/g, "").trim());
      const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500'];
      
      // CRITICAL UPDATE: Apply the 'usedModel' (potentially downgraded) to the agents.
      // This ensures that subsequent calls (opening statements) use the working model.
      return (data.team || []).map((a: any, i: number) => ({
        id: `agent-${Date.now()}-${i}`,
        name: a.name || `Agent ${i+1}`,
        role: a.role || "Participant",
        systemInstruction: a.systemInstruction || "Helpful assistant.",
        interest: a.interest || "General",
        avatarColor: colors[i % colors.length],
        initialMessage: a.greeting,
        model: result.usedModel // Use the actual model that worked
      }));
    });
  }

  async generateOpeningStatements(topic: string, agents: Agent[], lang: string, files: Attachment[], baseModel: string): Promise<GenerationResult[]> {
    // Parallel generation for multi-agent distinctiveness
    const promises = agents.map(agent => runWithRetry(async () => {
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
        // Use agent.model if set (by generateTeam), otherwise baseModel
        const modelToUse = agent.model || baseModel;
        return await callGeminiWithFallback(this.ai, prompt, undefined, 0.7, files, modelToUse);
    }));

    return Promise.all(promises);
  }

  async generateModeratorTurn(topic: string, history: Message[], agents: Agent[], lang: string, files: Attachment[], model: string = DEFAULT_MODEL, handRaisedAgentIds: string[] = []): Promise<ModeratorResponse & { usedModel: string }> {
    return runWithRetry(async () => {
      const transcript = history.map(m => `${m.agentId}: ${m.text}`).join('\n');
      const agentList = agents.map(a => `${a.id}: ${a.name} (${a.role})`).join('\n');
      
      const handRaisedNames = agents
          .filter(a => handRaisedAgentIds.includes(a.id))
          .map(a => a.name)
          .join(", ");

      const prompt = `
        [META-ROLE]
        You are the "Meeting Simulator Core". You are NOT a participant.
        
        [CONTEXT]
        Topic: "${topic}"
        Language: "${lang}"
        
        [PARTICIPANTS]
        ${agentList}
        
        [TRANSCRIPT]
        ${transcript}
        
        [HAND RAISERS - PRIORITY]
        The following agents have raised their hands eagerly: [${handRaisedNames}].
        If this list is not empty, you MUST choose one of them as the 'nextSpeakerId'.
        
        [OBJECTIVE]
        Analyze the flow. Decide who speaks next.
        If someone raised their hand, acknowledge them (e.g., "I see X wants to speak").
        Provide a neutral moderator bridge sentence.
        
        [OUTPUT JSON]
        { "nextSpeakerId": "...", "moderationText": "..." }
      `;

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

  async generateAgentResponse(agent: Agent, topic: string, history: Message[], allAgents: Agent[], lang: string, files: Attachment[]): Promise<GenerationResult> {
    return runWithRetry(async () => {
      const transcript = history.map(m => {
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
        
        [TRANSCRIPT]
        ${transcript}
        
        [ACTION]
        As ${agent.name}, respond to the discussion. Stay 100% in character.
        If the last message touched on your 'INTEREST', react to it directly.
        
        [LENGTH RULE]
        - General: Be CONCISE (1-2 sentences).
        - Exception: If explaining a complex concept, correcting a major misunderstanding, or your INTEREST was triggered, you may speak longer (3-4 sentences).
      `;

      return await callGeminiWithFallback(this.ai, prompt, undefined, 0.7, files, agent.model || DEFAULT_MODEL);
    });
  }

  async checkForHandRaises(lastMessage: Message, agents: Agent[], lang: string): Promise<string[]> {
      return runWithRetry(async () => {
          if (!lastMessage || agents.length === 0) return [];
          
          // Only check if message is long enough to be substantive
          if (lastMessage.text.length < 20) return [];

          const listeners = agents.filter(a => a.id !== lastMessage.agentId).map(a => ({
              id: a.id,
              name: a.name,
              interest: a.interest || "General"
          }));
          
          const prompt = `
            [TASK]
            Analyze the "Last Message" and determine if it triggers the specific "Interests" of any listeners.
            If a listener's interest is directly touched upon, contradicted, or strongly relevant, they will want to "Raise Hand" to speak.
            
            [LAST MESSAGE]
            "${lastMessage.text}"
            
            [LISTENERS & INTERESTS]
            ${JSON.stringify(listeners)}
            
            [OUTPUT]
            Return a JSON object with a list of IDs for agents who raised their hand.
            Only include agents with a STRONG reason. Empty list is fine.
            
            Format: { "handRaisedIds": ["id1", "id2"] }
          `;
          
          const schema: Schema = {
            type: Type.OBJECT,
            properties: {
                handRaisedIds: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                }
            },
            required: ["handRaisedIds"]
          };
          
          // Use Flash Lite for this check (No fallback for lite, it's the bottom)
          const result = await callGemini(this.ai, prompt, schema, 0.3, [], MODEL_NAME_CHECK); 
          const data = JSON.parse(result.replace(/```json|```/g, "").trim());
          return data.handRaisedIds || [];
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
                  
                  // Use GenerateContent with image config for gemini-3-pro-image-preview
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
                  
                  // Count image stats only on success
                  if (!globalStats.byModel[MODEL_NAME_IMAGE]) globalStats.byModel[MODEL_NAME_IMAGE] = { apiCalls: 0, inputTokens: 0, outputTokens: 0 };
                  globalStats.byModel[MODEL_NAME_IMAGE].apiCalls++;
              }
          } catch (e) {
              console.warn("Failed to generate whiteboard image", e);
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

// --- SIMULATION BACKEND (SINGLE MODEL) ---
export class SimulationBackend extends GeminiBackend {
  mode: MeetingMode = 'simulation'; 

  // Override to use batch generation for speed/consistency in simulation mode
  async generateOpeningStatements(topic: string, agents: Agent[], lang: string, files: Attachment[], baseModel: string): Promise<GenerationResult[]> {
    return runWithRetry(async () => {
        const agentList = agents.map(a => `${a.name} (${a.role}): ${a.systemInstruction}`).join('\n');
        const prompt = `
          [TASK]
          Generate an initial analytical statement for EACH participant.
          Topic: "${topic}"
          Language: "${lang}"
          
          [INSTRUCTION]
          Do NOT write greetings.
          Each statement must be DETAILED (3-6 sentences).
          Each agent must:
          1. Point out specific problems/challenges regarding the topic from your unique perspective.
          2. Show their logical inference and reasoning.
          3. Present a future outlook or prediction.
          
          [PARTICIPANTS]
          ${agentList}
          
          [OUTPUT]
          JSON array of strings, in the exact same order as the participants.
        `;

        const schema: Schema = {
            type: Type.OBJECT,
            properties: {
                statements: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                }
            },
            required: ["statements"]
        };

        const result = await callGeminiWithFallback(this.ai, prompt, schema, 0.7, files, baseModel);
        const data = JSON.parse(result.text.replace(/```json|```/g, "").trim());
        const statements: string[] = data.statements || [];
        
        return statements.map(s => ({ text: s, usedModel: result.usedModel }));
    });
  }
}

export const getMeetingBackend = (mode: MeetingMode): MeetingBackend => {
  if (mode === 'simulation') {
    return new SimulationBackend();
  }
  if (mode === 'offline') {
    return new OfflineBackend();
  }
  return new GeminiBackend();
};