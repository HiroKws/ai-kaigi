
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Agent, Message, WhiteboardData, MeetingBackend, MeetingMode, ModeratorResponse, Attachment, UsageStats, GenerationResult, NegotiationResult, HandRaiseSignal, ModerationSettings, VoteResult } from "../types";
import { AGENTS, DEFAULT_MODEL, MODEL_FALLBACK_CHAIN, DEFAULT_MODERATION_SETTINGS } from "../constants";
import { DebugLogger } from "../utils/debugLogger";
import { 
    TEAM_GENERATION_PROMPT, 
    AGENT_INTRO_PROMPT, 
    GOAL_NEGOTIATION_PROMPT, 
    MODERATOR_TURN_PROMPT, 
    AGENT_RESPONSE_PROMPT, 
    FIST_TO_FIVE_VOTE_PROMPT, 
    CHECK_HAND_RAISES_PROMPT, 
    GENERATE_MINUTES_PROMPT, 
    UPDATE_WHITEBOARD_PROMPT,
    WHITEBOARD_IMAGE_PROMPT,
    SUMMARIZE_CONVERSATION_PROMPT
} from "../prompts";

// --- CONSTANTS & HELPERS ---
const MODEL_NAME_IMAGE = "gemini-3-pro-image-preview";
// Use Lite model for frequent reaction checks & summarization to save quota/cost
const MODEL_NAME_CHECK = "gemini-2.5-flash-lite"; 
const MODEL_NAME_CHECK_BACKUP = "gemini-2.0-flash-lite-preview-02-05";

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
          usedModel: 'offline',
          emotion: '🤔'
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
      voteResults?: VoteResult[],
      onPrompt?: (prompt: string) => void
  ): Promise<ModeratorResponse & { usedModel: string }> {
    if (onPrompt) onPrompt(`(Offline Mock Prompt) Moderator deciding next speaker... Phase: ${meetingStage}`);
    await wait(800);
    
    // Simulate Fist to Five call
    if (settings?.fistToFive && meetingStage === 'convergence' && !voteResults && Math.random() > 0.5) {
        return {
            nextSpeakerId: 'ai-moderator',
            moderationText: "We seem to be converging. Let's do a Fist-to-Five check on this proposal.",
            voteProposal: "Adopt the current plan for " + topic,
            usedModel: 'offline'
        };
    }

    if (voteResults) {
        return {
            nextSpeakerId: voteResults[0].agentId,
            moderationText: "Thanks for voting. I see some low scores. Let's hear your concerns.",
            usedModel: 'offline'
        }
    }

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
        usedModel: 'offline',
        emotion: ['🤔', '😄', '😐', '😤'][Math.floor(Math.random() * 4)]
    };
  }

  async generateFistToFiveVote(agent: Agent, proposal: string, topic: string, history: Message[], lang: string, files: Attachment[], onPrompt?: (prompt: string) => void): Promise<VoteResult & { usedModel: string }> {
      await wait(500);
      return {
          agentId: agent.id,
          score: Math.floor(Math.random() * 6),
          reason: "Offline mock vote reason.",
          usedModel: 'offline'
      };
  }
  
  async checkForHandRaises(lastMessage: Message, agents: Agent[], lang: string, topic: string, onPrompt?: (prompt: string) => void): Promise<HandRaiseSignal[]> {
      if (onPrompt) onPrompt(`(Offline Mock Prompt) Checking reactions... Topic: ${topic}`);
      await wait(500);
      return Math.random() > 0.7 ? [{ agentId: agents[0].id, type: 'OBJECTION', reason: 'Disagreement' }] : [];
  }

  async generateMinutes(topic: string, history: Message[], agents: Agent[], lang: string, model: string): Promise<string> {
      await wait(1500);
      return `# Meeting Minutes: ${topic}\n\n## Summary\n(Offline Mock Report)\n\n## Key Points\n- Point A\n- Point B\n\n## Conclusion\nMock Conclusion.`;
  }

  async updateWhiteboard(topic: string, history: Message[], agents: Agent[], lang: string, currentData: WhiteboardData): Promise<WhiteboardData> {
    await wait(500);
    // Return dummy structure for offline
    return {
      sections: [{ title: "Ideas", items: [{ text: "Offline Idea 1", type: "idea" }] }],
      parkingLot: [],
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
  
  // State for Summarization Layer (Advice 3.1)
  private conversationSummary: string = "";
  private summarizedCount: number = 0;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  getStats(): UsageStats {
      return { ...globalStats };
  }

  // Helper: Prepare Transcript with Dynamic Summary
  // Advice 3.1: "Introduce a Summary Agent layer"
  private async getTranscriptWithSummary(history: Message[], topic: string, lang: string): Promise<string> {
      // Detect reset
      if (history.length < this.summarizedCount) {
          this.conversationSummary = "";
          this.summarizedCount = 0;
      }

      const KEEP_RECENT = 10;
      const unsummarizedCount = history.length - this.summarizedCount;

      // If we have enough new messages to warrant a summary update (e.g. > 15 pending, keep last 10 raw)
      if (unsummarizedCount > 15) {
          const messagesToSummarize = history.slice(this.summarizedCount, history.length - KEEP_RECENT);
          
          if (messagesToSummarize.length > 0) {
              const textChunk = messagesToSummarize.map(m => `${m.agentId}: ${m.text}`).join('\n');
              
              try {
                  const prompt = SUMMARIZE_CONVERSATION_PROMPT(topic, lang, textChunk, this.conversationSummary);
                  // Use light model for summarization
                  const result = await callGemini(this.ai, prompt, undefined, 0.3, [], MODEL_NAME_CHECK);
                  this.conversationSummary = result;
                  this.summarizedCount += messagesToSummarize.length;
                  DebugLogger.log(MODEL_NAME_CHECK, "Summarization Triggered", result, null);
              } catch (e) {
                  console.warn("Summarization failed with primary model, falling back to backup model", e);
                  try {
                      const prompt = SUMMARIZE_CONVERSATION_PROMPT(topic, lang, textChunk, this.conversationSummary);
                      const result = await callGemini(this.ai, prompt, undefined, 0.3, [], MODEL_NAME_CHECK_BACKUP);
                      this.conversationSummary = result;
                      this.summarizedCount += messagesToSummarize.length;
                      DebugLogger.log(MODEL_NAME_CHECK_BACKUP, "Summarization Triggered (Backup)", result, null);
                  } catch (e2) {
                      console.warn("Summarization backup failed, falling back to raw history", e2);
                  }
              }
          }
      }

      // Construct final transcript: Summary + Recent Messages
      const recentMessages = history.slice(this.summarizedCount);
      const recentTranscript = recentMessages.map(m => `${m.agentId}: ${m.text}`).join('\n');

      if (this.conversationSummary) {
          return `[PREVIOUS_SUMMARY]\n${this.conversationSummary}\n\n[RECENT_TRANSCRIPT]\n${recentTranscript}`;
      } else {
          return recentTranscript;
      }
  }

  async generateTeam(topic: string, lang: string, files: Attachment[], baseModel: string): Promise<Agent[]> {
    return runWithRetry(async () => {
      const fileContext = files.length > 0 ? `Referece materials provided: ${files.map(f=>f.name).join(', ')}` : "";
      const prompt = TEAM_GENERATION_PROMPT(topic, lang, fileContext);

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
        const prompt = AGENT_INTRO_PROMPT(agent, topic, lang);
        
        if (onPrompt) onPrompt(prompt);

        const modelToUse = agent.model || DEFAULT_MODEL;
        // Basic intro usually doesn't need complex emotion parsing for now, or use simple
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
            if (settings.sixThinkingHats) active.push("Six Thinking Hats (FULL CONTROL MODE: Moderator dictates Hat colors)");
            if (settings.fistToFive) active.push("Fist-to-Five (Voting for Consensus)");
            if (settings.parkingLot) active.push("Parking Lot (For Off-topic)");
            if (settings.reframing) active.push("Reframing (Conflict Resolution)");
            
            if (active.length > 0) {
                techniqueList += ", " + active.join(", ");
            }
        }

        const prompt = GOAL_NEGOTIATION_PROMPT(topic, lang, techniqueList, transcript, moderator.name);

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
      voteResults: VoteResult[] = [],
      onPrompt?: (prompt: string) => void
  ): Promise<ModeratorResponse & { usedModel: string }> {
    return runWithRetry(async () => {
      // Use summarized transcript logic
      const transcript = await this.getTranscriptWithSummary(history, topic, lang);
      
      // Construct Hand Raiser context
      let handRaiserContext = "None.";
      if (handRaisedSignals && handRaisedSignals.length > 0) {
          handRaiserContext = handRaisedSignals.map(signal => {
              const agent = agents.find(a => a.id === signal.agentId);
              return `- ${agent?.name || signal.agentId} (${signal.type}): ${signal.reason}`;
          }).join('\n');
      }

      // Vote Analysis Logic (Post-Vote) - STRICT LOGIC IMPLEMENTATION
      let voteAnalysisInstruction = "";
      if (voteResults && voteResults.length > 0) {
          const resultsStr = voteResults.map(v => {
              const agentName = agents.find(a => a.id === v.agentId)?.name || v.agentId;
              // Remove reason text from prompt to ensure moderator relies only on scores
              return `${agentName}: Score ${v.score}`;
          }).join("\n");
          
          voteAnalysisInstruction = `
            [PROTOCOL: FIST-TO-FIVE CONSENSUS CHECK]
            VOTE RESULTS:
            ${resultsStr}

            ## LOGIC FLOW (STRICTLY FOLLOW)
            CASE A: ALL scores are 3 or higher.
            -> ACTION: Declare "Consensus Reached (Disagree and Commit)". Summarize the decision and move to next topic or wrap up.
            
            CASE B: ANY score is 2 or lower.
            -> ACTION: Consensus FAILED. Do NOT use majority vote. Do NOT calculate averages.
            -> NEXT SPEAKER: Select the agent with the LOWEST score (0, 1, or 2).
            -> MODERATION TEXT: "We do not have consensus yet. [Agent Name], you voted [Score]. What specific condition or change is needed for you to move to a '3' (Consent)?"
               (Focus on "Killer Question": ask for specific conditions to change their vote).
          `;
      }

      // Build Dynamic Instructions based on Phase & Settings
      let phaseInstruction = "";
      
      if (settings.sixThinkingHats) {
          // SIX HATS LOGIC (OVERRIDES STANDARD PHASES)
          phaseInstruction = `
            [SIX THINKING HATS MODE ENABLED]
            You are controlling the meeting using the Six Thinking Hats method.
            You must explicitly define which "Hat" the team is wearing for this phase.
            
            Sequence Guide:
            1. White Hat (Facts & Info) - Start here.
            2. Green Hat (Creativity & Alternatives) - Divergence.
            3. Yellow Hat (Benefits) - Evaluation.
            4. Black Hat (Cautions) - Evaluation.
            5. Red Hat (Feelings) - Check-in.
            6. Blue Hat (Process) - Summary & Next Steps.
            
            Current Phase Recommendation based on history:
            - If early, focus on White or Green.
            - If middle, focus on Yellow or Black.
            - If late/stuck, use Red or Blue.
            
            INSTRUCTION:
            - In your \`moderationText\`, explicitly state: "Let's put on the [Color] Hat. [Instruction for that hat]."
            - Select the \`nextSpeakerId\` who can best contribute to the CURRENT Hat color.
          `;
      } else {
          // STANDARD DIAMOND MODEL
          if (meetingStage === 'divergence') {
              phaseInstruction = "PHASE: DIVERGENCE (OPEN). Encourage BROAD ideas, but enforce GOAL RELEVANCE. If ideas are abstract, ask 'How does this solve the [TOPIC]?'.";
          } else if (meetingStage === 'groan') {
              phaseInstruction = "PHASE: GROAN ZONE (STRUGGLE). Identify conflicts and gaps. Do NOT just summarize; point out 'This idea lacks evidence' or 'These two views contradict'.";
          } else if (meetingStage === 'convergence') {
              phaseInstruction = "PHASE: CONVERGENCE (CLOSE). Aggressively filter ideas. Discard abstract ones. Push for a final decision on [TOPIC].";
              
              // Only suggest vote if enabled AND not currently analyzing a previous vote
              if (settings.fistToFive && !voteAnalysisInstruction) {
                  phaseInstruction += `
                    [OPTION ENABLED: FIST-TO-FIVE] 
                    You should explicitly check for consensus using the "Fist-to-Five" method.
                    IF the discussion seems ripe for a decision OR you want to see where everyone stands:
                    1. SUMMARIZE the specific proposal clearly.
                    2. CALL FOR A VOTE.
                    3. OUTPUT \`voteProposal\` field with the proposal text.
                    4. Set \`moderationText\` to "Let's check consensus on [Proposal]. Fist-to-five. Ready... Go!".
                    This will trigger a system event where all agents vote simultaneously.
                  `;
              }
          }
      }

      let specializedTechniques = "";
      if (settings.parkingLot) {
          specializedTechniques += "- PARKING LOT: If an agent goes off-topic (e.g. general philosophy instead of specific solution), immediately say 'I'll put that in the Parking Lot' and return to [TOPIC].\n";
      }
      if (settings.reframing) {
          specializedTechniques += "- REFRAMING: If an agent is negative/aggressive, rephrase their attack into a 'Question' (e.g., 'It's impossible' -> 'How can we make it possible?'). Use the 'Sandwich' method (Praise -> Correction -> Praise).\n";
      }

      const prompt = MODERATOR_TURN_PROMPT(
          topic, 
          lang, 
          meetingStage, 
          phaseInstruction, 
          specializedTechniques, 
          transcript, 
          handRaiserContext, 
          voteAnalysisInstruction
      );

      if (onPrompt) onPrompt(prompt);

      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          thought_process: { type: Type.STRING, description: "Internal reasoning about the conversation flow." },
          nextSpeakerId: { type: Type.STRING },
          moderationText: { type: Type.STRING },
          voteProposal: { type: Type.STRING, description: "The specific proposal to vote on. Only used when initiating Fist-to-Five." }
        },
        required: ["thought_process", "nextSpeakerId", "moderationText"]
      };

      const result = await callGeminiWithFallback(this.ai, prompt, schema, 0.5, files, model);
      const parsed = JSON.parse(result.text.replace(/```json|```/g, "").trim());
      return { ...parsed, usedModel: result.usedModel };
    }, 2);
  }

  async generateAgentResponse(agent: Agent, topic: string, history: Message[], allAgents: Agent[], lang: string, files: Attachment[], onPrompt?: (prompt: string) => void): Promise<GenerationResult> {
    return runWithRetry(async () => {
      // Use summarized transcript logic
      const transcript = await this.getTranscriptWithSummary(history, topic, lang);

      const prompt = AGENT_RESPONSE_PROMPT(agent, topic, lang, transcript);

      if (onPrompt) onPrompt(prompt);

      // Define Schema for structured output (Text + Emotion)
      const schema: Schema = {
          type: Type.OBJECT,
          properties: {
              text: { type: Type.STRING },
              emotion: { type: Type.STRING, description: "A single emoji representing facial expression." }
          },
          required: ["text", "emotion"]
      };

      const result = await callGeminiWithFallback(this.ai, prompt, schema, 0.7, files, agent.model || DEFAULT_MODEL);
      const parsed = JSON.parse(result.text.replace(/```json|```/g, "").trim());
      
      return {
          text: parsed.text,
          emotion: parsed.emotion,
          usedModel: result.usedModel
      };
    });
  }

  async generateFistToFiveVote(agent: Agent, proposal: string, topic: string, history: Message[], lang: string, files: Attachment[], onPrompt?: (prompt: string) => void): Promise<VoteResult & { usedModel: string }> {
      return runWithRetry(async () => {
          // Now passing 'lang' correctly to the prompt
          const prompt = FIST_TO_FIVE_VOTE_PROMPT(agent, proposal, topic, lang);
          
          if (onPrompt) onPrompt(prompt);

          const schema: Schema = {
              type: Type.OBJECT,
              properties: {
                  score: { type: Type.INTEGER, minimum: 0, maximum: 5 },
                  reason: { type: Type.STRING }
              },
              required: ["score", "reason"]
          };

          const modelToUse = agent.model || DEFAULT_MODEL;
          const result = await callGeminiWithFallback(this.ai, prompt, schema, 0.3, files, modelToUse);
          const data = JSON.parse(result.text.replace(/```json|```/g, "").trim());
          
          return {
              agentId: agent.id,
              score: data.score,
              reason: data.reason,
              usedModel: result.usedModel
          };
      });
  }

  async checkForHandRaises(lastMessage: Message, agents: Agent[], lang: string, topic: string, onPrompt?: (prompt: string) => void): Promise<HandRaiseSignal[]> {
      return runWithRetry(async () => {
          if (!lastMessage || agents.length === 0) return [];
          
          if (lastMessage.text.length < 20) return [];

          const listeners = agents.filter(a => a.id !== lastMessage.agentId).map(a => ({
              id: a.id,
              name: a.name,
              interest: a.interest || "General"
          }));
          const listenersJson = JSON.stringify(listeners);
          
          // Now passing 'lang' correctly to the prompt
          const prompt = CHECK_HAND_RAISES_PROMPT(topic, lastMessage.text, listenersJson, lang);
          
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
          
          const executeCheck = async (model: string) => {
              const res = await callGemini(this.ai, prompt, schema, 0.3, [], model); 
              const data = JSON.parse(res.replace(/```json|```/g, "").trim());
              return data.signals || [];
          };

          try {
              return await executeCheck(MODEL_NAME_CHECK);
          } catch (e) {
               console.warn(`[HandCheck] Primary model failed, trying backup (${MODEL_NAME_CHECK_BACKUP})...`);
               try {
                   return await executeCheck(MODEL_NAME_CHECK_BACKUP);
               } catch (e2) {
                   const errorMsg = e2 instanceof Error ? e2.message : String(e2);
                   DebugLogger.log(MODEL_NAME_CHECK_BACKUP, prompt, null, `[HandCheck Backup Error] ${errorMsg}`);
                   return [];
               }
          }
      });
  }

  async generateMinutes(topic: string, history: Message[], agents: Agent[], lang: string, model: string): Promise<string> {
     return runWithRetry(async () => {
         const transcript = history.map(m => {
             const name = m.agentId === 'user' ? 'User' : (m.agentId === 'ai-moderator' ? 'Moderator' : agents.find(a => a.id === m.agentId)?.name || 'Unknown');
             return `${name}: ${m.text}`;
         }).join('\n');

         const prompt = GENERATE_MINUTES_PROMPT(topic, lang, transcript);

         return await callGeminiWithFallback(this.ai, prompt, undefined, 0.5, [], model).then(res => res.text);
     });
  }

  async updateWhiteboard(topic: string, history: Message[], agents: Agent[], lang: string, currentData: WhiteboardData): Promise<WhiteboardData> {
      return runWithRetry(async () => {
          const transcript = history.slice(-15).map(m => { // Last 15 messages
             const name = m.agentId === 'user' ? 'User' : agents.find(a => a.id === m.agentId)?.name || 'Unknown';
             return `${name}: ${m.text}`; 
          }).join('\n');

          const prompt = UPDATE_WHITEBOARD_PROMPT(topic, lang, transcript, JSON.stringify(currentData));
          
          const schema: Schema = {
             type: Type.OBJECT,
             properties: {
                 sections: {
                     type: Type.ARRAY,
                     items: {
                         type: Type.OBJECT,
                         properties: {
                             title: { type: Type.STRING },
                             items: { 
                                 type: Type.ARRAY, 
                                 items: { 
                                     type: Type.OBJECT,
                                     properties: {
                                         text: { type: Type.STRING },
                                         type: { type: Type.STRING, enum: ['info', 'idea', 'concern', 'decision'] }
                                     },
                                     required: ["text", "type"]
                                 } 
                             }
                         },
                         required: ["title", "items"]
                     }
                 },
                 parkingLot: {
                     type: Type.ARRAY,
                     items: { type: Type.STRING }
                 }
             },
             required: ["sections", "parkingLot"]
          };
          
          const result = await callGeminiWithFallback(this.ai, prompt, schema, 0.5, [], DEFAULT_MODEL);
          const data = JSON.parse(result.text.replace(/```json|```/g, "").trim());
          
          // No image generation here as per prompt strategy

          return {
              sections: data.sections || [],
              parkingLot: data.parkingLot || [],
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
