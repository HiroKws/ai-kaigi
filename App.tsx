import React, { useState, useMemo, useEffect } from 'react';
import { Play, Pause, Send, MessageSquare, Mic2, User, FileText, Paperclip, X, Eye, Save, Hand, ShieldAlert } from 'lucide-react';
import { LANGUAGES, TRANSLATIONS, MODEL_OPTIONS, DEFAULT_MODEL } from './constants';
import { Agent, MeetingMode, Attachment, SavedConfig, UsageStats } from './types';
import { getMeetingBackend } from './services/geminiService';
import { useMeeting } from './hooks/useMeeting';
import { ChatLog } from './components/ChatLog';
import { SetupScreen } from './components/SetupScreen';
import { ErrorBanner } from './components/ErrorBanner';
import { StatsDisplay } from './components/StatsDisplay';

const App: React.FC = () => {
  // Global Settings
  const [langCode, setLangCode] = useState(() => {
    if (typeof window !== 'undefined' && window.navigator) {
      try {
        const browserLang = window.navigator.language.split('-')[0];
        if (LANGUAGES.some(l => l.code === browserLang)) return browserLang;
      } catch (e) {}
    }
    return 'en';
  });

  const t = TRANSLATIONS[langCode] || TRANSLATIONS['en'];
  const [view, setView] = useState<'setup' | 'meeting'>('setup');
  const [showLog, setShowLog] = useState(false); // Toggle between Room view and Log view
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [isBoardHovered, setIsBoardHovered] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  
  // Initialize backend based on mode
  const [mode, setMode] = useState<MeetingMode>('multi-agent');
  const backend = useMemo(() => getMeetingBackend(mode), [mode]);

  // Global Stats State
  const [globalUsageStats, setGlobalUsageStats] = useState<UsageStats>({
    total: { apiCalls: 0, inputTokens: 0, outputTokens: 0 },
    byModel: {}
  });

  // Poll for stats updates
  useEffect(() => {
    const interval = setInterval(() => {
        setGlobalUsageStats(backend.getStats());
    }, 1000); 
    return () => clearInterval(interval);
  }, [backend]);

  // Hook handles all meeting logic
  const {
    agents, messages, whiteboardData,
    isActive, isPaused, setIsPaused, error, currentSpeakerId, handRaisedQueue, agentActiveModels,
    startMeeting, stopMeeting, togglePause, addMessage, addFiles
  } = useMeeting(backend, langCode, debugMode);

  const [pendingStart, setPendingStart] = useState<{topic: string, agents: Agent[], files: Attachment[], model: string} | null>(null);

  // Handle Resize for Mobile View
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleStartMeeting = (newTopic: string, selectedAgents: Agent[], selectedMode: MeetingMode, initialFiles: Attachment[], defaultModel: string) => {
    setMode(selectedMode);
    setView('meeting');
    setPendingStart({ topic: newTopic, agents: selectedAgents, files: initialFiles, model: defaultModel });
  };

  const handleSaveTeam = () => {
     if (!saveName.trim()) return;
     const newConfig: SavedConfig = {
         id: Date.now().toString(),
         name: saveName,
         agents: agents,
         updatedAt: Date.now()
     };
     
     const saved = localStorage.getItem('meeting_saved_configs');
     let currentList: SavedConfig[] = [];
     if (saved) {
         try {
             currentList = JSON.parse(saved);
         } catch (e) {}
     }
     
     const updatedList = [newConfig, ...currentList];
     localStorage.setItem('meeting_saved_configs', JSON.stringify(updatedList));
     
     setShowSaveModal(false);
     setSaveName('');
     alert("Team configuration saved!");
  };

  React.useEffect(() => {
    if (pendingStart && view === 'meeting') {
      startMeeting(pendingStart.topic, pendingStart.agents, pendingStart.files, pendingStart.model);
      setPendingStart(null);
    }
  }, [pendingStart, view, startMeeting]);

  const handleUserMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.userMsg.value;
    if (!input.trim()) return;
    addMessage('user', input);
    form.reset();
    
    // Auto resume if it was auto-paused
    if (isActive && isPaused) {
        setIsPaused(false);
    }
  };

  const handleInputFocus = () => {
      // Auto pause when user starts typing to prevent interruption
      if (isActive && !isPaused) {
          setIsPaused(true);
      }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files;
      if (!selected) return;

      Array.from(selected).forEach((file: File) => {
          const reader = new FileReader();
          reader.onloadend = () => {
              if (reader.result) {
                  addFiles([{
                      name: file.name,
                      mimeType: file.type,
                      data: reader.result as string
                  }]);
              }
          };
          reader.readAsDataURL(file);
      });
  };

  const endMeeting = () => {
    stopMeeting();
    setView('setup');
    setShowLog(false);
  };

  // Helper to get latest message for a specific agent
  const getLatestMessage = (agentId: string) => {
      // iterate backwards
      for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].agentId === agentId) return messages[i].text;
      }
      return null;
  };

  // Helper to convert bg-color-500 to border-color-500
  const getBorderClass = (bgClass: string) => {
      if (bgClass.startsWith('bg-')) {
          return bgClass.replace('bg-', 'border-');
      }
      return 'border-gray-300';
  };
  
  const getTextClass = (bgClass: string) => {
      if (bgClass.startsWith('bg-')) {
          return bgClass.replace('bg-', 'text-');
      }
      return 'text-gray-500';
  };

  // Helper to display model label
  const getModelLabel = (modelId: string) => {
      return MODEL_OPTIONS.find(m => m.id === modelId)?.label || 'Unknown';
  };

  // Organize agents for UI
  const leftAgents = agents.filter((_, i) => i % 2 === 0);
  const rightAgents = agents.filter((_, i) => i % 2 !== 0);
  const isModeratorSpeaking = currentSpeakerId === 'ai-moderator';

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans transition-colors duration-300 relative overflow-hidden">
      
      {/* Background Ambience */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-50 via-gray-100 to-white dark:from-gray-800 dark:via-gray-900 dark:to-black pointer-events-none" />

      {/* Global Error Banner (Positioned absolute in App container) */}
      <ErrorBanner message={error || ''} />

      {view === 'setup' ? (
        <div className="flex-1 w-full h-full overflow-hidden relative z-10">
          <SetupScreen 
            onStartMeeting={handleStartMeeting} 
            langCode={langCode}
            setLangCode={setLangCode}
            debugMode={debugMode}
            setDebugMode={setDebugMode}
          />
        </div>
      ) : (
        <>
            {/* MEETING VIEW TOP BAR */}
            <div className="absolute top-0 left-0 w-full z-30 p-4 flex justify-between items-start pointer-events-none">
              <div className="flex gap-2 pointer-events-auto">
                  {!isMobile && (
                      <button onClick={() => setShowLog(!showLog)} className="bg-white/80 dark:bg-black/40 backdrop-blur-md border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/10 text-gray-700 dark:text-white px-4 py-2 rounded-full flex items-center gap-2 text-sm font-medium transition-colors shadow-sm">
                          {showLog ? <Eye size={16} /> : <MessageSquare size={16} />}
                          {showLog ? t.viewRoom : t.viewLog}
                      </button>
                  )}
              </div>
              
              <div className="flex gap-2 pointer-events-auto">
                  <button onClick={() => setShowSaveModal(true)} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-full text-sm font-bold transition-colors backdrop-blur-md flex items-center gap-2 shadow-sm">
                      <Save size={16} /> <span className="hidden sm:inline">{t.saveTeam}</span>
                  </button>
                  <button onClick={endMeeting} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-full text-sm font-bold transition-colors backdrop-blur-md shadow-sm">
                      {t.endMeeting}
                  </button>
              </div>
            </div>

            {/* MAIN MEETING ROOM AREA (Hidden on Mobile) */}
            {!showLog && !isMobile && (
              <div className="flex-1 relative z-10 flex flex-col items-center justify-center p-4 pt-16 pb-32 h-full">
                  
                  {/* CENTER: WHITEBOARD IMAGE */}
                  <div className={`absolute inset-4 md:inset-0 flex items-center justify-center pointer-events-none transition-all duration-300 ${isBoardHovered ? 'z-50' : 'z-0'}`}>
                      <div 
                          className="relative aspect-video bg-white dark:bg-gray-800 rounded-lg shadow-xl border-4 border-gray-200 dark:border-gray-700 overflow-hidden flex items-center justify-center transition-all duration-300 transform pointer-events-auto
                          w-full md:w-[95vw] md:max-w-none lg:w-[33.33vw] lg:max-w-none"
                          onMouseEnter={() => setIsBoardHovered(true)}
                          onMouseLeave={() => setIsBoardHovered(false)}
                      >
                          {whiteboardData.imageUrl ? (
                              <img src={whiteboardData.imageUrl} alt="Whiteboard" className="w-full h-full object-cover" />
                          ) : (
                              <div className="text-gray-400 dark:text-gray-600 flex flex-col items-center">
                                  <FileText size={48} className="mb-2 opacity-50" />
                                  <p>{t.emptyWhiteboard}</p>
                              </div>
                          )}
                          
                          {whiteboardData.isGenerating && (
                              <div className="absolute inset-0 bg-white/50 dark:bg-black/50 backdrop-blur-sm flex items-center justify-center">
                                  <div className="bg-white dark:bg-gray-800 px-6 py-3 rounded-full flex items-center gap-3 border border-gray-200 dark:border-white/20 animate-pulse shadow-lg">
                                      <div className="w-2 h-2 bg-indigo-500 dark:bg-white rounded-full animate-bounce" />
                                      <span className="text-gray-700 dark:text-white font-mono text-sm">{t.writing}</span>
                                  </div>
                              </div>
                          )}
                      </div>
                  </div>

                  {/* TOP: Moderator */}
                  <div className={`absolute top-16 left-1/2 -translate-x-1/2 flex flex-col items-center z-20 transition-all duration-500 ${isModeratorSpeaking ? 'scale-110' : 'opacity-70 scale-90'}`}>
                      <div className={`relative w-16 h-16 rounded-full bg-indigo-100 dark:bg-indigo-900 border-2 flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.3)] ${isModeratorSpeaking ? 'border-indigo-500' : 'border-indigo-200 dark:border-indigo-800'}`}>
                          {/* Thinking Spinner for Moderator */}
                          {isModeratorSpeaking && <div className="absolute inset-0 rounded-full border-2 border-t-indigo-500 dark:border-t-white border-transparent animate-spin" />}
                          <Mic2 size={32} className="text-indigo-600 dark:text-indigo-200" />
                      </div>
                      <div className="mt-2 bg-white/80 dark:bg-black/60 backdrop-blur px-3 py-1 rounded-full text-xs font-bold text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30 shadow-sm">
                          {t.moderator}
                      </div>
                      {/* Moderator Bubble */}
                      {(isModeratorSpeaking || getLatestMessage('ai-moderator')) && (
                          <div className="absolute top-20 w-[400px] bg-white dark:bg-indigo-900/90 text-gray-800 dark:text-indigo-100 p-5 rounded-2xl text-base shadow-xl text-center border border-indigo-100 dark:border-indigo-500/50 animate-in fade-in zoom-in slide-in-from-top-4 z-50">
                              {isModeratorSpeaking ? (
                                  <span className="text-gray-400 dark:text-gray-400 italic animate-pulse">{t.thinking}</span>
                              ) : (
                                  getLatestMessage('ai-moderator')
                              )}
                          </div>
                      )}
                  </div>

                  {/* LEFT SIDE AGENTS */}
                  <div className="absolute left-6 top-32 bottom-32 flex flex-col justify-evenly w-auto pointer-events-none">
                      {leftAgents.map(agent => {
                          const isSpeaking = currentSpeakerId === agent.id;
                          const latestMsg = getLatestMessage(agent.id);
                          const borderClass = getBorderClass(agent.avatarColor);
                          const textClass = getTextClass(agent.avatarColor);
                          const isHandRaised = handRaisedQueue.includes(agent.id);
                          const activeModel = agentActiveModels[agent.id];
                          const isDowngraded = activeModel && activeModel !== (agent.model || DEFAULT_MODEL);
                          
                          // Show bubble if speaking OR has a previous message
                          const showBubble = isSpeaking || latestMsg;

                          return (
                              <div key={agent.id} className={`group relative flex items-center transition-all duration-500 pointer-events-auto ${isSpeaking ? 'translate-x-4 scale-105' : 'opacity-80 hover:opacity-100'}`}>
                                  {/* Tooltip */}
                                  <div className="absolute left-20 ml-1 w-64 p-3 bg-white dark:bg-black/90 text-gray-800 dark:text-gray-200 text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 border border-gray-200 dark:border-gray-700 shadow-xl backdrop-blur-md">
                                      <div className="font-bold text-gray-900 dark:text-white mb-1 border-b border-gray-200 dark:border-gray-700 pb-1">{agent.name}</div>
                                      <div className="italic text-gray-500 dark:text-gray-400">{agent.role}</div>
                                      <div className="text-purple-400 mt-1 flex gap-1"><Hand size={10} /> {agent.interest}</div>
                                      <div className="mt-2 text-[10px] leading-relaxed line-clamp-6">{agent.systemInstruction}</div>
                                  </div>

                                  <div className="relative">
                                      <div className={`relative flex-shrink-0 w-16 h-16 rounded-full ${agent.avatarColor} border-4 ${isSpeaking ? 'border-white dark:border-white shadow-[0_0_15px_rgba(0,0,0,0.2)] dark:shadow-[0_0_15px_rgba(255,255,255,0.4)]' : 'border-gray-100 dark:border-gray-800'} flex items-center justify-center text-white font-bold shadow-lg z-20`}>
                                          {isSpeaking && <div className="absolute -inset-1 rounded-full border-4 border-t-white border-transparent animate-spin z-30" />}
                                          {agent.name.charAt(0)}
                                          
                                          {/* Hand Raised Indicator */}
                                          {isHandRaised && (
                                              <div className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 p-1 rounded-full shadow-lg animate-bounce z-40 border-2 border-white dark:border-gray-900">
                                                  <Hand size={14} />
                                              </div>
                                          )}
                                      </div>
                                      {/* Downgrade Indicator */}
                                      {isDowngraded && (
                                          <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-orange-100 dark:bg-orange-900/80 text-orange-600 dark:text-orange-200 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-orange-200 dark:border-orange-700 whitespace-nowrap shadow-sm flex items-center gap-1 z-30" title={t.downgradeAlert}>
                                              <ShieldAlert size={8} />
                                              {getModelLabel(activeModel)}
                                          </div>
                                      )}
                                  </div>
                                  
                                  {showBubble && (
                                      <div className={`absolute left-14 md:left-24 ml-4 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 p-4 lg:p-4 rounded-3xl rounded-tl-none shadow-xl text-sm lg:text-base z-30 
                                          w-[calc(45vw_-_5rem)] min-w-[calc(45vw_-_5rem)] max-w-none
                                          lg:w-[calc(33vw_-_9rem)] lg:min-w-0 lg:max-w-none
                                          border-2 ${borderClass} animate-in fade-in slide-in-from-left-4 ${isSpeaking ? 'ring-2 ring-indigo-500/50' : ''}`}>
                                          <span className={`block font-bold text-xs mb-1 ${textClass}`}>{agent.name}</span>
                                          {isSpeaking ? (
                                              <span className="text-gray-400 dark:text-gray-500 italic animate-pulse text-sm block mt-1">{t.thinking}</span>
                                          ) : (
                                              latestMsg
                                          )}
                                      </div>
                                  )}
                              </div>
                          );
                      })}
                  </div>

                  {/* RIGHT SIDE AGENTS */}
                  <div className="absolute right-6 top-32 bottom-32 flex flex-col justify-evenly w-auto items-end pointer-events-none">
                      {rightAgents.map(agent => {
                          const isSpeaking = currentSpeakerId === agent.id;
                          const latestMsg = getLatestMessage(agent.id);
                          const borderClass = getBorderClass(agent.avatarColor);
                          const textClass = getTextClass(agent.avatarColor);
                          const isHandRaised = handRaisedQueue.includes(agent.id);
                          const activeModel = agentActiveModels[agent.id];
                          const isDowngraded = activeModel && activeModel !== (agent.model || DEFAULT_MODEL);
                          
                          // Show bubble if speaking OR has a previous message
                          const showBubble = isSpeaking || latestMsg;

                          return (
                              <div key={agent.id} className={`group relative flex flex-row-reverse items-center transition-all duration-500 pointer-events-auto ${isSpeaking ? '-translate-x-4 scale-105' : 'opacity-80 hover:opacity-100'}`}>
                                  {/* Tooltip */}
                                  <div className="absolute right-20 mr-1 w-64 p-3 bg-white dark:bg-black/90 text-gray-800 dark:text-gray-200 text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 border border-gray-200 dark:border-gray-700 shadow-xl backdrop-blur-md text-right">
                                      <div className="font-bold text-gray-900 dark:text-white mb-1 border-b border-gray-200 dark:border-gray-700 pb-1">{agent.name}</div>
                                      <div className="italic text-gray-500 dark:text-gray-400">{agent.role}</div>
                                      <div className="text-purple-400 mt-1 flex justify-end gap-1"><Hand size={10} /> {agent.interest}</div>
                                      <div className="mt-2 text-[10px] leading-relaxed line-clamp-6">{agent.systemInstruction}</div>
                                  </div>

                                  <div className="relative">
                                      <div className={`relative flex-shrink-0 w-16 h-16 rounded-full ${agent.avatarColor} border-4 ${isSpeaking ? 'border-white dark:border-white shadow-[0_0_15px_rgba(0,0,0,0.2)] dark:shadow-[0_0_15px_rgba(255,255,255,0.4)]' : 'border-gray-100 dark:border-gray-800'} flex items-center justify-center text-white font-bold shadow-lg z-20`}>
                                          {isSpeaking && <div className="absolute -inset-1 rounded-full border-4 border-t-white border-transparent animate-spin z-30" />}
                                          {agent.name.charAt(0)}
                                          
                                          {/* Hand Raised Indicator */}
                                          {isHandRaised && (
                                              <div className="absolute -top-2 -left-2 bg-yellow-400 text-yellow-900 p-1 rounded-full shadow-lg animate-bounce z-40 border-2 border-white dark:border-gray-900">
                                                  <Hand size={14} />
                                              </div>
                                          )}
                                      </div>
                                      {/* Downgrade Indicator */}
                                      {isDowngraded && (
                                          <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-orange-100 dark:bg-orange-900/80 text-orange-600 dark:text-orange-200 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-orange-200 dark:border-orange-700 whitespace-nowrap shadow-sm flex items-center gap-1 z-30" title={t.downgradeAlert}>
                                              <ShieldAlert size={8} />
                                              {getModelLabel(activeModel)}
                                          </div>
                                      )}
                                  </div>
                                  
                                  {showBubble && (
                                      <div className={`absolute right-14 md:right-24 mr-4 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 p-4 lg:p-4 rounded-3xl rounded-tr-none shadow-xl text-sm lg:text-base z-30 
                                          w-[calc(45vw_-_5rem)] min-w-[calc(45vw_-_5rem)] max-w-none
                                          lg:w-[calc(33vw_-_9rem)] lg:min-w-0 lg:max-w-none
                                          border-2 ${borderClass} animate-in fade-in slide-in-from-right-4 ${isSpeaking ? 'ring-2 ring-indigo-500/50' : ''}`}>
                                          <span className={`block font-bold text-xs mb-1 text-right ${textClass}`}>{agent.name}</span>
                                          {isSpeaking ? (
                                              <span className="text-gray-400 dark:text-gray-500 italic animate-pulse text-sm block mt-1">{t.thinking}</span>
                                          ) : (
                                              latestMsg
                                          )}
                                      </div>
                                  )}
                              </div>
                          );
                      })}
                  </div>
              </div>
            )}

            {/* LOG VIEW */}
            {(showLog || isMobile) && (
              <div className="flex-1 z-10 p-4 pt-16 pb-32 overflow-hidden flex flex-col items-center">
                  <div className="w-full max-w-3xl flex-1 bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col shadow-xl mb-4">
                      <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 font-bold text-center text-gray-700 dark:text-gray-200">
                          Session Log
                      </div>
                      <ChatLog messages={messages} agents={agents} />
                  </div>
                  
                  {isMobile && (
                      <div className="w-full h-64 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex-shrink-0 relative">
                          {whiteboardData.imageUrl ? (
                              <img src={whiteboardData.imageUrl} alt="Whiteboard" className="w-full h-full object-cover" />
                          ) : (
                              <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-600">
                                  <FileText size={32} className="mb-2 opacity-50" />
                                  <p className="text-sm">{t.emptyWhiteboard}</p>
                              </div>
                          )}
                          <div className="absolute top-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">Whiteboard</div>
                      </div>
                  )}
              </div>
            )}

            {/* BOTTOM CONTROLS (Fixed) */}
            <div className="absolute bottom-0 left-0 w-full z-40 bg-gradient-to-t from-white via-gray-50 to-transparent dark:from-black dark:via-gray-900 pt-12 pb-6 px-4">
                <div className="max-w-3xl mx-auto flex flex-col gap-4">
                    
                    {/* User Representation (Center) */}
                    {!showLog && !isMobile && (
                        <div className="flex flex-col items-center justify-center -mb-8 relative z-10">
                            {/* User Bubble */}
                            {getLatestMessage('user') && (
                                <div className="mb-4 bg-indigo-600 text-white p-4 rounded-2xl rounded-br-none shadow-xl text-base z-30 w-fit max-w-[80vw] md:max-w-[600px] animate-in fade-in slide-in-from-bottom-4 border-2 border-indigo-400">
                                    <span className="block font-bold text-xs mb-1 text-right text-indigo-200">{t.you}</span>
                                    {getLatestMessage('user')}
                                </div>
                            )}

                            <div className="w-16 h-16 rounded-full bg-indigo-600 border-4 border-gray-100 dark:border-gray-900 shadow-2xl flex items-center justify-center text-white transform hover:scale-105 transition-transform cursor-default">
                                <User size={32} />
                            </div>
                        </div>
                    )}

                    {/* Input Area */}
                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-2 shadow-2xl relative z-0 flex flex-col gap-2">
                        <form onSubmit={handleUserMessage} className="flex items-center gap-2">
                            <label className="p-3 text-gray-400 hover:text-gray-600 dark:hover:text-white cursor-pointer transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
                                <Paperclip size={20} />
                                <input type="file" multiple className="hidden" onChange={handleFileUpload} />
                            </label>
                            
                            <input 
                              name="userMsg" 
                              placeholder={t.chatPlaceholder}
                              className="flex-1 bg-transparent border-none text-gray-900 dark:text-white focus:ring-0 placeholder-gray-400 dark:placeholder-gray-500 text-lg py-2"
                              autoComplete="off"
                              onFocus={handleInputFocus}
                            />
                            
                            <button 
                              type="button" 
                              onClick={togglePause}
                              className={`p-3 rounded-full ${isPaused ? 'bg-green-600 hover:bg-green-500' : 'bg-yellow-500 hover:bg-yellow-400'} text-white transition-all shadow-sm`}
                            >
                              {isPaused ? <Play size={20} fill="currentColor" /> : <Pause size={20} fill="currentColor" />}
                            </button>

                            <button 
                              type="submit"
                              className="p-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full transition-all shadow-lg shadow-indigo-900/20"
                            >
                                <Send size={20} />
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </>
      )}

      {/* Global Stats - Always Visible */}
      <StatsDisplay stats={globalUsageStats} langCode={langCode} isMobile={isMobile} />

      {/* Save Modal */}
       {showSaveModal && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm border border-gray-200 dark:border-gray-700 scale-100">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold text-lg text-gray-900 dark:text-white">{t.save}</h3>
                      <button onClick={() => setShowSaveModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={20}/></button>
                  </div>
                  <input 
                    autoFocus
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="e.g. Current Team Snapshot"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg p-3 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none mb-4"
                  />
                  <div className="flex gap-2 justify-end">
                      <button onClick={() => setShowSaveModal(false)} className="px-4 py-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
                      <button onClick={handleSaveTeam} disabled={!saveName.trim()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50">Save</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default App;