
import { Agent, ModerationSettings } from './types';

// IDs and tiers remain constant
export const MODEL_OPTIONS = [
  { id: 'gemini-3-pro-preview', tier: 'high', label: '3 Pro' },
  { id: 'gemini-2.5-pro', tier: 'mid', label: '2.5 Pro' },
  { id: 'gemini-2.5-flash', tier: 'fast', label: '2.5 Flash' },
  { id: 'gemini-2.5-flash-lite', tier: 'lite', label: 'Flash Lite' }
];

export const DEFAULT_MODEL = 'gemini-3-pro-preview';

// Define the fallback chain: if key fails, try value.
// Strict chain: 3 Pro -> 2.5 Pro -> 2.5 Flash -> Flash Lite -> STOP
export const MODEL_FALLBACK_CHAIN: Record<string, string> = {
  'gemini-3-pro-preview': 'gemini-2.5-pro',
  'gemini-2.5-pro': 'gemini-2.5-flash',
  'gemini-2.5-flash': 'gemini-2.5-flash-lite',
  // 'gemini-2.5-flash-lite': undefined // Explicitly no fallback from Lite
};

// Short names for Debug Mode
export const MODEL_SHORT_NAMES: Record<string, string> = {
  'gemini-3-pro-preview': '3pro',
  'gemini-2.5-pro': '2.5pro',
  'gemini-2.5-flash': '2.5flash',
  'gemini-2.5-flash-lite': 'lite',
  'offline': 'offline'
};

// All options ON by default as requested
export const DEFAULT_MODERATION_SETTINGS: ModerationSettings = {
    sixThinkingHats: true,
    fistToFive: true,
    parkingLot: true, 
    reframing: true,  
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
    topicLabel: "What is the meeting goal/topic?",
    topicPlaceholder: "e.g., Create 3 marketing strategies for Q4...",
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
    debugModeDesc: "Append used model name to messages",
    
    // Moderation Options
    moderationOptions: "Moderation Options",
    modOptTitle: "Advanced Facilitation Settings",
    modOptDesc: "Customize how the AI Moderator controls the flow.",
    
    diamondTitle: "💎 The Diamond of Participation",
    diamondDesc: "This system ALWAYS follows the 'Diamond' model. The meeting will automatically progress through three phases based on turn count and context:",
    diamondPhase1: "1. Divergence: Generating many ideas (Open)",
    diamondPhase2: "2. Groan Zone: Structuring conflict (Struggle)",
    diamondPhase3: "3. Convergence: Narrowing down to a decision (Close)",
    
    optSixHats: "Six Thinking Hats",
    optSixHatsDesc: "Moderator can enforce a specific 'Thinking Mode' (e.g., 'Everyone focus on Risks') when the discussion is stuck.",
    optFistToFive: "Fist to Five (Consensus Check)",
    optFistToFiveDesc: "In the Convergence phase, Moderator will check consensus (0-5 scale) and prioritize those who disagree.",
    optParkingLot: "Parking Lot",
    optParkingLotDesc: "Moderator will 'park' off-topic ideas to keep the discussion focused without dismissing them.",
    optReframing: "Reframing & Sandwich",
    optReframingDesc: "Moderator rephrases negative comments into 'questions' and sandwiches critique with praise.",

    modeLabel: "Operation Mode",
    modeMulti: "Individual AI Models",
    modeMultiDesc: "Highest Quality. 1 AI per participant.",
    modeOffline: "Offline Mode (Demo)",
    modeOfflineDesc: "Demo only. No API usage.",
    offlineTooltip: "Demo mode to check UI without calling API",
    
    upload: "Upload Reference Material",
    addTextNote: "Add Note",
    textNoteTitle: "Note Title (Optional)",
    textNoteContent: "Paste text here...",
    add: "Add",
    cancel: "Cancel",
    filesAttached: "Files attached",
    viewLog: "View Log", // Deprecated key, kept for safety
    viewList: "List View", // New key
    downloadLogs: "Debug Logs", // New key
    viewRoom: "View Room",
    endMeeting: "End Meeting",
    endMeetingConfirmTitle: "End Meeting?",
    endMeetingConfirmDesc: "Do you want to compile minutes and download a report before ending?",
    generateMinutes: "Generate Minutes",
    generatingMinutes: "Generating Minutes...",
    justEnd: "Just End Meeting",
    moderator: "Moderator",
    writing: "Writing on board...",
    saveTeam: "Save Team",
    modelLabel: "Model",
    defaultModel: "Moderator / Default Model",
    applyToAll: "Apply to All Agents",
    modelNames: {
        'gemini-3-pro-preview': 'Gemini 3 Pro (High Quality)',
        'gemini-2.5-pro': 'Gemini 2.5 Pro (Balanced)',
        'gemini-2.5-flash': 'Gemini 2.5 Flash (Fast)',
        'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite (Low Cost)'
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
    chatPlaceholder: "Clarify goal or interject...",
    whiteboardTitle: "Live Whiteboard",
    whiteboardUpdating: "Updating...",
    summaryTitle: "Current Summary",
    visualMapTitle: "Visual Map",
    emptyWhiteboard: "Whiteboard updates are pending future specifications.",
    offlineMarker: "(No AI)",
    config: "Config",
    topic: "Topic/Goal",
    reset: "New Meeting",
    you: "You",
    checkingReactions: "Checking for reactions...",
    downgradeAlert: "Downgraded due to limit",
    officialTemplates: "Official Templates",
    userPresets: "Your Saved Teams",
    thinking: "Thinking...",
    kickoffMessage: 'The topic is "{topic}". Let\'s start by hearing initial thoughts from everyone in turn. We\'ll start with {name} ({role}). Please go ahead.',
    
    // Team Names
    presetTeams: {
      tech_giants: "AI Giants",
      jp_net_commentators: "JP Net Commentators",
      us_legendary_hosts: "US Legendary Hosts",
      us_modern_hosts: "US Modern TV Hosts",
      global_leaders: "Global Leaders",
      samurai: "Samurai",
      historical_figures: "Great Minds",
      demon_slayer: "Demon Slayer",
      american_heroes: "American Heroes",
      geniuses: "Geniuses",
      gods: "Gods"
    }
  },
  ja: {
    title: "AIブレインストーム・ボード",
    subtitle: "AIチームがあなたの課題を議論します",
    topicLabel: "会議のゴール（目的）は何ですか？",
    topicPlaceholder: "例：来期の販促アイデアを3つ決める...",
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
    debugModeDesc: "発言の末尾に使用したモデル名を追記します",
    
    // Moderation Options
    moderationOptions: "モデレーション設定",
    modOptTitle: "高度なファシリテーション設定",
    modOptDesc: "AI司会者の進行スタイルをカスタマイズします。",
    
    diamondTitle: "💎 参加のダイヤモンド (必須)",
    diamondDesc: "このシステムは常に「参加のダイヤモンド」モデルに従います。会話数と文脈に応じて、自動的に3つのフェーズを進行します：",
    diamondPhase1: "1. 発散 (Divergence): 多くのアイデアを出す",
    diamondPhase2: "2. 呻き (Groan Zone): 対立や混乱を整理する",
    diamondPhase3: "3. 収束 (Convergence): 結論に向けて絞り込む",
    
    optSixHats: "シックス・シンキング・ハッツ (思考モード強制)",
    optSixHatsDesc: "議論が停滞した際、司会者が「今は全員リスクについて話して」と思考モードを強制し、視点を統一します。",
    optFistToFive: "Fist to Five (合意形成チェック)",
    optFistToFiveDesc: "収束フェーズで、司会者が0〜5の数字で合意度を確認し、反対者(スコア2以下)の意見を優先的に拾います。",
    optParkingLot: "パーキングロット (駐車場)",
    optParkingLotDesc: "本筋から逸れたアイデアを「今は扱わない重要な意見」として保留し、議論の脱線を防ぎます。",
    optReframing: "リフレーミング & サンドイッチ介入",
    optReframingDesc: "否定的な発言を「問い」に変換し、批判を肯定的な言葉で挟んで伝えることで、心理的安全性を保ちます。",

    modeLabel: "動作モード",
    modeMulti: "個別AIモデル",
    modeMultiDesc: "最高品質。参加者1名につきAI1体。",
    modeOffline: "オフラインモード (デモ)",
    modeOfflineDesc: "API未使用デモ。",
    offlineTooltip: "APIを呼び出さずに、UIを確認するデモモード",

    upload: "参考資料をアップロード",
    addTextNote: "テキスト追加",
    textNoteTitle: "タイトル (任意)",
    textNoteContent: "ここにテキストを貼り付け...",
    add: "追加",
    cancel: "キャンセル",
    filesAttached: "ファイル添付済み",
    viewLog: "ログ表示",
    viewList: "一覧表示",
    downloadLogs: "デバッグログ",
    viewRoom: "ルーム表示",
    endMeeting: "会議終了",
    endMeetingConfirmTitle: "会議を終了しますか？",
    endMeetingConfirmDesc: "終了前に議事録を作成し、レポートをダウンロードしますか？",
    generateMinutes: "議事録を作成して終了",
    generatingMinutes: "議事録を作成中...",
    justEnd: "作成せずに終了",
    moderator: "司会者",
    writing: "ボードに書き込み中...",
    saveTeam: "チームを保存",
    modelLabel: "モデル",
    defaultModel: "司会者 / デフォルトモデル",
    applyToAll: "全員に適用",
    modelNames: {
        'gemini-3-pro-preview': 'Gemini 3 Pro (最高品質)',
        'gemini-2.5-pro': 'Gemini 2.5 Pro (バランス)',
        'gemini-2.5-flash': 'Gemini 2.5 Flash (高速)',
        'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite (低コスト)'
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
    chatPlaceholder: "ゴールを明確化、または議論に参加...",
    whiteboardTitle: "ライブ・ホワイトボード",
    whiteboardUpdating: "更新中...",
    summaryTitle: "現在の要約",
    visualMapTitle: "可視化マップ",
    emptyWhiteboard: "ホワイトボード機能は現在調整中です。",
    offlineMarker: "(AI未使用)",
    config: "設定",
    topic: "ゴール/テーマ",
    reset: "新しい会議",
    you: "あなた",
    checkingReactions: "反応を確認中...",
    downgradeAlert: "制限のためモデル変更",
    officialTemplates: "公式テンプレート",
    userPresets: "保存済みチーム",
    thinking: "考え中…",
    kickoffMessage: 'テーマは「{topic}」です。まずは、皆さんのご意見を順番にお聞きしたいと思います。では、{role}の{name}さん。お願いします。',
    
    // Team Names
    presetTeams: {
      tech_giants: "AI界隈の巨人",
      jp_net_commentators: "日本のネット論客",
      us_legendary_hosts: "米歴代有名司会者",
      us_modern_hosts: "米現代TVホスト",
      global_leaders: "各国最高主導者",
      samurai: "武士",
      historical_figures: "偉人達",
      demon_slayer: "鬼滅",
      american_heroes: "アメコミヒーロー",
      geniuses: "天才科学者",
      gods: "神々"
    }
  },
  // Other languages default to English for new keys if not explicitly added, 
  // but let's add minimal keys to avoid crashes
};
