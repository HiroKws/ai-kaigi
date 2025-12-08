import React, { useEffect, useRef } from 'react';
import { Message, Agent } from '../types';
import { User, Sparkles, Mic2 } from 'lucide-react';

interface ChatLogProps {
  messages: Message[];
  agents: Agent[];
}

export const ChatLog: React.FC<ChatLogProps> = ({ messages, agents }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.length === 0 && (
        <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 opacity-50">
          <Sparkles size={48} className="mb-4" />
          <p className="text-lg">Start a topic to begin the meeting</p>
        </div>
      )}
      
      {messages.map((msg) => {
        const isUser = msg.agentId === 'user';
        const isModerator = msg.agentId === 'ai-moderator';
        const agent = agents.find(a => a.id === msg.agentId);
        
        if (isModerator) {
           return (
             <div key={msg.id} className="flex flex-col items-center justify-center my-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="flex items-center gap-2 bg-white/80 dark:bg-gray-800/80 border border-indigo-200 dark:border-indigo-500/50 px-4 py-2 rounded-full shadow-lg backdrop-blur-sm">
                   <Mic2 size={16} className="text-indigo-500 dark:text-indigo-400" />
                   <span className="text-indigo-800 dark:text-indigo-200 font-semibold text-sm">{msg.text}</span>
                </div>
             </div>
           );
        }

        const borderClass = agent ? getBorderClass(agent.avatarColor) : 'border-gray-200';
        const textClass = agent ? getTextClass(agent.avatarColor) : 'text-gray-500';

        return (
          <div 
            key={msg.id} 
            className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} animate-in fade-in slide-in-from-bottom-2`}
          >
            {/* Avatar */}
            <div className={`
              w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-md
              ${isUser ? 'bg-indigo-600' : agent?.avatarColor || 'bg-gray-400 dark:bg-gray-600'}
              text-white
            `}>
              {isUser ? <User size={14} /> : <span className="text-xs font-bold">{agent?.name.charAt(0)}</span>}
            </div>

            {/* Bubble */}
            <div className={`
              max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm border-2
              ${isUser 
                ? 'bg-indigo-600 text-white rounded-tr-sm border-indigo-600' 
                : `bg-white dark:bg-gray-800 ${borderClass} text-gray-800 dark:text-gray-200 rounded-tl-sm`
              }
            `}>
              {!isUser && (
                <div className="text-xs font-bold mb-1 flex justify-between">
                  <span className={textClass}>{agent?.name}</span>
                  <span className="text-gray-400 dark:text-gray-600 font-normal ml-2">{agent?.role}</span>
                </div>
              )}
              {msg.text}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
};