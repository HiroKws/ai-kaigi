import { useState, useRef, useCallback, useEffect } from 'react';
import { Agent, Message, WhiteboardData, MeetingBackend, Attachment, UsageStats } from '../types';
import { INITIAL_WHITEBOARD_STATE, DEFAULT_MODEL, MODEL_SHORT_NAMES } from '../constants';

// Helper to generate localized kickoff message without API call
const getKickoffMessage = (lang: string, topic: string, firstAgent: Agent) => {
    if (lang === 'ja') {
        return `テーマは「${topic}」です。まずは、皆さんのご意見を順番にお聞きしたいと思います。では、${firstAgent.role}の${firstAgent.name}さん。お願いします。`;
    }
    return `The topic is "${topic}". Let's start by hearing initial thoughts from everyone in turn. We'll start with ${firstAgent.name} (${firstAgent.role}). Please go ahead.`;
};

// Calculate reading time: 50ms per character + 1.5s base buffer
const calculateReadingTime = (text: string) => {
    const baseDelay = 1500;
    const charDelay = 50; 
    return Math.max(3000, Math.min(15000, baseDelay + (text.length * charDelay)));
};

export const useMeeting = (backend: MeetingBackend, langCode: string, debugMode: boolean) => {
  const [topic, setTopic] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [whiteboardData, setWhiteboardData] = useState<WhiteboardData>(INITIAL_WHITEBOARD_STATE);
  const [defaultModel, setDefaultModel] = useState<string>(DEFAULT_MODEL);
  
  // Track which model was actually used for each agent's last turn
  const [agentActiveModels, setAgentActiveModels] = useState<Record<string, string>>({});
  
  // Initialize stats with current global values from backend to capture preparation costs
  const [stats, setStats] = useState<UsageStats>(() => backend.getStats());
  
  const [isActive, setIsActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(''); 
  
  const [currentSpeakerId, setCurrentSpeakerId] = useState<string | null>(null);
  const [nextSpeakerId, setNextSpeakerId] = useState<string | null>(null);
  const [handRaisedQueue, setHandRaisedQueue] = useState<string[]>([]);
  
  // Internal State
  const [turnPhase, setTurnPhase] = useState<'start' | 'intro' | 'moderating' | 'speaking'>('start');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const introIndexRef = useRef(0);

  // --- STABLE STATE REFERENCES ---
  // IMPORTANT: Include isActive, isPaused, debugMode here so processTurn can access the LATEST value 
  // without needing to be re-created or depending on closure variables.
  const stateRef = useRef({ 
      messages, agents, files, turnPhase, nextSpeakerId, handRaisedQueue, topic, defaultModel,
      isActive, isPaused, debugMode 
  });
  
  useEffect(() => {
    stateRef.current = { 
        messages, agents, files, turnPhase, nextSpeakerId, handRaisedQueue, topic, defaultModel,
        isActive, isPaused, debugMode 
    };
  }, [messages, agents, files, turnPhase, nextSpeakerId, handRaisedQueue, topic, defaultModel, isActive, isPaused, debugMode]);


  // --- ACTIONS ---

  const addMessage = useCallback((agentId: string, text: string) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), agentId, text, timestamp: Date.now() }]);
  }, []);

  const addFiles = useCallback((newFiles: Attachment[]) => {
      setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const startMeeting = useCallback((newTopic: string, team: Agent[], initialFiles: Attachment[] = [], model: string = DEFAULT_MODEL) => {
    setTopic(newTopic);
    setAgents(team);
    setFiles(initialFiles);
    setDefaultModel(model);
    setMessages([{ id: 'init', agentId: 'user', text: `Topic: ${newTopic}`, timestamp: Date.now() }]);
    setWhiteboardData(INITIAL_WHITEBOARD_STATE);
    setIsActive(true);
    setIsPaused(false);
    setError(null);
    setTurnPhase('start'); 
    introIndexRef.current = 0;
    setHandRaisedQueue([]);
    setStatus('Meeting started');
    setAgentActiveModels({});
    setStats(backend.getStats()); 
  }, [backend]);

  const stopMeeting = useCallback(() => {
    setIsActive(false);
    setIsPaused(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setStatus('Meeting ended');
  }, []);

  const togglePause = useCallback(() => {
    setIsPaused(prev => !prev);
  }, []);

  const syncStats = useCallback(() => {
      setStats(backend.getStats());
  }, [backend]);

  // --- MEETING LOOP ---

  const processTurn = useCallback(async () => {
    // 1. Check latest state via Ref immediately
    // If paused or inactive, STOP. Do not proceed.
    const state = stateRef.current;
    if (!state.isActive || state.isPaused) {
        timerRef.current = null;
        return;
    }
    
    // Access latest data from Ref
    const { messages, agents, files, turnPhase, nextSpeakerId, handRaisedQueue, topic, defaultModel, debugMode } = state;
    
    setError(null);

    try {
      if (turnPhase === 'start') {
          // Moderator Kickoff Phase
          if (agents.length > 0) {
              const kickoffMsg = getKickoffMessage(langCode, topic, agents[0]);
              addMessage('ai-moderator', kickoffMsg);
              setStatus('Moderator introduced the session.');
              
              setTurnPhase('intro');
              const readTime = calculateReadingTime(kickoffMsg);
              
              // Check Ref again before scheduling next step (in case paused during execution)
              if (stateRef.current.isActive && !stateRef.current.isPaused) {
                 timerRef.current = setTimeout(processTurn, readTime); 
              }
          } else {
               setTurnPhase('moderating'); // Fallback if no agents
               if (stateRef.current.isActive && !stateRef.current.isPaused) {
                 timerRef.current = setTimeout(processTurn, 100);
               }
          }

      } else if (turnPhase === 'intro') {
          // Round Robin Intro
          const idx = introIndexRef.current;
          if (idx < agents.length) {
             const agent = agents[idx];
             setStatus(`${agent.name} is introducing themselves...`);
             setCurrentSpeakerId(agent.id);
             
             let text = "";
             let usedModel = "";
             
             if (agent.initialMessage) {
                 text = agent.initialMessage;
                 // Use the stored model from generation, OR fallback to assigned/default
                 usedModel = agent.initialMessageModel || agent.model || defaultModel;
             } else {
                 const response = await backend.generateAgentResponse(agent, topic, messages, agents, langCode, files);
                 text = response.text;
                 usedModel = response.usedModel;
                 syncStats();
             }

             if (usedModel) {
                 setAgentActiveModels(prev => ({ ...prev, [agent.id]: usedModel }));
                 // Append debug info if enabled
                 if (debugMode) {
                     const shortName = MODEL_SHORT_NAMES[usedModel] || usedModel;
                     text += ` [${shortName}]`;
                 }
             }

             addMessage(agent.id, text);
             setCurrentSpeakerId(null);
             introIndexRef.current += 1;
             
             // Dynamic delay based on text length
             const readTime = calculateReadingTime(text);
             
             if (stateRef.current.isActive && !stateRef.current.isPaused) {
                timerRef.current = setTimeout(processTurn, readTime); 
             }
          } else {
             // Intro done, switch to normal moderation
             setTurnPhase('moderating');
             if (stateRef.current.isActive && !stateRef.current.isPaused) {
                timerRef.current = setTimeout(processTurn, 1000);
             }
          }

      } else if (turnPhase === 'moderating') {
        setStatus('Moderator thinking...');
        // Pass handRaisedQueue to moderator
        const response = await backend.generateModeratorTurn(topic, messages, agents, langCode, files, defaultModel, handRaisedQueue);
        const { nextSpeakerId: nextId, moderationText, usedModel } = response;
        syncStats();
        
        let finalText = moderationText;
        if (debugMode && usedModel) {
            const shortName = MODEL_SHORT_NAMES[usedModel] || usedModel;
            finalText += ` [${shortName}]`;
        }

        addMessage('ai-moderator', finalText);
        setNextSpeakerId(nextId);
        
        // If the selected speaker was in the queue, remove them
        setHandRaisedQueue(prev => prev.filter(id => id !== nextId));
        
        setTurnPhase('speaking');
        const readTime = calculateReadingTime(finalText);
        
        if (stateRef.current.isActive && !stateRef.current.isPaused) {
           timerRef.current = setTimeout(processTurn, readTime);
        }

      } else if (turnPhase === 'speaking' && nextSpeakerId) {
        const agent = agents.find(a => a.id === nextSpeakerId);
        if (agent) {
          setStatus(`${agent.name} thinking...`);
          setCurrentSpeakerId(agent.id);
          
          const response = await backend.generateAgentResponse(agent, topic, messages, agents, langCode, files);
          syncStats();
          
          let finalText = response.text;
          if (debugMode && response.usedModel) {
              const shortName = MODEL_SHORT_NAMES[response.usedModel] || response.usedModel;
              finalText += ` [${shortName}]`;
          }

          addMessage(agent.id, finalText);
          
          setAgentActiveModels(prev => ({ ...prev, [agent.id]: response.usedModel }));
          
          setCurrentSpeakerId(null);
          
          const lastMsg = { id: 'temp', agentId: agent.id, text: response.text, timestamp: Date.now() };
          setStatus('Checking for reactions...');
          try {
              const reactedIds = await backend.checkForHandRaises(lastMsg, agents, langCode);
              syncStats();
              if (reactedIds.length > 0) {
                  setHandRaisedQueue(prev => {
                      const newIds = reactedIds.filter(id => !prev.includes(id) && id !== agent.id && id !== nextSpeakerId);
                      return [...prev, ...newIds];
                  });
              }
          } catch(e) {
              console.warn("Reaction check failed", e);
          }
          
          setTurnPhase('moderating');
          setNextSpeakerId(null);
          
          const readTime = calculateReadingTime(response.text);
          
          if (stateRef.current.isActive && !stateRef.current.isPaused) {
            timerRef.current = setTimeout(processTurn, readTime);
          }
        } else {
            // Fallback if agent not found
            setTurnPhase('moderating');
            setNextSpeakerId(null);
            if (stateRef.current.isActive && !stateRef.current.isPaused) {
                timerRef.current = setTimeout(processTurn, 1000);
            }
        }
      }
    } catch (e: any) {
      console.error("Meeting Loop Error:", e);
      setError(e.message || "An error occurred");
      // CRITICAL: Pause execution but DO NOT stop meeting (clear state).
      // This allows user to save the team or read logs.
      setIsPaused(true); 
    }
  }, [backend, langCode, addMessage, syncStats]); 
  // No state dependencies here. Uses Ref.

  // --- CONTROL EFFECT ---
  useEffect(() => {
    // If active and NOT paused, ensure the loop is running
    if (isActive && !isPaused) {
        if (!timerRef.current) {
            // Start the loop
            timerRef.current = setTimeout(processTurn, 1000);
        }
    } 
    // If paused or inactive, ensure timer is cleared
    else {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }
    
    // Cleanup on unmount
    return () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };
  }, [isActive, isPaused, processTurn]);

  // --- WHITEBOARD LOOP ---
  useEffect(() => {
    // Whiteboard updates are currently DISABLED per user request.
    /*
    if (messages.length > 3 && messages.length % 4 === 0) {
      setWhiteboardData(prev => ({ ...prev, isGenerating: true }));
      const isDark = document.documentElement.classList.contains('dark') || window.matchMedia('(prefers-color-scheme: dark)').matches;
      
      backend.updateWhiteboard(topic, messages, agents, langCode, isDark)
        .then((data) => {
            setWhiteboardData(data);
            syncStats();
        })
        .catch(console.error);
    }
    */
  }, [messages.length, topic, agents, langCode, backend, syncStats]);

  return {
    topic,
    agents,
    messages,
    whiteboardData,
    stats,
    isActive,
    isPaused,
    setIsPaused,
    error,
    status,
    currentSpeakerId,
    nextSpeakerId,
    handRaisedQueue,
    agentActiveModels,
    startMeeting,
    stopMeeting,
    togglePause,
    addMessage,
    addFiles,
    files
  };
};