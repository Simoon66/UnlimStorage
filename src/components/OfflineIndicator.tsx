import React, { useState, useEffect } from 'react';
import { WifiOff } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 bg-[#1C1A17] border border-[#D99B26]/50 text-[#F2EFE9] px-3.5 py-2 rounded shadow-xl text-xs font-medium">
      <WifiOff className="w-3.5 h-3.5 text-[#D99B26] shrink-0" />
      <span>Offline Mode · Cached files and local vault remain accessible</span>
    </div>
  );
};
