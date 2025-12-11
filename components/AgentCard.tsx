
import React from 'react';
import { Agent } from '../types';
import { Bot, Mic, Loader2 } from 'lucide-react';
import { TRANSLATIONS } from '../constants';

interface AgentCardProps {
  agent: Agent;
  isSpeaking: boolean;
  isActive: boolean;
  langCode: string;
}

export const AgentCard: React.FC<AgentCardProps> = ({ agent, isSpeaking, isActive, langCode }) => {
  const t = TRANSLATIONS[langCode] || TRANSLATIONS['en'];

  return (
    <div 
      className={`
        relative flex flex-col items-center p-4 rounded-xl border transition-all duration-300
        ${isActive 
          ? 'bg-white dark:bg-gray-800 border-gray-400 dark:border-gray-600 scale-105 shadow-lg shadow-gray-200/50 dark:shadow-gray-900/50' 
          : 'bg-gray-100/50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700/30 opacity-80 scale-100'
        }
      `}
    >
      <div className={`
        w-16 h-16 rounded-full flex items-center justify-center mb-3 relative
        ${agent.avatarColor} text-white shadow-inner
      `}>
        <Bot size={32} />
        {isSpeaking && (
          <div className="absolute -bottom-1 -right-1 bg-white text-black p-1 rounded-full shadow-sm animate-pulse">
            <Mic size={12} />
          </div>
        )}
      </div>
      
      <h3 className="font-bold text-sm text-gray-800 dark:text-gray-100 text-center">{agent.name}</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-1 font-medium">{agent.role}</p>
      
      {isSpeaking && (
        <div className="mt-2 flex gap-1 items-center text-blue-600 dark:text-blue-400 text-xs font-semibold">
           <Loader2 className="animate-spin" size={12} /> {t.speaking}
        </div>
      )}
    </div>
  );
};
