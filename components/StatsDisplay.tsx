
import React from 'react';
import { BarChart2, Zap } from 'lucide-react';
import { UsageStats, ModelUsage } from '../types';
import { MODEL_OPTIONS, TRANSLATIONS, MODEL_SHORT_NAMES } from '../constants';

interface StatsDisplayProps {
  stats: UsageStats;
  langCode: string;
  isMobile: boolean;
}

export const StatsDisplay: React.FC<StatsDisplayProps> = ({ stats, langCode, isMobile }) => {
  const t = TRANSLATIONS[langCode] || TRANSLATIONS['en'];

  // Helper to display model label with preference for short names (e.g. 2.0lite)
  const getModelLabel = (modelId: string) => {
    // 1. Try short name map first (for 2.0lite, 2.5lite, etc)
    if (MODEL_SHORT_NAMES[modelId]) return MODEL_SHORT_NAMES[modelId];
    // 2. Try option label
    const option = MODEL_OPTIONS.find(m => m.id === modelId);
    if (option) return option.label;
    // 3. Fallback
    return modelId || 'Unknown';
  };

  if (isMobile) return null;

  return (
    <div className="absolute bottom-4 left-4 z-[100] group pointer-events-auto">
      <div className="bg-white/90 dark:bg-black/80 backdrop-blur-md border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-700 dark:text-gray-200 shadow-md flex items-center gap-2 cursor-help transition-all hover:bg-white dark:hover:bg-gray-800">
        <BarChart2 size={16} className="text-indigo-500" />
        <span className="font-semibold">{t.statsLabel}</span>
      </div>

      <div className="hidden group-hover:block absolute bottom-full left-0 mb-2 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl p-4 animate-in fade-in slide-in-from-bottom-2 z-50">
        <div className="space-y-4">
          {Object.entries(stats.byModel).length > 0 ? (
            <div className="space-y-3">
              {Object.entries(stats.byModel).map(([model, data]) => {
                const usage = data as ModelUsage;
                return (
                  <div key={model} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 border border-gray-100 dark:border-gray-800">
                    <div className="text-xs font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1">
                      <Zap size={12} className="text-yellow-500" />
                      {getModelLabel(model)}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[10px] text-gray-500 dark:text-gray-400">
                      <div className="flex flex-col">
                        <span className="uppercase tracking-wider opacity-70">{t.statsCalls}</span>
                        <span className="font-mono text-gray-700 dark:text-gray-300 text-xs">{usage.apiCalls}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="uppercase tracking-wider opacity-70">{t.statsInput}</span>
                        <span className="font-mono text-gray-700 dark:text-gray-300 text-xs">{usage.inputTokens.toLocaleString()}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="uppercase tracking-wider opacity-70">{t.statsOutput}</span>
                        <span className="font-mono text-gray-700 dark:text-gray-300 text-xs">{usage.outputTokens.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-gray-400 text-center py-2">{t.noStats}</div>
          )}

          <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
            <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">{t.statsTotal}</div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="flex flex-col bg-indigo-50 dark:bg-indigo-900/20 p-2 rounded">
                <span className="text-indigo-600 dark:text-indigo-400 font-semibold">{t.statsCalls}</span>
                <span className="font-mono font-bold text-gray-900 dark:text-white">{stats.total.apiCalls}</span>
              </div>
              <div className="flex flex-col bg-green-50 dark:bg-green-900/20 p-2 rounded">
                <span className="text-green-600 dark:text-green-400 font-semibold">{t.statsInput}</span>
                <span className="font-mono font-bold text-gray-900 dark:text-white">{stats.total.inputTokens.toLocaleString()}</span>
              </div>
              <div className="flex flex-col bg-blue-50 dark:bg-blue-900/20 p-2 rounded">
                <span className="text-blue-600 dark:text-blue-400 font-semibold">{t.statsOutput}</span>
                <span className="font-mono font-bold text-gray-900 dark:text-white">{stats.total.outputTokens.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
