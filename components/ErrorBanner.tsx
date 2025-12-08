import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ErrorBannerProps {
  message: string;
  onClose?: () => void;
  actionButton?: React.ReactNode;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onClose, actionButton }) => {
  if (!message) return null;

  return (
    <div className="fixed top-4 left-4 right-4 z-[100] flex justify-center pointer-events-none animate-in fade-in slide-in-from-top-4">
      <div className="bg-red-500 text-white px-5 py-4 rounded-2xl shadow-2xl pointer-events-auto flex items-start gap-3 max-w-2xl w-full border border-red-400">
        <AlertTriangle size={24} className="mt-0.5 flex-shrink-0 text-white" />
        <div className="flex-1 min-w-0">
           <p className="font-bold text-sm mb-1">Application Error</p>
           <p className="text-sm break-words leading-relaxed whitespace-pre-wrap">{message}</p>
           {actionButton && (
             <div className="mt-3">
               {actionButton}
             </div>
           )}
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-full transition-colors">
            <X size={20} />
          </button>
        )}
      </div>
    </div>
  );
};