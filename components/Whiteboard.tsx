import React from 'react';
import { WhiteboardData } from '../types';
import { StickyNote, Layout, Activity, Image as ImageIcon } from 'lucide-react';
import { TRANSLATIONS } from '../constants';

interface WhiteboardProps {
  data: WhiteboardData;
  isLoading: boolean;
  langCode: string;
}

export const Whiteboard: React.FC<WhiteboardProps> = ({ data, isLoading, langCode }) => {
  const t = TRANSLATIONS[langCode] || TRANSLATIONS['en'];

  return (
    <div className="h-full flex flex-col bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-xl overflow-hidden shadow-xl border border-slate-300 dark:border-slate-700 relative transition-colors duration-300">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
          <Layout size={20} />
          <h2 className="font-bold text-lg">{t.whiteboardTitle}</h2>
        </div>
        {isLoading && (
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-full animate-pulse">
            <Activity size={14} /> {t.whiteboardUpdating}
          </div>
        )}
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-y-auto p-6 bg-[url('https://www.transparenttextures.com/patterns/graphy.png')] dark:bg-[url('https://www.transparenttextures.com/patterns/graphy-inverted.png')] bg-slate-50 dark:bg-slate-950/50">
        
        {/* Summary Block */}
        {data.summary && (
          <div className="mb-6 bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 p-4 rounded-r shadow-sm">
            <h3 className="font-bold text-yellow-800 dark:text-yellow-500 text-sm uppercase tracking-wide mb-1">{t.summaryTitle}</h3>
            <p className="text-slate-800 dark:text-slate-200">{data.summary}</p>
          </div>
        )}

        {/* Image Block */}
        {data.imageUrl && (
          <div className="mb-6 bg-white dark:bg-slate-800 rounded-lg shadow-md border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-t-lg flex items-center gap-2">
               <ImageIcon size={16} className="text-purple-500" />
               <h3 className="font-bold text-slate-700 dark:text-slate-200">{t.visualMapTitle}</h3>
            </div>
            <div className="p-4 flex justify-center bg-white dark:bg-slate-100 overflow-x-auto">
               <img src={data.imageUrl} alt="Whiteboard Visual" className="max-w-full h-auto rounded-lg shadow-sm" />
            </div>
          </div>
        )}

        {/* Sections Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {data.sections.map((section, idx) => (
            <div key={idx} className="bg-white dark:bg-slate-800 rounded-lg shadow-md border border-slate-200 dark:border-slate-700 flex flex-col h-fit break-inside-avoid">
              <div className="p-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-t-lg">
                <h3 className="font-bold text-slate-700 dark:text-slate-200">{section.title}</h3>
              </div>
              <ul className="p-4 space-y-3">
                {section.items.map((item, i) => (
                  <li key={i} className="flex gap-3 text-sm text-slate-600 dark:text-slate-300">
                    <StickyNote size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {data.sections.length === 0 && !data.imageUrl && !isLoading && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 dark:text-slate-500">
            <p>{t.emptyWhiteboard}</p>
          </div>
        )}
      </div>
    </div>
  );
};
