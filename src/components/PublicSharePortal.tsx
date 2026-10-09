import React, { useState, useEffect } from 'react';
import { Lock, Download, ArrowLeft, AlertTriangle, FileText, CheckCircle2 } from 'lucide-react';
import { formatBytes, formatShortDate } from '../utils/format';
import { apiFetch } from '../services/clientCloudFallback';

interface PublicShareMetadata {
  token: string;
  fileName: string;
  fileSizeBytes: number;
  fileMimeType: string;
  fileSha256: string;
  creatorName: string;
  hasPassword: boolean;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloadCount: number;
  throttleKbps: number | null;
  bandwidthCapBytes: number | null;
  bandwidthUsedBytes: number;
  createdAt: string;
}

interface PublicSharePortalProps {
  token: string;
  onExitPublicPortal: () => void;
}

export const PublicSharePortal: React.FC<PublicSharePortalProps> = ({
  token,
  onExitPublicPortal,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<PublicShareMetadata | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [unlockedKey, setUnlockedKey] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiFetch(`/api/public/share/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load shared file');
        }
        if (active) {
          setShare(data.share);
          if (!data.share.hasPassword) {
            setUnlockedKey('open');
          }
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load download link');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  const handleVerifyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput.trim()) return;
    setVerifying(true);
    setAuthError(null);

    try {
      const res = await apiFetch(`/api/public/share/${encodeURIComponent(token)}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Incorrect password. Please try again.');
      } else {
        setUnlockedKey(data.accessKey || 'open');
      }
    } catch {
      setAuthError('Could not verify password. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleStartDownload = async () => {
    if (!share) return;
    setDownloading(true);
    try {
      const downloadUrl = `/api/public/share/${encodeURIComponent(
        share.token
      )}/download?key=${encodeURIComponent(unlockedKey || '')}&password=${encodeURIComponent(
        passwordInput
      )}`;
      const res = await apiFetch(downloadUrl);
      if (res.ok) {
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = share.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        setShare((prev) =>
          prev
            ? {
                ...prev,
                downloadCount: prev.downloadCount + 1,
              }
            : prev
        );
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#141311] text-[#F2EFE9] flex flex-col justify-between">
      {/* Clean Header */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-[#2C2824] bg-[#1C1A17]">
        <button
          onClick={onExitPublicPortal}
          className="text-lg font-bold tracking-tight text-[#F2EFE9] whitespace-nowrap shrink-0 cursor-pointer"
        >
          UnlimCloud
        </button>

        <nav className="hidden md:flex items-center gap-4 text-sm text-[#9E978E]">
          <span className="whitespace-nowrap shrink-0">Shared File Download</span>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            onClick={onExitPublicPortal}
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-[#F2EFE9] bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to My Files
          </button>
        </div>
      </header>

      {/* Centered Friendly File Card */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-[#1C1A17] border border-[#2C2824]">
          {loading ? (
            <div className="p-8 space-y-4">
              <div className="h-12 w-12 bg-[#24211D] border border-[#2C2824]" />
              <div className="h-6 w-56 bg-[#24211D] border border-[#2C2824]" />
              <div className="h-12 w-full bg-[#24211D] border border-[#2C2824]" />
            </div>
          ) : error || !share ? (
            <div className="p-8 space-y-5 text-center">
              <div className="w-12 h-12 mx-auto bg-[#24211D] border border-[#2C2824] flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-[#D94848]" />
              </div>
              <div className="space-y-2">
                <h1 className="text-xl font-bold text-[#F2EFE9]">Link Unavailable</h1>
                <p className="text-sm text-[#9E978E]">
                  {error || 'This shared link has expired or been turned off by the owner.'}
                </p>
              </div>
              <button
                onClick={onExitPublicPortal}
                className="px-5 py-2.5 text-xs font-semibold bg-[#D97757] text-[#141311] hover:bg-[#E08568] transition-colors cursor-pointer"
              >
                Go to My Drive
              </button>
            </div>
          ) : (
            <div className="p-8 space-y-6">
              {/* File Icon & Name */}
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-[#24211D] border border-[#2C2824] flex items-center justify-center shrink-0">
                  <FileText className="w-6 h-6 text-[#D97757]" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <h1 className="text-xl font-bold text-[#F2EFE9] break-all">
                    {share.fileName}
                  </h1>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#9E978E] tabular-nums">
                    <span className="text-[#F2EFE9] font-medium">
                      {formatBytes(share.fileSizeBytes)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Shared by {share.creatorName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatShortDate(share.createdAt)}</span>
                  </div>
                </div>
              </div>

              {/* Password Box or Download Button */}
              <div className="pt-4 border-t border-[#2C2824]">
                {share.hasPassword && !unlockedKey ? (
                  <form onSubmit={handleVerifyPassword} className="space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#F2EFE9]">
                      <Lock className="w-4 h-4 text-[#D97757]" />
                      <span>This file is protected with a password</span>
                    </div>
                    {share.token === 'tg-spec-vault-2026' && (
                      <p className="text-xs text-[#9E978E]">
                        Demo password for this link:{' '}
                        <span className="font-mono text-[#F2EFE9]">unlim2026</span>
                      </p>
                    )}
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        type="password"
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        placeholder="Enter password to unlock..."
                        className="flex-1 bg-[#141311] border border-[#2C2824] px-4 py-2.5 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                        required
                      />
                      <button
                        type="submit"
                        disabled={verifying}
                        className="px-6 py-2.5 text-sm font-semibold bg-[#D97757] text-[#141311] hover:bg-[#E08568] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        {verifying ? 'Checking...' : 'Unlock File'}
                      </button>
                    </div>
                    {authError && <p className="text-xs text-[#D94848]">{authError}</p>}
                  </form>
                ) : (
                  <div className="space-y-4">
                    <button
                      onClick={handleStartDownload}
                      disabled={downloading}
                      className="w-full flex items-center justify-center gap-2.5 py-3.5 px-6 text-sm font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] transition-colors cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      {downloading
                        ? 'Starting Download...'
                        : `Download File (${formatBytes(share.fileSizeBytes)})`}
                    </button>

                    <div className="flex items-center justify-between text-xs text-[#9E978E] tabular-nums">
                      <span className="flex items-center gap-1.5 text-[#2E9E6B]">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Ready for direct download
                      </span>
                      <span>
                        {share.throttleKbps
                          ? `Speed limit: ${share.throttleKbps} KB/s`
                          : 'Full speed enabled'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="px-6 py-4 border-t border-[#2C2824] bg-[#1C1A17] text-center text-xs text-[#9E978E]">
        Powered by UnlimCloud — Unlimited Telegram Cloud Storage
      </footer>
    </div>
  );
};
