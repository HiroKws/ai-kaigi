
import React from 'react';
import { WhiteboardData, WhiteboardItem } from '../types';
import { StickyNote, Layout, Activity, Lightbulb, AlertTriangle, CheckCircle, Info, Archive } from 'lucide-react';
import { TRANSLATIONS } from '../constants';

interface WhiteboardProps {
  data: WhiteboardData;
  isLoading: boolean;
  langCode: string;
}

export const Whiteboard: React.FC<WhiteboardProps> = ({ data, isLoading, langCode }) => {
  const t = TRANSLATIONS[langCode] || TRANSLATIONS['en'];

  // Helper to determine styling based on item type
  const getItemStyle = (type: WhiteboardItem['type']) => {
    switch (type) {
      case 'idea':
        return 'bg-yellow-100 dark:bg-yellow-900/40 border-yellow-200 dark:border-yellow-700/50 text-yellow-900 dark:text-yellow-100';
      case 'concern':
        return 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800/50 text-red-900 dark:text-red-100';
      case 'decision':
        return 'bg-green-100 dark:bg-green-900/40 border-green-300 dark:border-green-600 border-2 text-green-900 dark:text-green-100 font-semibold shadow-md';
      case 'info':
      default:
        return 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800/50 text-blue-900 dark:text-blue-100';
    }
  };

  const getItemIcon = (type: WhiteboardItem['type']) => {
      switch (type) {
          case 'idea': return <Lightbulb size={14} className="text-yellow-600 dark:text-yellow-400" />;
          case 'concern': return <AlertTriangle size={14} className="text-red-600 dark:text-red-400" />;
          case 'decision': return <CheckCircle size={14} className="text-green-600 dark:text-green-400" />;
          default: return <Info size={14} className="text-blue-600 dark:text-blue-400" />;
      }
  };

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
        
        {/* Sections Grid */}
        <div className="flex flex-wrap gap-6 items-start content-start">
          {data.sections.map((section, idx) => (
            <div key={idx} className="flex-1 min-w-[300px] bg-white dark:bg-slate-800 rounded-lg shadow-md border border-slate-200 dark:border-slate-700 flex flex-col h-fit animate-in fade-in zoom-in-95 duration-500">
              <div className="p-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 rounded-t-lg">
                <h3 className="font-bold text-slate-700 dark:text-slate-200">{section.title}</h3>
              </div>
              <div className="p-4 space-y-3">
                {section.items.map((item, i) => (
                  <div key={i} className={`p-3 rounded border flex gap-3 text-sm shadow-sm transition-all hover:scale-[1.02] ${getItemStyle(item.type)}`}>
                    <div className="flex-shrink-0 mt-0.5">{getItemIcon(item.type)}</div>
                    <span className="leading-snug">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Parking Lot (Fixed at bottom or just appended) */}
        {data.parkingLot && data.parkingLot.length > 0 && (
            <div className="mt-8 bg-gray-100 dark:bg-gray-800/80 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 p-4">
                <div className="flex items-center gap-2 mb-3 text-gray-500 dark:text-gray-400">
                    <Archive size={16} />
                    <h3 className="font-bold text-xs uppercase tracking-wider">{t.optParkingLot || 'Parking Lot'}</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                    {data.parkingLot.map((item, i) => (
                        <div key={i} className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded text-sm">
                            {item}
                        </div>
                    ))}
                </div>
            </div>
        )}

        {data.sections.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 dark:text-slate-500">
            <StickyNote size={48} className="mb-2 opacity-50" />
            <p>{t.emptyWhiteboard}</p>
          </div>
        )}
      </div>
    </div>
  );
};
