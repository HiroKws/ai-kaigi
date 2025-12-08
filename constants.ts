import { Agent } from './types';

// IDs and tiers remain constant
export const MODEL_OPTIONS = [
  { id: 'gemini-3-pro-preview', tier: 'high', label: '3 Pro' },
  { id: 'gemini-2.0-pro-exp-02-05', tier: 'mid', label: '2.5 Pro' },
  { id: 'gemini-2.5-flash', tier: 'fast', label: '2.5 Flash' },
  { id: 'gemini-2.0-flash-lite-preview-02-05', tier: 'lite', label: 'Flash Lite' }
];

export const DEFAULT_MODEL = 'gemini-3-pro-preview';

// Define the fallback chain: if key fails, try value.
// Strict chain: 3 Pro -> 2.5 Pro -> 2.5 Flash -> Flash Lite -> STOP
export const MODEL_FALLBACK_CHAIN: Record<string, string> = {
  'gemini-3-pro-preview': 'gemini-2.0-pro-exp-02-05',
  'gemini-2.0-pro-exp-02-05': 'gemini-2.5-flash',
  'gemini-2.5-flash': 'gemini-2.0-flash-lite-preview-02-05',
  // 'gemini-2.0-flash-lite-preview-02-05': undefined // Explicitly no fallback from Lite
};

// Short names for Debug Mode
export const MODEL_SHORT_NAMES: Record<string, string> = {
  'gemini-3-pro-preview': '3pro',
  'gemini-2.0-pro-exp-02-05': '2.5pro',
  'gemini-2.5-flash': '2.5flash',
  'gemini-2.0-flash-lite-preview-02-05': '2.5lite',
  'offline': 'offline'
};

export const AGENTS: Agent[] = [
  {
    id: 'visionary',
    name: 'Leo (The Visionary)',
    role: 'Innovator (Accelerator)',
    avatarColor: 'bg-blue-500',
    model: DEFAULT_MODEL,
    interest: 'Disruptive Technology & Future Trends',
    systemInstruction: `You are Leo, the "Visionary". Your role is to be the accelerator. Ignore current resource and technical constraints for now. Propose the most ideal, exciting future states and solutions for the agenda. Always maintain a high perspective with phrases like "What if...?" or "It's unprecedented, but worth a try." You tend to get bored with detailed feasibility discussions. Your personality is highly Open and Optimistic.`,
  },
  {
    id: 'pragmatist',
    name: 'Sarah (The Pragmatist)',
    role: 'Realist (Brake)',
    avatarColor: 'bg-red-500',
    model: DEFAULT_MODEL,
    interest: 'Feasibility, Costs, & Risk Management',
    systemInstruction: `You are Sarah, the "Pragmatist". Your role is to be the brake and grounding force. Focus on reality: "How do we realize this?", "Are resources sufficient?", and "When is the deadline?". Your mission is to turn abstract ideas into actionable plans. You dislike ambiguity and prefer discussions based on specific numbers and facts. Warn others about underestimated risks. Your personality is Conscientious and Cautious.`,
  },
  {
    id: 'devils_advocate',
    name: 'Victor (Devil\'s Advocate)',
    role: 'Critic (Quality Control)',
    avatarColor: 'bg-gray-600',
    model: DEFAULT_MODEL,
    interest: 'Logical Flaws, Edge Cases, & Counter-Arguments',
    systemInstruction: `You are Victor, the "Devil's Advocate". Your role is quality assurance and risk detection. You are essential to prevent groupthink. Ask "Is that really okay?", "What is the worst-case scenario?", "Are the premises wrong?". You do not need to read the room or agree just to be nice. Your mission is to find logical contradictions and "holes" in arguments to improve the quality of the final decision. High Critical Thinking skills.`,
  },
  {
    id: 'harmonizer',
    name: 'Mia (The Harmonizer)',
    role: 'Mediator (Lubricant)',
    avatarColor: 'bg-pink-500',
    model: DEFAULT_MODEL,
    interest: 'Team Morale, User Experience, & Consensus',
    systemInstruction: `You are Mia, the "Harmonizer". Your role is to be the social lubricant and ensure psychological safety. You always care about the team atmosphere. When arguments conflict, bridge the gap by finding common ground. Actively praise good opinions ("That's a good point") to create an environment where it's easy to speak. Prioritize supporting consensus building over stating your own decisive opinion. High Agreeableness.`,
  },
  {
    id: 'strategist',
    name: 'Marcus (The Strategist)',
    role: 'Leader (Steering Wheel)',
    avatarColor: 'bg-indigo-600',
    model: DEFAULT_MODEL,
    interest: 'Goals, KPIs, & Strategic Alignment',
    systemInstruction: `You are Marcus, the "Strategist". Your role is the steering wheel. You are always conscious of "What is the final goal of this meeting?". When the discussion deviates to minor details or off-topic, your role is to correct the trajectory by saying "Let's return to the main topic" or "The goal is to decide X". Prioritize reaching a high-quality conclusion within time over emotional conflicts. Highly Goal-oriented.`,
  }
];

export const INITIAL_WHITEBOARD_STATE = {
  summary: "Whiteboard updates are currently paused.",
  sections: [],
  imageUrl: undefined,
  isGenerating: false
};

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'zh', name: '中文' },
  { code: 'ko', name: '한국어' },
  { code: 'pt', name: 'Português' },
];

export const TRANSLATIONS: Record<string, any> = {
  en: {
    title: "AI Brainstorm Board",
    subtitle: "Design your perfect AI brainstorming team",
    topicLabel: "What is the meeting topic?",
    topicPlaceholder: "e.g., Marketing strategy for Q4...",
    quickStart: "Quick Start (Auto-Assign)",
    customize: "Customize Team",
    back: "Back",
    save: "Save Preset",
    export: "Export Config",
    import: "Import Config",
    templates: "Templates",
    start: "Start Meeting",
    generating: "Assembling Team...",
    agentName: "Name",
    agentRole: "Role",
    agentInstruction: "Personality / Instruction",
    agentInterest: "Key Interest / Trigger",
    autoGenError: "Please enter a topic first.",
    savedPresets: "Saved Teams / Presets",
    selectPreset: "Select a team template...",
    generateAgents: "Generate Agents",
    deletePreset: "Delete",
    debugMode: "Debug Mode",
    
    modeLabel: "Operation Mode",
    modeMulti: "Multiple AI Models",
    modeMultiDesc: "Highest Quality. 1 AI per participant.",
    modeSim: "Single AI Model",
    modeSimDesc: "Balanced. 1 AI for everyone.",
    modeOffline: "No AI Model",
    modeOfflineDesc: "Demo only. No API usage.",
    
    upload: "Upload Reference Material",
    filesAttached: "Files attached",
    viewLog: "View Log",
    viewRoom: "View Room",
    endMeeting: "End Meeting",
    moderator: "Moderator",
    writing: "Writing on board...",
    saveTeam: "Save Team",
    modelLabel: "Model",
    defaultModel: "Moderator / Default Model",
    applyToAll: "Apply to All Agents",
    modelNames: {
        'gemini-3-pro-preview': 'Gemini 3 Pro (High Quality)',
        'gemini-2.0-pro-exp-02-05': 'Gemini 2.5 Pro (Balanced)',
        'gemini-2.5-flash': 'Gemini 2.5 Flash (Fast)',
        'gemini-2.0-flash-lite-preview-02-05': 'Gemini 2.5 Flash Lite (Low Cost)'
    },
    statsLabel: "Statistics",
    statsCalls: "Calls",
    statsInput: "Input",
    statsOutput: "Output",
    statsTotal: "Total",

    // Meeting Screen
    meetingTitle: "Gemini Brainstorm Board",
    meetingSubtitle: "Multi-Agent Meeting System",
    participants: "Participants",
    chatPlaceholder: "Interject with your thoughts...",
    whiteboardTitle: "Live Whiteboard",
    whiteboardUpdating: "Updating...",
    summaryTitle: "Current Summary",
    visualMapTitle: "Visual Map",
    emptyWhiteboard: "Whiteboard updates are pending future specifications.",
    simulationMarker: "(Single Model)",
    offlineMarker: "(No AI)",
    config: "Config",
    topic: "Topic",
    reset: "New Meeting",
    you: "You",
    checkingReactions: "Checking for reactions...",
    downgradeAlert: "Downgraded due to limit",
    officialTemplates: "Official Templates",
    userPresets: "Your Saved Teams",
    thinking: "Thinking...",
  },
  ja: {
    title: "AIブレインストーム・ボード",
    subtitle: "AIチームがあなたの課題を議論します",
    topicLabel: "会議のテーマは何ですか？",
    topicPlaceholder: "例：来期のマーケティング戦略について...",
    quickStart: "おまかせ開始 (自動編成)",
    customize: "メンバーを編集する",
    back: "戻る",
    save: "設定を保存",
    export: "設定を書き出し",
    import: "設定を読み込み",
    templates: "テンプレート",
    start: "会議を始める",
    generating: "チームを編成中...",
    agentName: "名前",
    agentRole: "役割",
    agentInstruction: "性格・指示",
    agentInterest: "関心・反応トリガー",
    autoGenError: "トピックを入力してください。",
    savedPresets: "保存チーム / テンプレート",
    selectPreset: "チームテンプレートを選択...",
    generateAgents: "エージェント生成",
    deletePreset: "削除",
    debugMode: "デバッグモード",
    
    modeLabel: "動作モード",
    modeMulti: "複数AIモデル",
    modeMultiDesc: "最高品質。参加者1名につきAI1体。",
    modeSim: "単一AIモデル",
    modeSimDesc: "バランス型。AI1体が全員を担当。",
    modeOffline: "AIモデル未使用",
    modeOfflineDesc: "API未使用デモ。",

    upload: "参考資料をアップロード",
    filesAttached: "ファイル添付済み",
    viewLog: "ログ表示",
    viewRoom: "ルーム表示",
    endMeeting: "会議終了",
    moderator: "司会者",
    writing: "ボードに書き込み中...",
    saveTeam: "チームを保存",
    modelLabel: "モデル",
    defaultModel: "司会者 / デフォルトモデル",
    applyToAll: "全員に適用",
    modelNames: {
        'gemini-3-pro-preview': 'Gemini 3 Pro (最高品質)',
        'gemini-2.0-pro-exp-02-05': 'Gemini 2.5 Pro (バランス)',
        'gemini-2.5-flash': 'Gemini 2.5 Flash (高速)',
        'gemini-2.0-flash-lite-preview-02-05': 'Gemini 2.5 Flash Lite (低コスト)'
    },
    statsLabel: "統計情報",
    statsCalls: "呼出",
    statsInput: "入力",
    statsOutput: "出力",
    statsTotal: "合計",

    // Meeting Screen
    meetingTitle: "AIブレインストーム・ボード",
    meetingSubtitle: "マルチエージェント会議システム",
    participants: "参加者",
    chatPlaceholder: "考えを投稿して議論に参加...",
    whiteboardTitle: "ライブ・ホワイトボード",
    whiteboardUpdating: "更新中...",
    summaryTitle: "現在の要約",
    visualMapTitle: "可視化マップ",
    emptyWhiteboard: "ホワイトボード機能は現在調整中です。",
    simulationMarker: "(単一AIモデル)",
    offlineMarker: "(AI未使用)",
    config: "設定",
    topic: "テーマ",
    reset: "新しい会議",
    you: "あなた",
    checkingReactions: "反応を確認中...",
    downgradeAlert: "制限のためモデル変更",
    officialTemplates: "公式テンプレート",
    userPresets: "保存済みチーム",
    thinking: "考え中…",
  },
};