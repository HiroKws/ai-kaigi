
export interface Attachment {
  name: string;
  mimeType: string;
  data: string; // base64
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  avatarColor: string;
  systemInstruction: string;
  interest?: string; // New field: Specific area of interest that triggers reaction
  currentEmotion?: string; // NEW: Current facial expression (emoji)
  initialMessage?: string; // Pre-generated opening statement
  initialMessageModel?: string; // The specific model that generated the initial message
  model?: string; // Specific Gemini model ID for this agent
}

export interface Message {
  id: string;
  agentId: string; // 'user', 'ai-moderator', or agent.id
  text: string;
  timestamp: number;
}

export interface WhiteboardItem {
  text: string;
  type: 'info' | 'idea' | 'concern' | 'decision';
}

export interface WhiteboardSection {
  title: string;
  items: WhiteboardItem[];
}

export interface WhiteboardData {
  sections: WhiteboardSection[];
  parkingLot: string[];
  isGenerating?: boolean;
}

export interface TeamTemplate {
  id: string;
  name: string;
  agents: Agent[];
}

export interface SavedConfig {
  id: string;
  name: string;
  agents: Agent[];
  updatedAt: number;
}

export interface ModelUsage {
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageStats {
  total: ModelUsage;
  byModel: Record<string, ModelUsage>;
}

export type MeetingMode = 'multi-agent' | 'offline';

export type HatColor = 'White' | 'Red' | 'Black' | 'Yellow' | 'Green' | 'Blue' | null;

export interface ModeratorResponse {
  nextSpeakerId: string;
  moderationText: string;
  // If present, triggers the voting phase with this proposal
  voteProposal?: string;
  // If Six Hats is active, this defines the GLOBAL hat for the team
  currentHat?: HatColor;
}

// Wrapper to generation result including metadata
export interface GenerationResult {
    text: string;
    emotion?: string; // NEW: Extracted emotion emoji
    usedModel: string;
}

export interface VoteResult {
    agentId: string;
    score: number; // 0-5
    reason: string;
}

export interface NegotiationResult {
    status: 'ACCEPTED' | 'CLARIFY';
    text: string;
    refinedGoal?: string; // The concrete goal extracted from the conversation
    usedModel: string;
}

export interface HandRaiseSignal {
    agentId: string;
    type: 'OBJECTION' | 'SUPPORT' | 'COMMENT' | 'SYNTHESIS' | 'SOLUTION';
    reason: string;
}

export interface ModerationSettings {
  sixThinkingHats: boolean; // Thinking Mode Enforcement
  fistToFive: boolean;      // Consensus Check
  parkingLot: boolean;      // Off-topic Management
  reframing: boolean;       // Sandwich Intervention & Reframing
}

// Interface to abstract the logic (Mock vs Real API)
export interface MeetingBackend {
  mode: MeetingMode;
  generateTeam(topic: string, lang: string, files: Attachment[], baseModel: string): Promise<Agent[]>;
  // Deprecated for pre-gen, but kept for interface compatibility if needed, or we can use it for batch
  generateOpeningStatements(topic: string, agents: Agent[], lang: string, files: Attachment[], baseModel: string): Promise<GenerationResult[]>;
  
  // New method for on-the-fly intro generation
  generateAgentIntro(agent: Agent, topic: string, lang: string, files: Attachment[], onPrompt?: (prompt: string) => void): Promise<GenerationResult>;

  // New method for Goal Negotiation - Now accepts settings to announce them
  negotiateGoal(topic: string, history: Message[], moderator: Agent, lang: string, model: string, settings?: ModerationSettings, onPrompt?: (prompt: string) => void): Promise<NegotiationResult>;

  // Updated to accept HandRaiseSignal[] and ModerationSettings
  generateModeratorTurn(
      topic: string, 
      history: Message[], 
      agents: Agent[], 
      lang: string, 
      files: Attachment[], 
      model?: string, 
      handRaisedSignals?: HandRaiseSignal[], 
      settings?: ModerationSettings, 
      meetingStage?: 'divergence' | 'groan' | 'convergence',
      voteResults?: VoteResult[], // Pass previous vote results for analysis
      currentHat?: HatColor, // Pass current hat state
      onPrompt?: (prompt: string) => void
  ): Promise<ModeratorResponse & { usedModel?: string }>;
  
  generateAgentResponse(
      agent: Agent, 
      topic: string, 
      history: Message[], 
      allAgents: Agent[], 
      lang: string, 
      files: Attachment[], 
      currentHat?: HatColor, // Pass current hat constraint
      onPrompt?: (prompt: string) => void
  ): Promise<GenerationResult>;
  
  // New method specifically for Fist-to-Five voting
  generateFistToFiveVote(agent: Agent, proposal: string, topic: string, history: Message[], lang: string, files: Attachment[], onPrompt?: (prompt: string) => void): Promise<VoteResult & { usedModel: string }>;

  // New method to check reactions - Returns structured signals now
  checkForHandRaises(lastMessage: Message, agents: Agent[], lang: string, topic: string, onPrompt?: (prompt: string) => void): Promise<HandRaiseSignal[]>;
  
  // New method to generate meeting minutes
  generateMinutes(topic: string, history: Message[], agents: Agent[], lang: string, model: string): Promise<string>;

  // Updated to accept current state for incremental updates
  updateWhiteboard(topic: string, history: Message[], agents: Agent[], lang: string, currentData: WhiteboardData): Promise<WhiteboardData>;
  getStats(): UsageStats;
}
