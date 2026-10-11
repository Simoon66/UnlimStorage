import React, { useState } from 'react';
import { Download, Share, PlusSquare, X, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);

  if (isInstalled || !isInstallable) return null;

  const handleInstallClick = () => {
    if (isIOS) {
      setShowIOSPrompt(true);
    } else {
      void promptInstall();
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        className={
          compact
            ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-[#24211D] hover:bg-[#2C2824] text-[#F2EFE9] border border-[#2C2824] rounded text-xs font-medium transition-colors cursor-pointer'
            : 'w-full flex items-center justify-between px-3 py-2 rounded text-xs font-medium bg-[#D97757]/12 hover:bg-[#D97757]/20 text-[#D97757] border border-[#D97757]/30 transition-colors cursor-pointer'
        }
        title="Install UnlimStorage App on your device"
      >
        <span className="flex items-center gap-2">
          <Smartphone className="w-3.5 h-3.5 shrink-0" />
          <span>{compact ? 'Install App' : 'Install Desktop / Mobile App'}</span>
        </span>
        {!compact && <Download className="w-3.5 h-3.5 shrink-0" />}
      </button>

      {showIOSPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
          onClick={() => setShowIOSPrompt(false)}
        >
          <div
            className="bg-[#1C1A17] border border-[#2C2824] rounded-md max-w-sm w-full p-5 shadow-2xl space-y-4 text-[#F2EFE9]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#2C2824] pb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-[#D97757]" />
                <h3 className="text-sm font-semibold">Install UnlimStorage</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSPrompt(false)}
                className="p-1 text-[#9E978E] hover:text-[#F2EFE9] rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#9E978E] leading-relaxed">
              Install UnlimStorage on your iPhone or iPad for full-screen cloud access and instant media streaming:
            </p>
            <ol className="text-xs text-[#F2EFE9] space-y-3">
              <li className="flex items-center gap-3">
                <span className="flex items-center justify-center w-6 h-6 rounded bg-[#24211D] border border-[#2C2824] text-[#D97757] font-mono text-[11px] font-semibold">
                  1
                </span>
                <span className="flex items-center gap-1.5">
                  Tap the <Share className="w-3.5 h-3.5 text-[#D97757] inline" /> <strong>Share</strong> button in Safari.
                </span>
              </li>
              <li className="flex items-center gap-3">
                <span className="flex items-center justify-center w-6 h-6 rounded bg-[#24211D] border border-[#2C2824] text-[#D97757] font-mono text-[11px] font-semibold">
                  2
                </span>
                <span className="flex items-center gap-1.5">
                  Select <PlusSquare className="w-3.5 h-3.5 text-[#D97757] inline" /> <strong>Add to Home Screen</strong>.
                </span>
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSPrompt(false)}
              className="w-full py-2 bg-[#D97757] hover:bg-[#C66747] text-[#141311] rounded text-xs font-semibold transition-colors cursor-pointer"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
