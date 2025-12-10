
import { useState, useRef, useCallback, useEffect } from 'react';
import { Agent, Message, WhiteboardData, MeetingBackend, Attachment, UsageStats, HandRaiseSignal, ModerationSettings } from '../types';
import { INITIAL_WHITEBOARD_STATE, DEFAULT_MODEL, MODEL_SHORT_NAMES, TRANSLATIONS, DEFAULT_MODERATION_SETTINGS } from '../constants';

// Helper to generate localized kickoff message without API call
const getKickoffMessage = (lang: string, topic: string, firstAgent: Agent) => {
    const t = TRANSLATIONS[lang] || TRANSLATIONS['en'];
    const template = t.kickoffMessage || TRANSLATIONS['en'].kickoffMessage;
    
    return template
        .replace('{topic}', topic)
        .replace('{name}', firstAgent.name)
        .replace('{role}', firstAgent.role);
};

// Calculate reading time: 50ms per character + 1.5s base buffer
const calculateReadingTime = (text: string) => {
    const baseDelay = 1500;
    const charDelay = 50; 
    return Math.max(3000, Math.min(15000, baseDelay + (text.length * charDelay)));
};

export const useMeeting = (backend: MeetingBackend, langCode: string, debugMode: boolean, settings: ModerationSettings) => {
  const [topic, setTopic] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [whiteboardData, setWhiteboardData] = useState<WhiteboardData>(INITIAL_WHITEBOARD_STATE);
  const [defaultModel, setDefaultModel] = useState<string>(DEFAULT_MODEL);
  
  // Track which model was actually used for each agent's last turn
  const [agentActiveModels, setAgentActiveModels] = useState<Record<string, string>>({});
  // Track specifically the moderator's active model (persistent fallback)
  const [moderatorModel, setModeratorModel] = useState<string>(DEFAULT_MODEL);
  
  // Track current debug prompt being used
  const [debugPrompt, setDebugPrompt] = useState<string | null>(null);
  
  // Initialize stats with current global values from backend to capture preparation costs
  const [stats, setStats] = useState<UsageStats>(() => backend.getStats());
  
  const [isActive, setIsActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isWaitingForUser, setIsWaitingForUser] = useState(false); // NEW: Track if waiting for user
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(''); 
  
  const [currentSpeakerId, setCurrentSpeakerId] = useState<string | null>(null);
  const [nextSpeakerId, setNextSpeakerId] = useState<string | null>(null);
  const [handRaisedQueue, setHandRaisedQueue] = useState<string[]>([]); // For UI Only (IDs)
  
  // Internal State
  const [turnPhase, setTurnPhase] = useState<'start' | 'goal_setting' | 'intro' | 'moderating' | 'speaking'>('start');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const introIndexRef = useRef(0);
  
  // Ref to store detailed hand raise signals (for API)
  const handRaiseSignalsRef = useRef<HandRaiseSignal[]>([]);
  
  // Diamond Phase Tracking (Turns logic)
  const [meetingStage, setMeetingStage] = useState<'divergence' | 'groan' | 'convergence'>('divergence');
  const turnCountRef = useRef(0);

  // --- STABLE STATE REFERENCES ---
  const stateRef = useRef({ 
      messages, agents, files, turnPhase, nextSpeakerId, handRaisedQueue, topic, defaultModel, moderatorModel,
      isActive, isPaused, debugMode, meetingStage, settings
  });
  
  useEffect(() => {
    stateRef.current = { 
        messages, agents, files, turnPhase, nextSpeakerId, handRaisedQueue, topic, defaultModel, moderatorModel,
        isActive, isPaused, debugMode, meetingStage, settings
    };
  }, [messages, agents, files, turnPhase, nextSpeakerId, handRaisedQueue, topic, defaultModel, moderatorModel, isActive, isPaused, debugMode, meetingStage, settings]);


  // --- ACTIONS ---

  const addMessage = useCallback((agentId: string, text: string) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), agentId, text, timestamp: Date.now() }]);
    if (agentId === 'user') {
        setIsWaitingForUser(false);
    }
  }, []);

  const addFiles = useCallback((newFiles: Attachment[]) => {
      setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const startMeeting = useCallback((newTopic: string, team: Agent[], initialFiles: Attachment[] = [], model: string = DEFAULT_MODEL) => {
    setTopic(newTopic);
    setAgents(team);
    setFiles(initialFiles);
    setDefaultModel(model);
    setModeratorModel(model); // Reset moderator model to default at start
    setMessages([{ id: 'init', agentId: 'user', text: `Goal/Topic: ${newTopic}`, timestamp: Date.now() }]);
    setWhiteboardData(INITIAL_WHITEBOARD_STATE);
    setIsActive(true);
    setIsPaused(false);
    setIsWaitingForUser(false);
    setError(null);
    setTurnPhase('goal_setting'); // New Start Phase
    introIndexRef.current = 0;
    setHandRaisedQueue([]);
    handRaiseSignalsRef.current = [];
    setStatus('Negotiating goal...');
    setAgentActiveModels({});
    setDebugPrompt(null);
    setStats(backend.getStats()); 
    // Diamond Reset
    turnCountRef.current = 0;
    setMeetingStage('divergence');
  }, [backend]);

  const stopMeeting = useCallback(() => {
    setIsActive(false);
    setIsPaused(false);
    setIsWaitingForUser(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setStatus('Meeting ended');
    setDebugPrompt(null);
  }, []);

  const togglePause = useCallback(() => {
    setIsPaused(prev => !prev);
  }, []);

  const syncStats = useCallback(() => {
      setStats(backend.getStats());
  }, [backend]);

  const handlePromptUpdate = useCallback((prompt: string) => {
      setDebugPrompt(prompt);
  }, []);

  const generateMinutes = useCallback(async () => {
     return backend.generateMinutes(topic, messages, agents, langCode, moderatorModel);
  }, [backend, topic, messages, agents, langCode, moderatorModel]);

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
    const { messages, agents, files, turnPhase, nextSpeakerId, handRaisedQueue, topic, defaultModel, moderatorModel, debugMode, meetingStage, settings } = state;
    
    setError(null);

    try {
      if (turnPhase === 'goal_setting') {
          // Goal Negotiation Phase
          const lastMsg = messages[messages.length - 1];
          const isModeratorLast = lastMsg.agentId === 'ai-moderator';
          
          if (isModeratorLast) {
              setStatus('Waiting for your clarification...');
              setIsWaitingForUser(true);
              timerRef.current = null;
              return;
          }

          setStatus('Moderator reviewing goal...');
          setCurrentSpeakerId('ai-moderator');

          const moderatorAgent = agents.find(a => a.role.toLowerCase().includes('moderator') || a.role.includes('司会')) || agents[0];
          
          const response = await backend.negotiateGoal(topic, messages, moderatorAgent, langCode, moderatorModel, settings, handlePromptUpdate);
          
          // Update moderator persistent model
          setModeratorModel(response.usedModel);
          
          setDebugPrompt(null); // Clear prompt after generation
          syncStats();

          let text = response.text;
          if (debugMode && response.usedModel) {
             const shortName = MODEL_SHORT_NAMES[response.usedModel] || response.usedModel;
             text += ` [${shortName}]`;
          }

          addMessage('ai-moderator', text);
          setCurrentSpeakerId(null);

          if (response.status === 'ACCEPTED') {
              if (response.refinedGoal) {
                  setTopic(response.refinedGoal);
              }
              setStatus('Goal accepted. Starting introductions...');
              setIsWaitingForUser(false);
              setTurnPhase('intro');
              if (stateRef.current.isActive && !stateRef.current.isPaused) {
                 timerRef.current = setTimeout(processTurn, 2000); 
              }
          } else {
              setStatus('Waiting for user input...');
              setIsWaitingForUser(true);
              timerRef.current = null;
          }

      } else if (turnPhase === 'start') {
           setTurnPhase('intro');
           if (stateRef.current.isActive && !stateRef.current.isPaused) {
             timerRef.current = setTimeout(processTurn, 100);
           }

      } else if (turnPhase === 'intro') {
          const idx = introIndexRef.current;
          if (idx < agents.length) {
             const agent = agents[idx];
             setStatus(`${agent.name} is introducing themselves...`);
             setCurrentSpeakerId(agent.id);
             
             let text = "";
             let usedModel = "";
             
             if (agent.initialMessage) {
                 text = agent.initialMessage;
                 usedModel = agent.initialMessageModel || agent.model || defaultModel;
             } else {
                 const response = await backend.generateAgentIntro(agent, topic, langCode, files, handlePromptUpdate);
                 setDebugPrompt(null);
                 text = response.text;
                 usedModel = response.usedModel;
                 syncStats();
             }

             if (usedModel) {
                 setAgentActiveModels(prev => ({ ...prev, [agent.id]: usedModel }));
                 if (debugMode) {
                     const shortName = MODEL_SHORT_NAMES[usedModel] || usedModel;
                     text += ` [${shortName}]`;
                 }
             }

             addMessage(agent.id, text);
             setCurrentSpeakerId(null);
             introIndexRef.current += 1;
             
             const readTime = calculateReadingTime(text);
             if (stateRef.current.isActive && !stateRef.current.isPaused) {
                timerRef.current = setTimeout(processTurn, readTime); 
             }
          } else {
             setTurnPhase('moderating');
             if (stateRef.current.isActive && !stateRef.current.isPaused) {
                timerRef.current = setTimeout(processTurn, 1000);
             }
          }

      } else if (turnPhase === 'moderating') {
        setStatus('Moderator thinking...');
        setCurrentSpeakerId('ai-moderator');

        // DIAMOND PHASE UPDATE
        turnCountRef.current += 1;
        const currentTurns = turnCountRef.current;
        let nextStage: 'divergence' | 'groan' | 'convergence' = meetingStage;
        
        // Simple logic for phase transition based on turn count
        // Can be improved by AI analysis later
        if (currentTurns < 5) nextStage = 'divergence';
        else if (currentTurns < 10) nextStage = 'groan';
        else nextStage = 'convergence';
        
        if (nextStage !== meetingStage) {
            setMeetingStage(nextStage);
        }
        
        const response = await backend.generateModeratorTurn(
            topic, 
            messages, 
            agents, 
            langCode, 
            files, 
            moderatorModel, // Use persistent model 
            handRaiseSignalsRef.current,
            settings,    // Pass advanced settings
            nextStage,   // Pass current stage
            handlePromptUpdate
        );
        
        // Update persistent model if changed
        setModeratorModel(response.usedModel);
        
        setDebugPrompt(null);
        const { nextSpeakerId: nextId, moderationText, usedModel } = response;
        syncStats();
        
        let finalText = moderationText;
        if (debugMode && usedModel) {
            const shortName = MODEL_SHORT_NAMES[usedModel] || usedModel;
            finalText += ` [${shortName}]`;
        }

        addMessage('ai-moderator', finalText);
        setCurrentSpeakerId(null);
        setNextSpeakerId(nextId);
        
        setHandRaisedQueue([]);
        handRaiseSignalsRef.current = [];
        
        if (nextId && nextId.toLowerCase() === 'user') {
            setStatus('Waiting for your input...');
            setIsWaitingForUser(true);
            timerRef.current = null;
            return;
        }

        setTurnPhase('speaking');
        const readTime = calculateReadingTime(finalText);
        
        if (stateRef.current.isActive && !stateRef.current.isPaused) {
           timerRef.current = setTimeout(processTurn, readTime);
        }

      } else if (turnPhase === 'speaking' && nextSpeakerId) {
        
        if (nextSpeakerId.toLowerCase() === 'user') {
             setStatus('Waiting for your input...');
             setIsWaitingForUser(true);
             timerRef.current = null; 
             return;
        }

        const agent = agents.find(a => a.id === nextSpeakerId);
        if (agent) {
          setStatus(`${agent.name} thinking...`);
          setCurrentSpeakerId(agent.id);
          
          const response = await backend.generateAgentResponse(agent, topic, messages, agents, langCode, files, handlePromptUpdate);
          setDebugPrompt(null);
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
              const signals = await backend.checkForHandRaises(lastMsg, agents, langCode, topic, handlePromptUpdate);
              setDebugPrompt(null);
              syncStats();
              
              if (signals.length > 0) {
                  const newSignals = signals.filter(s => 
                      s.agentId !== agent.id && 
                      s.agentId !== nextSpeakerId
                  );
                  handRaiseSignalsRef.current = [...handRaiseSignalsRef.current, ...newSignals];
                  
                  setHandRaisedQueue(prev => {
                      const newIds = newSignals.map(s => s.agentId);
                      return Array.from(new Set([...prev, ...newIds]));
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
      setIsPaused(true); 
    }
  }, [backend, langCode, addMessage, syncStats, handlePromptUpdate]); 

  // --- CONTROL EFFECT ---
  useEffect(() => {
    if (isActive && !isPaused) {
        if (!timerRef.current) {
            timerRef.current = setTimeout(processTurn, 1000);
        }
    } 
    else {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }
    
    return () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };
  }, [isActive, isPaused, processTurn]);

  // --- RESUME ON USER MESSAGE ---
  useEffect(() => {
     if (isActive && !isPaused && messages.length > 0) {
         const lastMsg = messages[messages.length - 1];
         if (lastMsg.agentId === 'user') {
             if (!timerRef.current) {
                 if (turnPhase === 'goal_setting') {
                     timerRef.current = setTimeout(processTurn, 500);
                 } else {
                     setTurnPhase('moderating');
                     timerRef.current = setTimeout(processTurn, 500);
                 }
             }
         }
     }
  }, [messages, turnPhase, isActive, isPaused, processTurn]);

  return {
    topic,
    agents,
    messages,
    whiteboardData,
    stats,
    isActive,
    isPaused,
    setIsPaused,
    isWaitingForUser,
    error,
    status,
    currentSpeakerId,
    nextSpeakerId,
    handRaisedQueue,
    agentActiveModels,
    moderatorModel, // EXPORTED
    debugPrompt,
    startMeeting,
    stopMeeting,
    togglePause,
    addMessage,
    addFiles,
    files,
    generateMinutes
  };
};
