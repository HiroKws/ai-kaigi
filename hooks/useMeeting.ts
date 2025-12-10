
import { useState, useRef, useCallback, useEffect } from 'react';
import { Agent, Message, WhiteboardData, MeetingBackend, Attachment, UsageStats, HandRaiseSignal, ModerationSettings, VoteResult } from '../types';
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

// Get visual emoji for score
const getVoteEmoji = (score: number) => {
    switch(score) {
        case 0: return '✊ (0)';
        case 1: return '☝️ (1)';
        case 2: return '✌️ (2)';
        case 3: return '🤟 (3)';
        case 4: return '🖖 (4)';
        case 5: return '🖐️ (5)';
        default: return '';
    }
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
  const [isWaitingForUser, setIsWaitingForUser] = useState(false); 
  const [isThinking, setIsThinking] = useState(false); 
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(''); 
  
  const [currentSpeakerId, setCurrentSpeakerId] = useState<string | null>(null);
  const [nextSpeakerId, setNextSpeakerId] = useState<string | null>(null);
  const [handRaisedQueue, setHandRaisedQueue] = useState<string[]>([]); 
  
  // Internal State
  const [turnPhase, setTurnPhase] = useState<'start' | 'goal_setting' | 'intro' | 'moderating' | 'speaking' | 'voting'>('start');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const introIndexRef = useRef(0);
  
  // Concurrency Lock
  const isProcessingRef = useRef(false);
  
  // Vote State Ref
  const votingQueueRef = useRef<Agent[]>([]);
  const voteResultsRef = useRef<VoteResult[]>([]);
  const currentVoteProposalRef = useRef<string>("");
  
  // Ref to store detailed hand raise signals (for API)
  const handRaiseSignalsRef = useRef<HandRaiseSignal[]>([]);
  
  // Diamond Phase Tracking (Turns logic)
  const [meetingStage, setMeetingStage] = useState<'divergence' | 'groan' | 'convergence'>('divergence');
  const turnCountRef = useRef(0);

  // --- STABLE STATE REFERENCES ---
  const stateRef = useRef({ 
      messages, agents, files, turnPhase, nextSpeakerId, handRaisedQueue, topic, defaultModel, moderatorModel,
      isActive, isPaused, debugMode, meetingStage, settings, whiteboardData
  });
  
  useEffect(() => {
    stateRef.current = { 
        messages, agents, files, turnPhase, nextSpeakerId, handRaisedQueue, topic, defaultModel, moderatorModel,
        isActive, isPaused, debugMode, meetingStage, settings, whiteboardData
    };
  }, [messages, agents, files, turnPhase, nextSpeakerId, handRaisedQueue, topic, defaultModel, moderatorModel, isActive, isPaused, debugMode, meetingStage, settings, whiteboardData]);


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
    setModeratorModel(model); 
    setMessages([{ id: 'init', agentId: 'user', text: `Goal/Topic: ${newTopic}`, timestamp: Date.now() }]);
    setWhiteboardData(INITIAL_WHITEBOARD_STATE);
    setIsActive(true);
    setIsPaused(false);
    setIsWaitingForUser(false);
    setIsThinking(false);
    setError(null);
    setTurnPhase('goal_setting');
    introIndexRef.current = 0;
    setHandRaisedQueue([]);
    handRaiseSignalsRef.current = [];
    votingQueueRef.current = [];
    voteResultsRef.current = [];
    currentVoteProposalRef.current = "";
    isProcessingRef.current = false; // Reset lock
    timerRef.current = null;
    
    setStatus('Negotiating goal...');
    setAgentActiveModels({});
    setDebugPrompt(null);
    setStats(backend.getStats()); 
    turnCountRef.current = 0;
    setMeetingStage('divergence');
  }, [backend]);

  const stopMeeting = useCallback(() => {
    setIsActive(false);
    setIsPaused(false);
    setIsWaitingForUser(false);
    setIsThinking(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    isProcessingRef.current = false; // Reset lock
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
      const state = stateRef.current;
      return await backend.generateMinutes(state.topic, state.messages, state.agents, langCode, state.defaultModel);
  }, [backend, langCode]);

  // --- MAIN LOOP ---

  const runMeetingLoop = useCallback(async () => {
    const state = stateRef.current;
    
    if (!state.isActive || state.isPaused) return;
    if (isWaitingForUser) return;

    // LOCK: Prevent double execution
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    
    // Clear the timer ref as we are now running the scheduled task
    timerRef.current = null;

    try {
        // --- PHASE 0: GOAL NEGOTIATION ---
        if (state.turnPhase === 'goal_setting') {
            const lastMsg = state.messages[state.messages.length - 1];
            
            if (lastMsg.agentId === 'user') {
                setCurrentSpeakerId('ai-moderator');
                setIsThinking(true);
                
                const moderatorAgent: Agent = { id: 'ai-moderator', name: 'Moderator', role: 'Facilitator', avatarColor: 'bg-indigo-600', systemInstruction: '' };
                
                const result = await backend.negotiateGoal(state.topic, state.messages, moderatorAgent, langCode, state.moderatorModel, state.settings, handlePromptUpdate);
                
                setIsThinking(false);

                if (result.usedModel) {
                     setModeratorModel(result.usedModel);
                }
                syncStats();

                if (result.status === 'CLARIFY') {
                    addMessage('ai-moderator', result.text);
                    setIsWaitingForUser(true);
                    setCurrentSpeakerId(null);
                    isProcessingRef.current = false; // Unlock
                } else {
                    addMessage('ai-moderator', result.text);
                    if (result.refinedGoal) {
                        setTopic(result.refinedGoal);
                    }
                    setTurnPhase('intro');
                    setCurrentSpeakerId(null);
                    
                    if (timerRef.current) clearTimeout(timerRef.current);
                    timerRef.current = setTimeout(() => {
                        timerRef.current = null;
                        isProcessingRef.current = false; // Unlock
                        runMeetingLoop();
                    }, 1500);
                }
            } else {
                // If not user message, wait or unlock
                isProcessingRef.current = false;
            }
            return;
        }

        // --- PHASE 1: INTRO ---
        if (state.turnPhase === 'intro') {
            const agent = state.agents[introIndexRef.current];
            if (agent) {
                setCurrentSpeakerId(agent.id);
                setStatus(`Intro: ${agent.name}`);
                setIsThinking(true);
                
                let text = "";
                let usedModel = agent.model || state.defaultModel;

                const introResult = await backend.generateAgentIntro(agent, state.topic, langCode, state.files, handlePromptUpdate);
                text = introResult.text;
                usedModel = introResult.usedModel;
                
                setIsThinking(false);

                setAgentActiveModels(prev => ({ ...prev, [agent.id]: usedModel }));
                if (introResult.emotion) {
                    setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, currentEmotion: introResult.emotion } : a));
                }
                
                syncStats();
                
                if (state.debugMode && usedModel) {
                   const shortName = MODEL_SHORT_NAMES[usedModel] || usedModel;
                   text += ` [${shortName}]`;
                }

                const readTime = calculateReadingTime(text);
                addMessage(agent.id, text);
                
                timerRef.current = setTimeout(() => {
                    timerRef.current = null;
                    setCurrentSpeakerId(null);
                    introIndexRef.current += 1;
                    isProcessingRef.current = false; // Unlock
                    runMeetingLoop();
                }, readTime);
            } else {
                setTurnPhase('moderating');
                timerRef.current = setTimeout(() => {
                    timerRef.current = null;
                    isProcessingRef.current = false; // Unlock
                    runMeetingLoop();
                }, 500);
            }
            return;
        }

        // --- PHASE 2: VOTING (Fist-to-Five Loop) ---
        if (state.turnPhase === 'voting') {
             if (votingQueueRef.current.length === 0) {
                 setTurnPhase('moderating');
                 setCurrentSpeakerId(null);
                 
                 timerRef.current = setTimeout(() => {
                     timerRef.current = null;
                     isProcessingRef.current = false; // Unlock
                     runMeetingLoop();
                 }, 1000);
                 return;
             }

             const voter = votingQueueRef.current.shift();
             if (!voter) {
                 isProcessingRef.current = false;
                 return;
             }

             setCurrentSpeakerId(voter.id);
             setStatus(`Voting: ${voter.name}`);
             setIsThinking(true);

             const voteResult = await backend.generateFistToFiveVote(
                 voter, 
                 currentVoteProposalRef.current, 
                 state.topic, 
                 state.messages, 
                 langCode, 
                 state.files, 
                 handlePromptUpdate
             );
             
             setIsThinking(false);

             setAgentActiveModels(prev => ({ ...prev, [voter.id]: voteResult.usedModel }));
             syncStats();

             voteResultsRef.current.push(voteResult);

             const emoji = getVoteEmoji(voteResult.score);
             let voteText = `${emoji}`;
             
             if (state.debugMode) {
                 const shortName = MODEL_SHORT_NAMES[voteResult.usedModel] || voteResult.usedModel;
                 voteText += ` [${shortName}]`;
             }

             addMessage(voter.id, voteText);
             
             timerRef.current = setTimeout(() => {
                 timerRef.current = null;
                 isProcessingRef.current = false; // Unlock
                 runMeetingLoop();
             }, 1000);
             
             return;
        }

        // --- PHASE 3: MODERATING ---
        if (state.turnPhase === 'moderating') {
            setCurrentSpeakerId('ai-moderator');
            setStatus('Moderator is deciding...');
            setIsThinking(true);

            turnCountRef.current += 1;
            const turns = turnCountRef.current;
            if (turns > 15 && state.meetingStage === 'groan') {
                setMeetingStage('convergence');
            } else if (turns > 6 && state.meetingStage === 'divergence') {
                setMeetingStage('groan');
            }

            const decision = await backend.generateModeratorTurn(
                state.topic, 
                state.messages, 
                state.agents, 
                langCode, 
                state.files, 
                state.moderatorModel, 
                handRaiseSignalsRef.current,
                state.settings,
                state.meetingStage,
                voteResultsRef.current,
                handlePromptUpdate
            );
            
            setIsThinking(false);

            if (decision.usedModel) {
                setModeratorModel(decision.usedModel);
            }
            syncStats();

            if (voteResultsRef.current.length > 0) {
                voteResultsRef.current = [];
            }

            handRaiseSignalsRef.current = [];
            setHandRaisedQueue([]);

            if (decision.voteProposal && state.settings.fistToFive) {
                currentVoteProposalRef.current = decision.voteProposal;
                votingQueueRef.current = [...state.agents]; 
                voteResultsRef.current = []; 
                
                let text = decision.moderationText;
                if (state.debugMode && decision.usedModel) {
                     const shortName = MODEL_SHORT_NAMES[decision.usedModel] || decision.usedModel;
                     text += ` [${shortName}]`;
                }
                addMessage('ai-moderator', text);
                
                setTurnPhase('voting');
                const readTime = calculateReadingTime(text);
                
                timerRef.current = setTimeout(() => {
                    timerRef.current = null;
                    setCurrentSpeakerId(null);
                    isProcessingRef.current = false; // Unlock
                    runMeetingLoop();
                }, readTime);
                return;
            }

            setNextSpeakerId(decision.nextSpeakerId);
            
            let text = decision.moderationText;
            if (state.debugMode && decision.usedModel) {
                 const shortName = MODEL_SHORT_NAMES[decision.usedModel] || decision.usedModel;
                 text += ` [${shortName}]`;
            }
            addMessage('ai-moderator', text);

            setWhiteboardData(prev => ({ ...prev, isGenerating: true }));
            backend.updateWhiteboard(state.topic, state.messages, state.agents, langCode, state.whiteboardData)
                .then(wb => setWhiteboardData(wb))
                .catch(e => console.error("Whiteboard error", e));

            const readTime = calculateReadingTime(text);
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                setCurrentSpeakerId(null);
                setTurnPhase('speaking');
                isProcessingRef.current = false; // Unlock
                runMeetingLoop();
            }, readTime);
            return;
        }

        // --- PHASE 4: SPEAKING ---
        if (state.turnPhase === 'speaking') {
            const nextId = state.nextSpeakerId;
            let agent = state.agents.find(a => a.id === nextId);

            if (!agent && nextId !== 'user') {
                agent = state.agents[Math.floor(Math.random() * state.agents.length)];
            }

            if (nextId === 'user') {
                 setIsWaitingForUser(true);
                 setTurnPhase('goal_setting');
                 isProcessingRef.current = false; // Unlock
                 return;
            }

            if (agent) {
                setCurrentSpeakerId(agent.id);
                setStatus(`${agent.name} is thinking...`);
                setIsThinking(true);

                const result = await backend.generateAgentResponse(
                    agent, 
                    state.topic, 
                    state.messages, 
                    state.agents, 
                    langCode, 
                    state.files, 
                    handlePromptUpdate
                );
                
                setIsThinking(false);

                setAgentActiveModels(prev => ({ ...prev, [agent.id]: result.usedModel }));
                if (result.emotion) {
                    setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, currentEmotion: result.emotion } : a));
                }

                syncStats();

                let text = result.text;
                if (state.debugMode) {
                     const shortName = MODEL_SHORT_NAMES[result.usedModel] || result.usedModel;
                     text += ` [${shortName}]`;
                }

                addMessage(agent.id, text);

                backend.checkForHandRaises({ id: 'latest', agentId: agent.id, text: result.text, timestamp: Date.now() }, state.agents, langCode, state.topic, handlePromptUpdate)
                   .then(signals => {
                       if (signals && signals.length > 0) {
                           handRaiseSignalsRef.current = signals;
                           const ids = signals.map(s => s.agentId);
                           setHandRaisedQueue(ids);
                       }
                   });

                const readTime = calculateReadingTime(text);
                timerRef.current = setTimeout(() => {
                    timerRef.current = null;
                    setCurrentSpeakerId(null);
                    setTurnPhase('moderating');
                    isProcessingRef.current = false; // Unlock
                    runMeetingLoop();
                }, readTime);
            } else {
                // Agent not found or something went wrong
                setTurnPhase('moderating');
                isProcessingRef.current = false;
                runMeetingLoop();
            }
        }

    } catch (e: any) {
        console.error("Meeting Loop Error:", e);
        setError(e.message || "Unknown error occurred");
        setIsPaused(true);
        setIsThinking(false);
        isProcessingRef.current = false; // Unlock on error
        timerRef.current = null;
    }

  }, [backend, langCode]);

  // Trigger loop when dependencies change, but debounce/control via refs
  useEffect(() => {
      if (!isActive || isPaused || isWaitingForUser) return;
      
      // Only start if no timer is pending AND not currently processing
      if (!timerRef.current && !isProcessingRef.current) {
          timerRef.current = setTimeout(() => {
              timerRef.current = null;
              runMeetingLoop();
          }, 100);
      }
      
      // CRITICAL: We DO NOT clean up the timer here anymore.
      // This prevents the transition timers (e.g. 1500ms wait before Intro) from being cancelled
      // when 'messages' or other state updates trigger a re-render.
  }, [isActive, isPaused, isWaitingForUser, turnPhase, messages.length, runMeetingLoop]);

  // Cleanup on unmount only
  useEffect(() => {
      return () => {
          if (timerRef.current) {
              clearTimeout(timerRef.current);
          }
      };
  }, []);

  return {
      agents,
      messages,
      whiteboardData,
      isActive,
      isPaused,
      setIsPaused,
      isWaitingForUser,
      isThinking,
      error,
      status,
      currentSpeakerId,
      nextSpeakerId,
      handRaisedQueue,
      agentActiveModels,
      moderatorModel,
      debugPrompt,
      startMeeting,
      stopMeeting,
      togglePause,
      addMessage,
      addFiles,
      generateMinutes
  };
};
