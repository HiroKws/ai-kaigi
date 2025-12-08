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
  id: string;
  text: string;
  category: 'idea' | 'problem' | 'solution' | 'action';
}

export interface WhiteboardSection {
  title: string;
  items: string[];
}

export interface WhiteboardData {
  summary: string;
  sections: WhiteboardSection[];
  imageUrl?: string; // Changed from mermaidDiagram to imageUrl
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

export type MeetingMode = 'multi-agent' | 'simulation' | 'offline';

export interface ModeratorResponse {
  nextSpeakerId: string;
  moderationText: string;
}

// Wrapper to generation result including metadata
export interface GenerationResult {
    text: string;
    usedModel: string;
}

// Interface to abstract the logic (Mock vs Real API)
export interface MeetingBackend {
  mode: MeetingMode;
  generateTeam(topic: string, lang: string, files: Attachment[], baseModel: string): Promise<Agent[]>;
  // Returns texts but implementation might handle fallback internally. 
  // For simplicity in batch, we won't return individual models for setup, but we could.
  // Updated to return objects to track model usage per agent if needed, but keeping string[] for simplicity in setup.
  generateOpeningStatements(topic: string, agents: Agent[], lang: string, files: Attachment[], baseModel: string): Promise<GenerationResult[]>;
  
  generateModeratorTurn(topic: string, history: Message[], agents: Agent[], lang: string, files: Attachment[], model?: string, handRaisedAgentIds?: string[]): Promise<ModeratorResponse & { usedModel?: string }>;
  
  generateAgentResponse(agent: Agent, topic: string, history: Message[], allAgents: Agent[], lang: string, files: Attachment[]): Promise<GenerationResult>;
  
  // New method to check reactions
  checkForHandRaises(lastMessage: Message, agents: Agent[], lang: string): Promise<string[]>;
  updateWhiteboard(topic: string, history: Message[], agents: Agent[], lang: string, isDark: boolean): Promise<WhiteboardData>;
  getStats(): UsageStats;
}