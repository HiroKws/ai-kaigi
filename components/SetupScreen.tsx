import React, { useState, useEffect, useRef } from 'react';
import { Agent, MeetingMode, SavedConfig, Attachment, TeamTemplate } from '../types';
import { getMeetingBackend } from '../services/geminiService';
import { Users, Wand2, Save, Download, Trash2, Play, AlertCircle, ChevronLeft, Globe, ArrowRight, Zap, Bot, WifiOff, FileText, X, Plus, Paperclip, Upload, ChevronDown, Shield, Copy, Heart, Cpu, AlertTriangle, Bug } from 'lucide-react';
import { AGENTS, LANGUAGES, TRANSLATIONS, MODEL_OPTIONS, DEFAULT_MODEL, PRESET_TEAMS } from '../constants';
import { ErrorBanner } from './ErrorBanner';

interface SetupScreenProps {
  onStartMeeting: (topic: string, agents: Agent[], mode: MeetingMode, files: Attachment[], defaultModel: string) => void;
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
  
  // Model Selection
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);

  // Saved Configs State
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false);

  // Language Menu Logic
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const langMenuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t = TRANSLATIONS[langCode] || TRANSLATIONS['en'];
  const isOffline = mode === 'offline';

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
       const mockTeam = await backend.generateTeam(topic, langCode, [], selectedModel);
       onStartMeeting(topic, mockTeam, 'offline', files, selectedModel);
       return;
    }

    setErrorMsg(null);
    setShowFallback(false);
    setIsGenerating(true);
    
    try {
        const backend = getBackend(mode);
        // Step 1: Generate Team Structure (using default/base model)
        // If fallback occurs here, newAgents will contain the Downgraded Model in their .model property
        const newAgents = await backend.generateTeam(topic, langCode, files, selectedModel);
        
        if (!newAgents || newAgents.length === 0) {
             throw new Error("No agents generated");
        }

        // Step 2: If Multi-Agent, RE-GENERATE opening statements individually.
        if (mode === 'multi-agent') {
            // Ensure we use the model attached to the agent (which might be downgraded)
            const agentsForGen = newAgents.map(a => ({ 
                ...a, 
                initialMessage: undefined, 
                // Fallback to selectedModel only if for some reason agent.model is missing
                model: a.model || selectedModel 
            }));
            
            // Generate opening statements using the specific agent models
            const greetings = await backend.generateOpeningStatements(topic, agentsForGen, langCode, files, selectedModel);
            
            const finalAgents = agentsForGen.map((a, i) => ({
                ...a,
                // Extract .text and .usedModel
                initialMessage: greetings[i]?.text || "",
                initialMessageModel: greetings[i]?.usedModel 
            }));
            
            onStartMeeting(topic, finalAgents, mode, files, selectedModel);
        } else {
            onStartMeeting(topic, newAgents, mode, files, selectedModel);
        }

    } catch (e: any) {
        console.error(e);
        setErrorMsg(e.message || "Error generating team");
        setShowFallback(true);
    } finally {
        setIsGenerating(false);
    }
  };

  const startWithDefaults = () => {
      onStartMeeting(topic, AGENTS, 'offline', files, selectedModel);
  };

  const goToCustomize = () => {
     setErrorMsg(null);
     setShowFallback(false);
     setStep('customize');
     const updatedAgents = agents.map(a => ({
         ...a,
         model: a.model || selectedModel
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
      const newAgents = await backend.generateTeam(topic, langCode, files, selectedModel);
      setAgents(newAgents);
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
        // Clear initialMessage if user edits role/instruction/name/model to force regeneration
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

  const applyModelToAllAgents = () => {
      const updatedAgents = agents.map(a => ({
          ...a,
          model: selectedModel,
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
      setAgents(config.agents);
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
                  setAgents(json.agents);
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
      
      let finalAgents = [...agents];
      
      if (mode === 'multi-agent') {
          setIsGenerating(true);
          try {
              const backend = getBackend(mode);
              const agentsForGen = agents.map(a => ({
                  ...a,
                  initialMessage: undefined 
              }));

              const greetings = await backend.generateOpeningStatements(topic, agentsForGen, langCode, files, selectedModel);
              
              finalAgents = agents.map((agent, i) => ({
                  ...agent,
                  // Extract .text and .usedModel
                  initialMessage: greetings[i]?.text || "",
                  initialMessageModel: greetings[i]?.usedModel
              }));
              
              onStartMeeting(topic, finalAgents, mode, files, selectedModel);
          } catch (e: any) {
              console.error("Failed to generate custom greetings", e);
              setErrorMsg(e.message || "Failed to generate greetings");
              // onStartMeeting(topic, agents, mode, files, selectedModel); // Don't start automatically on error, let user see it
          } finally {
              setIsGenerating(false);
          }
      } else {
          onStartMeeting(topic, agents, mode, files, selectedModel);
      }
  };

  const isValidTeamSize = agents.length >= 3 && agents.length <= 7;

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
            {/* Title Section (Same as before) */}
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
                                    <div key={i} className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full text-sm">
                                        <FileText size={14} className="text-indigo-500"/>
                                        <span className="truncate max-w-[150px]">{f.name}</span>
                                        <button onClick={() => removeFile(i)} className="text-gray-500 hover:text-red-500"><X size={14}/></button>
                                    </div>
                                ))}
                                <label className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg cursor-pointer transition-colors text-sm font-medium text-gray-700 dark:text-gray-300">
                                    <Paperclip size={16} /> Attach
                                    <input type="file" multiple className="hidden" onChange={handleFileUpload} />
                                </label>
                            </div>
                        </div>
                        
                        <div className={`space-y-2 transition-opacity ${isOffline ? 'opacity-50' : 'opacity-100'}`}>
                            <label className="block text-sm font-medium ml-1">{t.defaultModel}</label>
                            <div className="relative">
                                <select 
                                    value={selectedModel}
                                    onChange={(e) => setSelectedModel(e.target.value)}
                                    disabled={isOffline}
                                    className="w-full appearance-none bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 pr-10 shadow-sm outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-white cursor-pointer disabled:cursor-not-allowed"
                                >
                                    {MODEL_OPTIONS.map(opt => (
                                        <option key={opt.id} value={opt.id}>{t.modelNames?.[opt.id] || opt.id}</option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={20} />
                            </div>
                        </div>

                        <div className="bg-white dark:bg-gray-800/50 p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
                           <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">{t.modeLabel}</div>
                           <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <label className={`flex flex-col gap-2 p-3 rounded-lg cursor-pointer border transition-colors ${mode === 'multi-agent' ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-500/50' : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                                    <div className="flex items-center gap-2 font-bold text-sm">
                                        <Bot size={16} className="text-indigo-500" /> 
                                        {t.modeMulti}
                                    </div>
                                    <input type="radio" checked={mode === 'multi-agent'} onChange={() => setMode('multi-agent')} className="sr-only" />
                                    <p className="text-[10px] text-gray-500 leading-tight">{t.modeMultiDesc}</p>
                                </label>
                                <label className={`flex flex-col gap-2 p-3 rounded-lg cursor-pointer border transition-colors ${mode === 'simulation' ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-500/50' : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                                    <div className="flex items-center gap-2 font-bold text-sm">
                                        <Zap size={16} className="text-blue-500" /> 
                                        {t.modeSim}
                                    </div>
                                    <input type="radio" checked={mode === 'simulation'} onChange={() => setMode('simulation')} className="sr-only" />
                                    <p className="text-[10px] text-gray-500 leading-tight">{t.modeSimDesc}</p>
                                </label>
                                <label className={`flex flex-col gap-2 p-3 rounded-lg cursor-pointer border transition-colors ${mode === 'offline' ? 'bg-gray-100 dark:bg-gray-700/30 border-gray-300 dark:border-gray-600' : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                                    <div className="flex items-center gap-2 font-bold text-sm">
                                        <WifiOff size={16} className="text-gray-500" /> 
                                        {t.modeOffline}
                                    </div>
                                    <input type="radio" checked={mode === 'offline'} onChange={() => setMode('offline')} className="sr-only" />
                                    <p className="text-[10px] text-gray-500 leading-tight">{t.modeOfflineDesc}</p>
                                </label>
                           </div>
                           
                           {/* DEBUG MODE TOGGLE */}
                           <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
                               <label className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer transition-colors">
                                   <Bug size={12} />
                                   <span>{t.debugMode}</span>
                                   <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${debugMode ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                                       <div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${debugMode ? 'translate-x-4' : ''}`} />
                                   </div>
                                   <input type="checkbox" checked={debugMode} onChange={(e) => setDebugMode(e.target.checked)} className="hidden" />
                               </label>
                           </div>
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
                                    
                                    {/* OFFICIAL TEMPLATES */}
                                    <div className="bg-gray-50 dark:bg-gray-900/50 px-4 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
                                        <Shield size={12} className="text-indigo-500" />
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{t.officialTemplates}</span>
                                    </div>
                                    {PRESET_TEAMS.map(template => (
                                        <div key={template.id} className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                                            <button onClick={() => handleLoadConfig(template)} className="flex-grow text-left p-3 font-medium text-sm flex flex-col outline-none focus:bg-gray-100 dark:focus:bg-gray-700 group">
                                                <span className="text-indigo-700 dark:text-indigo-300 group-hover:text-indigo-600 font-bold">{template.name}</span>
                                                <span className="text-xs text-gray-500 mt-0.5">{template.agents.length} Agents: {template.agents.map(a => a.name.split(' ')[0]).join(', ')}</span>
                                            </button>
                                        </div>
                                    ))}

                                    {/* USER SAVED */}
                                    {savedConfigs.length > 0 && (
                                        <>
                                            <div className="bg-gray-50 dark:bg-gray-900/50 px-4 py-2 border-y border-gray-100 dark:border-gray-700 flex items-center gap-2 mt-1">
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
                                </div>
                            )}
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
                       <div className="flex flex-col sm:flex-row gap-2 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-800">
                          <input value={topic} onChange={(e) => setTopic(e.target.value)} className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg p-3 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder={t.topicPlaceholder} />
                          <button onClick={handleAutoGenerateInCustomize} disabled={isGenerating || isOffline} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors disabled:opacity-50 disabled:bg-gray-400 dark:disabled:bg-gray-700" title={isOffline ? "Not available in offline mode" : ""}>
                             {isGenerating ? <div className="animate-spin"><Wand2 size={18} /></div> : <Wand2 size={18} />} {t.generateAgents}
                          </button>
                       </div>

                       {/* Global Model */}
                       <div className={`bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800/50 flex flex-col md:flex-row gap-4 items-center justify-between transition-opacity ${isOffline ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-white dark:bg-indigo-800 rounded-lg shadow-sm">
                                    <Bot size={20} className="text-indigo-600 dark:text-indigo-300" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-bold text-sm text-gray-800 dark:text-gray-200">{t.defaultModel}</span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">Also applies to new agents</span>
                                </div>
                            </div>
                            <div className="flex flex-1 w-full md:w-auto gap-2">
                                <div className="relative flex-1">
                                    <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} disabled={isOffline} className="w-full appearance-none bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 pr-8 shadow-sm outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-gray-900 dark:text-white cursor-pointer disabled:cursor-not-allowed">
                                        {MODEL_OPTIONS.map(opt => (
                                            <option key={opt.id} value={opt.id}>{t.modelNames?.[opt.id] || opt.id}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={16} />
                                </div>
                                <button onClick={applyModelToAllAgents} disabled={isOffline} className="flex items-center gap-1 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shadow-sm disabled:opacity-50 disabled:cursor-not-allowed" title={t.applyToAll}>
                                    <Copy size={14} /> <span className="hidden sm:inline">{t.applyToAll}</span>
                                </button>
                            </div>
                       </div>

                       {/* Agents Grid */}
                       <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          {agents.map((agent, idx) => (
                              <div key={agent.id} className="group relative border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 hover:shadow-lg transition-shadow overflow-hidden flex flex-col">
                                  <button onClick={() => handleRemoveAgent(idx)} className="absolute top-2 right-2 p-1.5 bg-gray-100 dark:bg-gray-700 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-full z-10 transition-colors opacity-0 group-hover:opacity-100" title="Remove Agent">
                                      <X size={14} />
                                  </button>

                                  <div className="p-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3 bg-gray-50 dark:bg-gray-800/80">
                                      <div className={`w-8 h-8 rounded-full flex-shrink-0 ${agent.avatarColor} shadow-inner`} />
                                      <input value={agent.name} onChange={(e) => handleAgentChange(idx, 'name', e.target.value)} className="flex-1 font-bold bg-transparent border-none p-0 focus:ring-0 text-gray-900 dark:text-white" placeholder="Agent Name" />
                                  </div>
                                  
                                  <div className="px-3 pt-3">
                                    <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Role</label>
                                    <input value={agent.role} onChange={(e) => handleAgentChange(idx, 'role', e.target.value)} className="w-full bg-transparent border-b border-gray-200 dark:border-gray-700 pb-1 mb-2 focus:border-indigo-500 outline-none text-sm text-gray-700 dark:text-gray-300" placeholder="e.g. Moderator, Critic" />
                                  </div>

                                  {/* NEW INTEREST FIELD */}
                                  <div className="px-3">
                                    <label className="text-[10px] uppercase font-bold text-purple-500 tracking-wider flex items-center gap-1">
                                        <Heart size={10} /> {t.agentInterest}
                                    </label>
                                    <input value={agent.interest || ''} onChange={(e) => handleAgentChange(idx, 'interest', e.target.value)} className="w-full bg-transparent border-b border-gray-200 dark:border-gray-700 pb-1 mb-2 focus:border-purple-500 outline-none text-sm text-gray-700 dark:text-gray-300" placeholder="e.g. Costs, UX, Ethics" />
                                  </div>

                                  <div className="flex-1 flex flex-col px-3 pb-3">
                                    <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-1">Instruction / Personality</label>
                                    <textarea value={agent.systemInstruction} onChange={(e) => handleAgentChange(idx, 'systemInstruction', e.target.value)} className="w-full text-sm leading-relaxed h-32 bg-gray-50 dark:bg-gray-900/50 p-3 rounded-lg resize-y border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all" placeholder="Describe how this agent should behave..." />
                                  </div>

                                   <div className={`px-3 pb-3 transition-opacity ${isOffline ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                                        <label className="text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-1 flex items-center gap-1">
                                            <Cpu size={10} /> Model
                                        </label>
                                        <div className="relative">
                                            <select value={agent.model || selectedModel} onChange={(e) => handleAgentChange(idx, 'model', e.target.value)} disabled={isOffline} className="w-full appearance-none bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs shadow-sm outline-none focus:ring-1 focus:ring-indigo-500 text-gray-900 dark:text-white cursor-pointer disabled:cursor-not-allowed">
                                                {MODEL_OPTIONS.map(opt => (
                                                    <option key={opt.id} value={opt.id}>{t.modelNames?.[opt.id] || opt.id}</option>
                                                ))}
                                            </select>
                                        </div>
                                   </div>
                              </div>
                          ))}
                          
                          <button onClick={() => {
                                const newAgent: Agent = {
                                    id: `custom-${Date.now()}`,
                                    name: "New Agent",
                                    role: "Participant",
                                    avatarColor: "bg-gray-500",
                                    systemInstruction: "You are a helpful assistant.",
                                    interest: "",
                                    model: selectedModel 
                                };
                                setAgents([...agents, newAgent]);
                            }} disabled={agents.length >= 7} className={`border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl flex flex-col items-center justify-center p-6 transition-all h-[300px] ${agents.length >= 7 ? 'opacity-50 cursor-not-allowed bg-gray-50 dark:bg-gray-900/30 text-gray-400' : 'text-gray-400 hover:text-indigo-500 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/10 cursor-pointer'}`}>
                              {agents.length >= 7 ? (
                                  <>
                                    <AlertCircle size={40} />
                                    <span className="font-bold mt-2">Max 7 Agents</span>
                                  </>
                              ) : (
                                  <>
                                    <Plus size={40} />
                                    <span className="font-bold mt-2">Add Agent</span>
                                  </>
                              )}
                          </button>
                       </div>
                   </div>
                   
                   <div className="p-4 border-t border-gray-200 dark:border-gray-800 bg-white/90 dark:bg-gray-900/90 backdrop-blur-md rounded-b-2xl flex flex-col items-center justify-center flex-shrink-0 gap-2">
                      {!isValidTeamSize && (
                          <div className="text-red-500 text-sm font-semibold flex items-center gap-2 animate-pulse">
                              <AlertTriangle size={16} />
                              Team size must be between 3 and 7 members.
                          </div>
                      )}
                      <button onClick={handleStartCustomMeeting} disabled={!isValidTeamSize || isGenerating} className="px-12 py-4 bg-green-600 text-white rounded-full font-bold text-lg flex items-center gap-2 hover:bg-green-500 shadow-xl shadow-green-900/20 hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:shadow-none">
                         {isGenerating ? <div className="animate-spin"><Wand2 size={24} /></div> : <Play size={24} fill="currentColor" />}
                         {isGenerating ? "Preparing..." : t.start}
                      </button>
                   </div>
                </div>
            )}
        </div>
      </div>
      {/* Save Modal */}
      {showSaveModal && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm border border-gray-200 dark:border-gray-700 scale-100">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold text-lg">{t.save}</h3>
                      <button onClick={() => setShowSaveModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                  </div>
                  <input autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. Product Launch Team" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg p-3 bg-gray-50 dark:bg-gray-900 focus:ring-2 focus:ring-indigo-500 outline-none mb-4" />
                  <div className="flex gap-2 justify-end">
                      <button onClick={() => setShowSaveModal(false)} className="px-4 py-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
                      <button onClick={handleSaveConfig} disabled={!saveName.trim()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50">Save</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};