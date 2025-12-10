
import React, { useState, useEffect, useRef } from 'react';
import { Agent, MeetingMode, SavedConfig, Attachment, TeamTemplate, ModerationSettings } from '../types';
import { getMeetingBackend } from '../services/geminiService';
import { Users, Wand2, Save, Download, Trash2, Play, AlertCircle, ChevronLeft, Globe, ArrowRight, Zap, Bot, WifiOff, FileText, X, Plus, Paperclip, Upload, ChevronDown, Shield, Copy, Heart, Cpu, AlertTriangle, Bug, StickyNote, Settings2, Diamond, Hand, MessageSquare, ListFilter, MessageCircle, Check } from 'lucide-react';
import { AGENTS, LANGUAGES, TRANSLATIONS, MODEL_OPTIONS, DEFAULT_MODEL, DEFAULT_MODERATION_SETTINGS } from '../constants';
import { PRESET_TEAMS } from '../teams';
import { ErrorBanner } from './ErrorBanner';

interface SetupScreenProps {
  onStartMeeting: (topic: string, agents: Agent[], mode: MeetingMode, files: Attachment[], defaultModel: string, modSettings: ModerationSettings) => void;
  langCode: string;
  setLangCode: (code: string) => void;
  debugMode: boolean;
  setDebugMode: (enabled: boolean) => void;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({ onStartMeeting, langCode, setLangCode, debugMode, setDebugMode }) => {
  const [step, setStep] = useState<'initial' | 'customize'>('initial');
  
  const [topic, setTopic] = useState('');
  const [agents, setAgents] = useState<Agent[]>(AGENTS);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [mode, setMode] = useState<MeetingMode>('multi-agent');
  
  // Model Selection - Split into Moderator and Participants
  const [moderatorModel, setModeratorModel] = useState<string>('gemini-3-pro-preview');
  const [participantModel, setParticipantModel] = useState<string>('gemini-2.5-flash-lite');
  
  // Bulk Apply Model Selection (defaults to participant model)
  const [bulkModel, setBulkModel] = useState<string>('gemini-2.5-flash-lite');

  // Saved Configs State
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false);

  // Text Note Modal State
  const [isTextModalOpen, setIsTextModalOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');

  // Moderation Settings State
  const [modSettings, setModSettings] = useState<ModerationSettings>(DEFAULT_MODERATION_SETTINGS);
  const [isModSettingsOpen, setIsModSettingsOpen] = useState(false);

  // Language Menu Logic
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const langMenuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t = TRANSLATIONS[langCode] || TRANSLATIONS['en'];
  const isOffline = mode === 'offline';

  // --- MODEL VALIDATION LOGIC ---
  const validateModel = (modelId: string | undefined): string => {
      if (!modelId) return DEFAULT_MODEL;
      const exists = MODEL_OPTIONS.some(opt => opt.id === modelId);
      if (!exists) {
          console.warn(`Invalid/Deprecated model found: ${modelId}. Reverting to default.`);
          return DEFAULT_MODEL;
      }
      return modelId;
  };

  // Validate initial agents on mount
  useEffect(() => {
      const validatedAgents = agents.map(a => ({
          ...a,
          model: validateModel(a.model)
      }));
      // Only update if changes were made to avoid loops, simplistic check
      if (JSON.stringify(validatedAgents) !== JSON.stringify(agents)) {
          setAgents(validatedAgents);
      }
      
      // Validate selected global models
      const validMod = validateModel(moderatorModel);
      if (validMod !== moderatorModel) setModeratorModel(validMod);
      
      const validPart = validateModel(participantModel);
      if (validPart !== participantModel) setParticipantModel(validPart);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('meeting_saved_configs');
    if (saved) {
      try {
        setSavedConfigs(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse saved configs", e);
      }
    }
  }, []);

  // Update bulk model when participant model changes in initial screen
  useEffect(() => {
      setBulkModel(participantModel);
  }, [participantModel]);

  const handleLangEnter = () => {
    if (langMenuTimer.current) clearTimeout(langMenuTimer.current);
    setIsLangMenuOpen(true);
  };

  const handleLangLeave = () => {
    langMenuTimer.current = setTimeout(() => {
      setIsLangMenuOpen(false);
    }, 300);
  };

  const getBackend = (m: MeetingMode) => getMeetingBackend(m);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files;
      if (!selected) return;

      Array.from(selected).forEach((file: File) => {
          const reader = new FileReader();
          reader.onloadend = () => {
              if (reader.result) {
                  setFiles(prev => [...prev, {
                      name: file.name,
                      mimeType: file.type,
                      data: reader.result as string
                  }]);
              }
          };
          reader.readAsDataURL(file);
      });
  };

  const handleAddTextNote = () => {
    if (!noteContent.trim()) return;

    // Use a trick to properly encode Unicode string to Base64
    const encodedData = btoa(unescape(encodeURIComponent(noteContent)));
    const dataUrl = `data:text/plain;base64,${encodedData}`;

    const newFile: Attachment = {
        name: noteTitle.trim() || `Note ${files.length + 1}.txt`,
        mimeType: 'text/plain',
        data: dataUrl
    };

    setFiles(prev => [...prev, newFile]);
    
    // Reset and close
    setNoteContent('');
    setNoteTitle('');
    setIsTextModalOpen(false);
  };

  const removeFile = (index: number) => {
      setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleQuickStart = async () => {
    if (!topic.trim()) {
      setErrorMsg(t.autoGenError);
      return;
    }

    if (mode === 'offline') {
       const backend = getBackend('offline');
       const mockTeam = await backend.generateTeam(topic, langCode, [], moderatorModel);
       onStartMeeting(topic, mockTeam, 'offline', files, moderatorModel, modSettings);
       return;
    }

    setErrorMsg(null);
    setShowFallback(false);
    setIsGenerating(true);
    
    try {
        const backend = getBackend(mode);
        // Step 1: Generate Team Structure 
        // Use Moderator Model (High Quality) for the generation logic to get good personas
        const newAgents = await backend.generateTeam(topic, langCode, files, moderatorModel);
        
        if (!newAgents || newAgents.length === 0) {
             throw new Error("No agents generated");
        }

        // Ensure models are attached and valid
        // Assign PARTICIPANT MODEL to the agents to save cost
        const finalAgents = newAgents.map(a => ({ 
            ...a, 
            initialMessage: undefined, 
            model: validateModel(participantModel) 
        }));
        
        // Pass moderatorModel as the default/moderator model
        onStartMeeting(topic, finalAgents, mode, files, moderatorModel, modSettings);

    } catch (e: any) {
        console.error(e);
        setErrorMsg(e.message || "Error generating team");
        setShowFallback(true);
    } finally {
        setIsGenerating(false);
    }
  };

  const startWithDefaults = () => {
      onStartMeeting(topic, AGENTS, 'offline', files, moderatorModel, modSettings);
  };

  const goToCustomize = () => {
     setErrorMsg(null);
     setShowFallback(false);
     setStep('customize');
     const updatedAgents = agents.map(a => ({
         ...a,
         model: validateModel(a.model || participantModel)
     }));
     setAgents(updatedAgents);
  };

  const handleAutoGenerateInCustomize = async () => {
    if (!topic.trim()) {
      setErrorMsg(t.autoGenError);
      return;
    }
    setErrorMsg(null);
    setIsGenerating(true);
    try {
      const backend = getBackend(mode);
      const newAgents = await backend.generateTeam(topic, langCode, files, moderatorModel);
      // Validate models of generated agents and assign participant model
      const validatedAgents = newAgents.map(a => ({
          ...a,
          model: validateModel(participantModel)
      }));
      setAgents(validatedAgents);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAgentChange = (index: number, field: keyof Agent, value: string) => {
    const newAgents = [...agents];
    if (newAgents[index]) {
        newAgents[index] = { ...newAgents[index], [field]: value };
        if (field === 'role' || field === 'systemInstruction' || field === 'name' || field === 'model' || field === 'interest') {
            newAgents[index].initialMessage = undefined;
        }
        setAgents(newAgents);
    }
  };

  const handleRemoveAgent = (index: number) => {
      const newAgents = [...agents];
      newAgents.splice(index, 1);
      setAgents(newAgents);
  };

  const handleAddAgent = () => {
      const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500'];
      const newAgent: Agent = {
          id: `custom-${Date.now()}`,
          name: "New Agent",
          role: "Expert",
          systemInstruction: "You are a helpful expert.",
          interest: "General",
          avatarColor: colors[agents.length % colors.length],
          model: participantModel // Default to participant model
      };
      setAgents([...agents, newAgent]);
  };

  const applyBulkModel = () => {
      const updatedAgents = agents.map(a => ({
          ...a,
          model: bulkModel,
          initialMessage: undefined 
      }));
      setAgents(updatedAgents);
  };

  const handleSaveConfig = () => {
    if (!saveName.trim()) return;
    
    const newConfig: SavedConfig = {
        id: Date.now().toString(),
        name: saveName,
        agents: agents,
        updatedAt: Date.now()
    };
    
    const updatedList = [newConfig, ...savedConfigs];
    setSavedConfigs(updatedList);
    localStorage.setItem('meeting_saved_configs', JSON.stringify(updatedList));
    
    setShowSaveModal(false);
    setSaveName('');
  };

  const handleLoadConfig = (config: SavedConfig | TeamTemplate) => {
      // Load agents, ensuring they have valid models (fallback to current participant model if missing/invalid)
      const agentsWithValidModels = config.agents.map(a => ({
          ...a,
          model: validateModel(a.model || participantModel) 
      }));

      setAgents(agentsWithValidModels);
      setStep('customize');
      setIsPresetDropdownOpen(false);
  };
  
  const handleDeleteConfig = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      e.preventDefault();
      const updatedList = savedConfigs.filter(c => c.id !== id);
      setSavedConfigs(updatedList);
      localStorage.setItem('meeting_saved_configs', JSON.stringify(updatedList));
  };

  const handleExportConfig = () => {
    const config = { topic, agents };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `config-${Date.now()}.json`;
    a.click();
  };

  const handleImportConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
          try {
              const json = JSON.parse(ev.target?.result as string);
              if (json.agents) {
                  // Validate imported agents
                  const importedAgents = json.agents.map((a: Agent) => ({
                      ...a,
                      model: validateModel(a.model)
                  }));
                  setAgents(importedAgents);
              }
              if (json.topic) {
                  setTopic(json.topic);
              }
              setStep('customize');
          } catch (error) {
              alert("Invalid config file");
          }
      };
      reader.readAsText(file);
      // Reset input
      e.target.value = '';
  };
  
  const handleStartCustomMeeting = async () => {
      if (!isValidTeamSize) return;
      
      const finalAgents = agents.map(a => ({
          ...a,
          initialMessage: undefined,
          model: validateModel(a.model || participantModel)
      }));
      
      // Use moderatorModel as default for moderator
      onStartMeeting(topic, finalAgents, mode, files, moderatorModel, modSettings);
  };

  const isValidTeamSize = agents.length >= 2 && agents.length <= 10;

  return (
    <div className="w-full h-full bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 flex flex-col font-sans transition-colors duration-300 relative">
      
      {/* Top Bar Controls */}
      <div className="absolute top-6 right-6 z-20 flex flex-col items-end gap-3">
         <div 
            className="relative group"
            onMouseEnter={handleLangEnter}
            onMouseLeave={handleLangLeave}
         >
            <button className="flex items-center gap-2 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-700 transition-colors shadow-sm">
               <Globe size={16} /> 
               {LANGUAGES.find(l => l.code === langCode)?.name}
            </button>
            {/* Invisible bridge to prevent mouseleave when moving to dropdown */}
            <div className={`absolute top-full right-0 h-2 w-full ${isLangMenuOpen ? 'block' : 'hidden'}`} />
            
            {isLangMenuOpen && (
                <div className="absolute right-0 top-[calc(100%+0.5rem)] w-40 z-50 animate-in fade-in zoom-in-95 duration-200">
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden">
                    {LANGUAGES.map(lang => (
                        <button 
                            key={lang.code}
                            onClick={() => {
                                setLangCode(lang.code);
                                setIsLangMenuOpen(false);
                            }}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 ${langCode === lang.code ? 'bg-indigo-50 dark:bg-gray-700/50 text-indigo-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}`}
                        >
                            {lang.name}
                        </button>
                    ))}
                </div>
                </div>
            )}
         </div>
      </div>
      
      {/* Global Error Banner */}
      <ErrorBanner 
        message={errorMsg || ''} 
        onClose={() => setErrorMsg(null)}
        actionButton={showFallback && (
            <button onClick={startWithDefaults} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex justify-center items-center gap-2 hover:bg-green-500 shadow-md">
                <span>Use Offline Mode</span> <ArrowRight size={16} />
            </button>
        )}
      />

      <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
        <div className={`w-full max-w-5xl space-y-8 animate-in fade-in zoom-in duration-500 ${step === 'customize' ? 'h-full flex flex-col justify-center' : ''}`}>
            {/* Title Section */}
            <div className="text-center space-y-3 flex-shrink-0">
              <h1 className="text-5xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 pb-2">{t.title}</h1>
              <p className="text-xl text-gray-600 dark:text-gray-400 font-light">{t.subtitle}</p>
            </div>

            {step === 'initial' && (
                <div className="max-w-2xl mx-auto space-y-8 mt-8">
                    <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="block text-sm font-medium ml-1">{t.topicLabel}</label>
                          <input
                              type="text"
                              value={topic}
                              onChange={(e) => setTopic(e.target.value)}
                              placeholder={t.topicPlaceholder}
                              className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl px-6 py-5 text-xl shadow-sm outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                         <div className="space-y-2">
                            <label className="block text-sm font-medium ml-1">{t.upload}</label>
                            <div className="flex flex-wrap gap-2">
                                {files.map((f, i) => (
                                    <div key={i} className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full text-sm border border-gray-200 dark:border-gray-700">
                                        {f.mimeType === 'text/plain' ? <StickyNote size={14} className="text-yellow-500"/> : <FileText size={14} className="text-indigo-500"/>}
                                        <span className="truncate max-w-[150px]">{f.name}</span>
                                        <button onClick={() => removeFile(i)} className="text-gray-500 hover:text-red-500"><X size={14}/></button>
                                    </div>
                                ))}
                                <label className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg cursor-pointer transition-colors text-sm font-medium text-gray-700 dark:text-gray-300 border border-transparent">
                                    <Paperclip size={16} /> {t.attach}
                                    <input type="file" multiple className="hidden" onChange={handleFileUpload} />
                                </label>
                                <button 
                                    onClick={() => setIsTextModalOpen(true)} 
                                    className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors text-sm font-medium text-gray-700 dark:text-gray-300 border border-transparent"
                                >
                                    <StickyNote size={16} /> {t.addTextNote}
                                </button>
                            </div>
                        </div>
                        
                        {/* Models & Settings Row - Swapped Participants and Moderator */}
                        <div className="flex flex-col sm:flex-row gap-4 items-end">
                            <div className={`flex-1 flex gap-4 w-full transition-opacity ${isOffline ? 'opacity-50' : 'opacity-100'}`}>
                                {/* Participants Model Select (Moved to Left) */}
                                <div className="flex-1 space-y-2">
                                    <label className="block text-sm font-medium ml-1 flex items-center gap-1">
                                        <Users size={14} className="text-gray-600 dark:text-gray-400"/>
                                        {t.participants}
                                    </label>
                                    <div className="relative">
                                        <select 
                                            value={participantModel}
                                            onChange={(e) => setParticipantModel(e.target.value)}
                                            disabled={isOffline}
                                            className="w-full appearance-none bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-3 pr-8 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-white cursor-pointer disabled:cursor-not-allowed"
                                        >
                                            {MODEL_OPTIONS.map(opt => (
                                                <option key={opt.id} value={opt.id}>{t.modelNames?.[opt.id] || opt.id}</option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={16} />
                                    </div>
                                </div>

                                {/* Moderator Model Select (Moved to Right) */}
                                <div className="flex-1 space-y-2">
                                    <label className="block text-sm font-medium ml-1 flex items-center gap-1">
                                        <Bot size={14} className="text-indigo-600 dark:text-indigo-400"/>
                                        {t.moderator}
                                    </label>
                                    <div className="relative">
                                        <select 
                                            value={moderatorModel}
                                            onChange={(e) => setModeratorModel(e.target.value)}
                                            disabled={isOffline}
                                            className="w-full appearance-none bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-3 pr-8 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-white cursor-pointer disabled:cursor-not-allowed"
                                        >
                                            {MODEL_OPTIONS.map(opt => (
                                                <option key={opt.id} value={opt.id}>{t.modelNames?.[opt.id] || opt.id}</option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={16} />
                                    </div>
                                </div>
                            </div>
                            
                            {/* Moderation Options Button */}
                            <button 
                                onClick={() => setIsModSettingsOpen(true)}
                                className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm flex-shrink-0 h-[46px]"
                            >
                                <Settings2 size={18} />
                                <span className="hidden sm:inline font-medium">{t.moderationOptions}</span>
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <button onClick={handleQuickStart} disabled={isGenerating || !topic.trim()} className="group flex flex-col items-center justify-center gap-3 p-6 bg-gradient-to-br from-indigo-600 to-blue-700 hover:from-indigo-500 text-white rounded-2xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-[1.02] active:scale-95">
                            {isGenerating ? <div className="animate-spin"><Wand2 size={32} /></div> : <Wand2 size={32} className="group-hover:rotate-12 transition-transform" />}
                            <span className="font-bold text-lg">{isGenerating ? t.generating : t.quickStart}</span>
                        </button>
                        <button onClick={goToCustomize} disabled={!topic.trim()} className="group flex flex-col items-center justify-center gap-3 p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:bg-gray-50 dark:hover:bg-gray-700 hover:scale-[1.02] active:scale-95">
                            <Users size={32} className="text-gray-500 group-hover:text-gray-700 dark:group-hover:text-gray-200 transition-colors" />
                            <span className="font-bold text-gray-700 dark:text-gray-300 text-lg">{t.customize}</span>
                        </button>
                    </div>
                     {/* Saved Configs List */}
                    <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-800">
                            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">{t.savedPresets}</h3>
                            <div className="relative">
                            <button 
                                onClick={() => setIsPresetDropdownOpen(!isPresetDropdownOpen)}
                                disabled={!topic.trim()}
                                className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 flex justify-between items-center text-gray-900 dark:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                            >
                                <span>{t.selectPreset}</span>
                                <ChevronDown size={16} />
                            </button>
                            {isPresetDropdownOpen && (
                                <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden max-h-80 overflow-y-auto">
                                    
                                    {/* USER SAVED */}
                                    {savedConfigs.length > 0 && (
                                        <>
                                            <div className="bg-gray-50 dark:bg-gray-900/50 px-4 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
                                                <Save size={12} className="text-gray-500" />
                                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{t.userPresets}</span>
                                            </div>
                                            {savedConfigs.map(config => (
                                                <div key={config.id} className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                                    <button onClick={() => handleLoadConfig(config)} className="flex-grow text-left p-3 font-medium text-sm flex flex-col outline-none focus:bg-gray-100 dark:focus:bg-gray-700">
                                                        <span className="text-gray-900 dark:text-gray-100">{config.name}</span>
                                                        <span className="text-xs text-gray-500">{config.agents.length} agents</span>
                                                    </button>
                                                    <button onClick={(e) => handleDeleteConfig(e, config.id)} className="flex-shrink-0 p-3 mr-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors cursor-pointer" title={t.deletePreset} type="button">
                                                        <Trash2 size={18} />
                                                    </button>
                                                </div>
                                            ))}
                                        </>
                                    )}

                                    {/* OFFICIAL TEMPLATES */}
                                    <div className={`bg-gray-50 dark:bg-gray-900/50 px-4 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2 ${savedConfigs.length > 0 ? 'border-t mt-0' : ''}`}>
                                        <Shield size={12} className="text-indigo-500" />
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{t.officialTemplates}</span>
                                    </div>
                                    {PRESET_TEAMS.map(template => (
                                        <div key={template.id} className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                            <button onClick={() => handleLoadConfig(template)} className="flex-grow text-left p-3 font-medium text-sm flex flex-col outline-none focus:bg-gray-100 dark:focus:bg-gray-700 group">
                                                <span className="text-indigo-700 dark:text-indigo-300 group-hover:text-indigo-600 font-bold">
                                                    {t.presetTeams?.[template.id] || template.name}
                                                </span>
                                                <span className="text-xs text-gray-500 mt-0.5">{template.agents.length} Agents: {template.agents.map(a => a.name.split(' ')[0]).join(', ')}</span>
                                            </button>
                                        </div>
                                    ))}

                                </div>
                            )}
                            </div>
                    </div>

                    {/* Moved Toggles to Bottom - JUSTIFY END */}
                    <div className="flex flex-wrap items-center justify-end gap-6 pt-8 pb-4 border-t border-gray-200 dark:border-gray-800 opacity-80 hover:opacity-100 transition-opacity">
                           {/* OFFLINE TOGGLE */}
                           <div className="relative group">
                               <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer transition-colors select-none z-10">
                                   <WifiOff size={16} />
                                   <span className="font-medium">{t.modeOffline}</span>
                                   <div className={`relative w-9 h-5 rounded-full p-1 transition-colors duration-200 ${mode === 'offline' ? 'bg-gray-600' : 'bg-gray-200 dark:bg-gray-700'}`}>
                                       <div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-transform duration-200 ${mode === 'offline' ? 'translate-x-4' : 'translate-x-0'}`} />
                                   </div>
                                   <input 
                                        type="checkbox" 
                                        checked={mode === 'offline'} 
                                        onChange={(e) => setMode(e.target.checked ? 'offline' : 'multi-agent')} 
                                        className="hidden" 
                                   />
                               </label>
                               <div className="absolute bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-black/80 text-white text-xs rounded z-50 text-center backdrop-blur-sm shadow-xl animate-in fade-in slide-in-from-bottom-2">
                                  {t.offlineTooltip}
                               </div>
                           </div>

                           {/* DEBUG TOGGLE */}
                           <div className="relative group">
                               <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer transition-colors select-none z-10">
                                   <Bug size={16} />
                                   <span className="font-medium">{t.debugMode}</span>
                                   <div className={`relative w-9 h-5 rounded-full p-1 transition-colors duration-200 ${debugMode ? 'bg-indigo-500' : 'bg-gray-200 dark:bg-gray-700'}`}>
                                       <div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-transform duration-200 ${debugMode ? 'translate-x-4' : 'translate-x-0'}`} />
                                   </div>
                                   <input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} className="hidden" />
                               </label>
                               <div className="absolute bottom-full mb-2 hidden group-hover:block w-48 p-2 bg-black/80 text-white text-xs rounded z-50 text-center backdrop-blur-sm shadow-xl animate-in fade-in slide-in-from-bottom-2">
                                  {t.debugModeDesc}
                               </div>
                           </div>
                    </div>
                </div>
            )}
            
            {step === 'customize' && (
                <div className="bg-white dark:bg-gray-900/50 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl flex flex-col max-h-[75vh] w-full">
                   {/* Header - Fixed */}
                   <div className="p-6 pb-4 flex justify-between items-center border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
                      <button onClick={() => setStep('initial')} className="flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                          <ChevronLeft size={20} /> <span className="font-medium">{t.back}</span>
                      </button>
                      <div className="flex gap-2">
                          <button onClick={() => setIsModSettingsOpen(true)} className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors" title={t.moderationOptions}>
                             <Settings2 size={18} />
                          </button>
                          <label className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors cursor-pointer" title={t.import}>
                             <Upload size={18} />
                             <input type="file" accept=".json" onChange={handleImportConfig} className="hidden" />
                          </label>
                          <button onClick={() => setShowSaveModal(true)} className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors" title={t.save}>
                             <Save size={18} /> <span className="hidden sm:inline">{t.save}</span>
                          </button>
                          <button onClick={handleExportConfig} className="p-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors" title={t.export}>
                             <Download size={18} />
                          </button>
                      </div>
                   </div>
                   
                   {/* Scrollable Content */}
                   <div className="flex-1 overflow-y-auto p-6 space-y-8">
                       {/* Topic Input in Customize (ReadOnly-ish or Editable) */}
                       <div className="flex gap-2">
                           <input 
                              value={topic}
                              onChange={(e) => setTopic(e.target.value)}
                              className="flex-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2 text-lg font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                              placeholder="Topic..."
                           />
                           <button 
                             onClick={handleAutoGenerateInCustomize} 
                             disabled={isGenerating} 
                             className="px-4 py-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-xl font-medium text-sm flex items-center gap-2 hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition-colors"
                           >
                              {isGenerating ? <div className="animate-spin"><Wand2 size={16}/></div> : <Wand2 size={16}/>}
                              {t.generateAgents}
                           </button>
                       </div>
                       
                       {/* SEPARATED MODEL CONTROLS */}
                        <div className="bg-gray-100 dark:bg-gray-800/50 p-3 rounded-xl flex flex-col sm:flex-row gap-4 justify-between items-center border border-gray-200 dark:border-gray-700">
                            {/* Moderator Model */}
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <span className="text-sm font-bold text-gray-600 dark:text-gray-400 flex items-center gap-1">
                                    <Bot size={16} className="text-indigo-600 dark:text-indigo-400"/>
                                    {t.moderator}:
                                </span>
                                <select 
                                    value={moderatorModel}
                                    onChange={(e) => setModeratorModel(e.target.value)}
                                    disabled={isOffline}
                                    className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-white flex-1 sm:flex-none cursor-pointer"
                                >
                                    {MODEL_OPTIONS.map(opt => (
                                        <option key={opt.id} value={opt.id}>{t.modelNames?.[opt.id] || opt.id}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="hidden sm:block h-6 w-px bg-gray-300 dark:bg-gray-700"></div>

                            {/* Bulk Apply */}
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                <span className="text-sm font-bold text-gray-600 dark:text-gray-400 flex items-center gap-1">
                                    <Users size={16} className="text-gray-500 dark:text-gray-400"/>
                                    {t.participants}:
                                </span>
                                <select 
                                    value={bulkModel}
                                    onChange={(e) => setBulkModel(e.target.value)}
                                    disabled={isOffline}
                                    className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-white flex-1 sm:flex-none cursor-pointer"
                                >
                                    {MODEL_OPTIONS.map(opt => (
                                        <option key={opt.id} value={opt.id}>{t.modelNames?.[opt.id] || opt.id}</option>
                                    ))}
                                </select>
                                <button 
                                    onClick={applyBulkModel}
                                    className="text-xs font-bold bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-3 py-2 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition-colors flex items-center gap-1 whitespace-nowrap"
                                >
                                    <Copy size={14}/> {t.applyToAll}
                                </button>
                            </div>
                        </div>

                       {/* Agent List */}
                       <div className="grid grid-cols-1 gap-4">
                           {agents.map((agent, i) => (
                               <div key={agent.id} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700 relative group transition-all hover:shadow-md">
                                   <div className="flex flex-col sm:flex-row gap-4 items-start">
                                       <div className={`w-12 h-12 rounded-full ${agent.avatarColor} flex items-center justify-center text-white font-bold text-xl shadow-sm flex-shrink-0`}>
                                           {agent.name.charAt(0)}
                                       </div>
                                       <div className="flex-1 w-full space-y-3">
                                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                               <div>
                                                   <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 block">{t.agentName}</label>
                                                   <input 
                                                      value={agent.name}
                                                      onChange={(e) => handleAgentChange(i, 'name', e.target.value)}
                                                      className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                                                   />
                                               </div>
                                               <div>
                                                   <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 block">{t.agentRole}</label>
                                                   <input 
                                                      value={agent.role}
                                                      onChange={(e) => handleAgentChange(i, 'role', e.target.value)}
                                                      className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                                   />
                                               </div>
                                           </div>
                                           
                                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                <div>
                                                   <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Cpu size={12}/> {t.modelLabel}</label>
                                                   <select 
                                                        value={agent.model || participantModel}
                                                        onChange={(e) => handleAgentChange(i, 'model', e.target.value)}
                                                        disabled={isOffline}
                                                        className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                                    >
                                                        {MODEL_OPTIONS.map(opt => (
                                                            <option key={opt.id} value={opt.id}>{t.modelNames?.[opt.id] || opt.id}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Heart size={12}/> {t.agentInterest}</label>
                                                    <input 
                                                      value={agent.interest || ''}
                                                      onChange={(e) => handleAgentChange(i, 'interest', e.target.value)}
                                                      placeholder="e.g. Cost efficiency, Safety..."
                                                      className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                                   />
                                                </div>
                                           </div>

                                           <div>
                                               <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 block">{t.agentInstruction}</label>
                                               <textarea 
                                                  value={agent.systemInstruction}
                                                  onChange={(e) => handleAgentChange(i, 'systemInstruction', e.target.value)}
                                                  rows={2}
                                                  className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 resize-none leading-relaxed"
                                               />
                                           </div>
                                       </div>
                                       <button onClick={() => handleRemoveAgent(i)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                                           <Trash2 size={18} />
                                       </button>
                                   </div>
                               </div>
                           ))}
                           <button onClick={handleAddAgent} className="flex items-center justify-center gap-2 py-4 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl text-gray-500 hover:text-indigo-500 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/10 transition-all font-bold">
                               <Plus size={20} />
                               {t.add}
                           </button>
                       </div>
                   </div>

                   {/* Footer - Fixed */}
                   <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 rounded-b-2xl">
                       <button onClick={handleStartCustomMeeting} disabled={!isValidTeamSize || !topic.trim()} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-indigo-500/30 disabled:opacity-50 disabled:shadow-none transition-all flex items-center justify-center gap-2">
                           <Play size={24} fill="currentColor" />
                           {t.start}
                       </button>
                   </div>
                </div>
            )}
        </div>
      </div>

      {/* --- MODALS --- */}

      {/* SAVE MODAL */}
      {showSaveModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm border border-gray-200 dark:border-gray-700">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold text-lg text-gray-900 dark:text-white">{t.save}</h3>
                      <button onClick={() => setShowSaveModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20}/></button>
                  </div>
                  <input 
                    autoFocus
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="Team Name..."
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg p-3 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none mb-4"
                  />
                  <div className="flex gap-2 justify-end">
                      <button onClick={() => setShowSaveModal(false)} className="px-4 py-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">{t.cancel}</button>
                      <button onClick={handleSaveConfig} disabled={!saveName.trim()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50">{t.save}</button>
                  </div>
              </div>
          </div>
      )}

      {/* TEXT NOTE MODAL - FIXED */}
      {isTextModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
             <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-md border border-gray-200 dark:border-gray-700 transform scale-100 transition-all">
                <h3 className="font-bold text-lg mb-4 text-gray-900 dark:text-white flex items-center gap-2">
                  <StickyNote className="text-yellow-500" />
                  {t.addTextNote}
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t.textNoteTitle}</label>
                    <input 
                      autoFocus
                      className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900 dark:text-white placeholder-gray-400"
                      placeholder="e.g. System Context"
                      value={noteTitle}
                      onChange={e => setNoteTitle(e.target.value)}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t.textNoteContent}</label>
                    <textarea
                      className="w-full h-32 px-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none resize-none text-gray-900 dark:text-white placeholder-gray-400"
                      placeholder={t.textNoteContent}
                      value={noteContent}
                      onChange={e => setNoteContent(e.target.value)}
                    />
                  </div>
                </div>
    
                <div className="flex justify-end gap-3 mt-6">
                  <button 
                    onClick={() => setIsTextModalOpen(false)} 
                    className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors"
                  >
                    {t.cancel}
                  </button>
                  <button 
                    onClick={handleAddTextNote} 
                    disabled={!noteContent.trim()} 
                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:shadow-none transition-all"
                  >
                    {t.add}
                  </button>
                </div>
             </div>
          </div>
      )}

      {/* MODERATION SETTINGS MODAL */}
      {isModSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-lg border border-gray-200 dark:border-gray-700 max-h-[90vh] overflow-y-auto">
                  <div className="flex justify-between items-start mb-4">
                      <div>
                          <h3 className="font-bold text-xl text-gray-900 dark:text-white flex items-center gap-2">
                             <Diamond className="text-indigo-500 fill-indigo-500" size={20} />
                             {t.modOptTitle}
                          </h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t.modOptDesc}</p>
                      </div>
                      <button onClick={() => setIsModSettingsOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1"><X size={24}/></button>
                  </div>

                  <div className="space-y-6">
                      {/* Diamond Explanation */}
                      <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800">
                          <h4 className="font-bold text-indigo-900 dark:text-indigo-200 text-sm mb-2">{t.diamondTitle}</h4>
                          <p className="text-xs text-indigo-800 dark:text-indigo-300 leading-relaxed mb-2">{t.diamondDesc}</p>
                          <ul className="text-xs text-indigo-700 dark:text-indigo-400 space-y-1 ml-2">
                              <li>{t.diamondPhase1}</li>
                              <li>{t.diamondPhase2}</li>
                              <li>{t.diamondPhase3}</li>
                          </ul>
                      </div>

                      {/* Toggles */}
                      <div className="space-y-4">
                           {/* Six Hats */}
                           <div className="flex items-start gap-3">
                               <div className="pt-1"><Bot size={18} className="text-gray-600 dark:text-gray-400" /></div>
                               <div className="flex-1">
                                   <div className="flex items-center justify-between mb-1">
                                       <span className="font-bold text-gray-900 dark:text-gray-100">{t.optSixHats}</span>
                                       <div className={`relative w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${modSettings.sixThinkingHats ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`} onClick={() => setModSettings(s => ({...s, sixThinkingHats: !s.sixThinkingHats}))}>
                                            <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${modSettings.sixThinkingHats ? 'translate-x-4' : 'translate-x-0'}`} />
                                       </div>
                                   </div>
                                   <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{t.optSixHatsDesc}</p>
                               </div>
                           </div>
                           
                           {/* Fist to Five */}
                           <div className="flex items-start gap-3">
                               <div className="pt-1"><Hand size={18} className="text-gray-600 dark:text-gray-400" /></div>
                               <div className="flex-1">
                                   <div className="flex items-center justify-between mb-1">
                                       <span className="font-bold text-gray-900 dark:text-gray-100">{t.optFistToFive}</span>
                                       <div className={`relative w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${modSettings.fistToFive ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`} onClick={() => setModSettings(s => ({...s, fistToFive: !s.fistToFive}))}>
                                            <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${modSettings.fistToFive ? 'translate-x-4' : 'translate-x-0'}`} />
                                       </div>
                                   </div>
                                   <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{t.optFistToFiveDesc}</p>
                               </div>
                           </div>

                           {/* Parking Lot */}
                           <div className="flex items-start gap-3">
                               <div className="pt-1"><ListFilter size={18} className="text-gray-600 dark:text-gray-400" /></div>
                               <div className="flex-1">
                                   <div className="flex items-center justify-between mb-1">
                                       <span className="font-bold text-gray-900 dark:text-gray-100">{t.optParkingLot}</span>
                                       <div className={`relative w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${modSettings.parkingLot ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`} onClick={() => setModSettings(s => ({...s, parkingLot: !s.parkingLot}))}>
                                            <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${modSettings.parkingLot ? 'translate-x-4' : 'translate-x-0'}`} />
                                       </div>
                                   </div>
                                   <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{t.optParkingLotDesc}</p>
                               </div>
                           </div>

                           {/* Reframing */}
                           <div className="flex items-start gap-3">
                               <div className="pt-1"><MessageCircle size={18} className="text-gray-600 dark:text-gray-400" /></div>
                               <div className="flex-1">
                                   <div className="flex items-center justify-between mb-1">
                                       <span className="font-bold text-gray-900 dark:text-gray-100">{t.optReframing}</span>
                                       <div className={`relative w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${modSettings.reframing ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`} onClick={() => setModSettings(s => ({...s, reframing: !s.reframing}))}>
                                            <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${modSettings.reframing ? 'translate-x-4' : 'translate-x-0'}`} />
                                       </div>
                                   </div>
                                   <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{t.optReframingDesc}</p>
                               </div>
                           </div>
                      </div>
                  </div>
                  
                  <div className="mt-8 flex justify-end">
                      <button onClick={() => setIsModSettingsOpen(false)} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-md transition-all flex items-center gap-2">
                          <Check size={18} /> Done
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
