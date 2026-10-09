import React, { useState } from 'react';
import {
  Lock,
  Unlock,
  Copy,
  Check,
  ExternalLink,
  Trash2,
  Gauge,
  Download,
  ShieldCheck,
  Send,
  RefreshCw,
  FileText,
  Clock,
} from 'lucide-react';
import {
  ShareLink,
  BandwidthSettings,
  AuditLog,
  TelegramConfigState,
} from '../types';
import { formatBytes, formatShortDate } from '../utils/format';

// ============================================================================
// 1. SHARED LINKS VIEW (Phone-Friendly Visual Cards)
// ============================================================================

interface SharedLinksViewProps {
  shares: ShareLink[];
  onToggleShareActive: (share: ShareLink) => Promise<void>;
  onUpdateShareThrottle: (share: ShareLink, throttleKbps: number | null) => Promise<void>;
  onDeleteShare: (shareId: string) => Promise<void>;
  onOpenPublicPortal: (token: string) => void;
}

export const SharedLinksView: React.FC<SharedLinksViewProps> = ({
  shares,
  onUpdateShareThrottle,
  onDeleteShare,
  onOpenPublicPortal,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (share: ShareLink) => {
    const url = `${window.location.origin}/?share=${encodeURIComponent(share.token)}`;
    navigator.clipboard.writeText(url);
    setCopiedId(share.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="space-y-5">
      <div className="border-b border-[#2C2824] pb-3.5">
        <h1 className="text-lg sm:text-xl font-bold text-[#F2EFE9]">Shared Download Links</h1>
        <p className="text-xs text-[#9E978E] mt-1">
          Copy your shared links, open the public download page, or adjust speed limits.
        </p>
      </div>

      {shares.length === 0 ? (
        <div className="p-8 sm:p-12 bg-[#1C1A17] border border-[#2C2824] text-center space-y-2">
          <div className="text-base font-bold text-[#F2EFE9]">No Shared Links Yet</div>
          <p className="text-xs text-[#9E978E]">
            Go to &ldquo;My Files&rdquo; and tap &ldquo;Share&rdquo; on any file card to create a
            direct download link.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shares.map((s) => (
            <div
              key={s.id}
              className={`p-4 sm:p-5 bg-[#1C1A17] border border-[#2C2824] flex flex-col justify-between gap-4 ${
                !s.active ? 'opacity-60' : ''
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-11 h-11 bg-[#24211D] border border-[#2C2824] flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-[#D97757]" />
                  </div>
                  <button
                    onClick={() => onDeleteShare(s.id)}
                    className="min-w-[44px] min-h-[44px] -mr-2 -mt-2 flex items-center justify-center text-[#9E978E] hover:text-[#D94848] cursor-pointer"
                    title="Stop Sharing"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-[#F2EFE9] truncate" title={s.fileName}>
                    {s.fileName}
                  </h3>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#9E978E] mt-1 tabular-nums">
                    <span>{formatBytes(s.fileSizeBytes)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{s.downloadCount} downloads</span>
                    <span aria-hidden="true">·</span>
                    {s.hasPassword ? (
                      <span className="text-[#D99B26] inline-flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Password Protected
                      </span>
                    ) : (
                      <span className="text-[#2E9E6B] inline-flex items-center gap-1">
                        <Unlock className="w-3 h-3" /> Public Link
                      </span>
                    )}
                  </div>
                </div>

                {/* Simple Speed Control */}
                <div className="flex items-center justify-between pt-2.5 border-t border-[#2C2824] text-xs">
                  <span className="text-[#9E978E]">Speed Limit:</span>
                  <select
                    value={s.throttleKbps || ''}
                    onChange={(e) =>
                      onUpdateShareThrottle(
                        s,
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                    className="min-h-[40px] bg-[#141311] border border-[#2C2824] px-3 py-1.5 text-xs text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                  >
                    <option value="">Full Speed</option>
                    <option value="2048">2 MB/s</option>
                    <option value="1024">1 MB/s</option>
                    <option value="512">512 KB/s</option>
                  </select>
                </div>
              </div>

              {/* Action Buttons (44px min height for mobile thumb ergonomics) */}
              <div className="grid grid-cols-2 gap-2.5 pt-2">
                <button
                  onClick={() => handleCopy(s)}
                  className="min-h-[44px] py-2.5 px-3 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {copiedId === s.id ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  {copiedId === s.id ? 'Copied!' : 'Copy Link'}
                </button>
                <button
                  onClick={() => onOpenPublicPortal(s.token)}
                  className="min-h-[44px] py-2.5 px-3 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open Page
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 2. SIMPLE ACTIVITY & DOWNLOAD SPEED VIEW
// ============================================================================

interface ActivityAndSpeedViewProps {
  settings: BandwidthSettings;
  logs: AuditLog[];
  onUpdateSettings: (patch: Partial<BandwidthSettings>) => Promise<void>;
}

const SPEED_OPTIONS: { label: string; desc: string; value: number | null }[] = [
  { label: 'Unlimited Speed', desc: 'Maximum download speed', value: null },
  { label: 'Fast (2 MB/s)', desc: 'Great for large files', value: 2048 },
  { label: 'Balanced (1 MB/s)', desc: 'Smooth everyday sharing', value: 1024 },
  { label: 'Data Saver (512 KB/s)', desc: 'Saves bandwidth', value: 512 },
];

function friendlyActionLabel(action: string): string {
  switch (action) {
    case 'FILE_UPLOAD':
      return 'Uploaded file';
    case 'REMOTE_UPLOAD':
      return 'Uploaded from web link';
    case 'FILE_DOWNLOAD':
      return 'Downloaded file';
    case 'SHARE_CREATED':
      return 'Created share link';
    case 'SHARE_UNLOCKED':
      return 'Unlocked protected link';
    case 'SHARE_DOWNLOAD':
      return 'Shared link downloaded';
    case 'SHARE_AUTH_FAILED':
      return 'Wrong password entered';
    case 'TELEGRAM_SYNC':
      return 'Saved to Telegram Cloud';
    default:
      return 'Account activity';
  }
}

export const ActivityAndSpeedView: React.FC<ActivityAndSpeedViewProps> = ({
  settings,
  logs,
  onUpdateSettings,
}) => {
  return (
    <div className="space-y-8">
      {/* Section 1: Easy Download Speed Control */}
      <div className="space-y-4">
        <div className="border-b border-[#2C2824] pb-3">
          <h1 className="text-lg sm:text-xl font-bold text-[#F2EFE9] flex items-center gap-2">
            <Gauge className="w-5 h-5 text-[#D97757]" />
            Download Speed Control
          </h1>
          <p className="text-xs text-[#9E978E] mt-1">
            Tap to choose how fast files download from your drive and shared links.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {SPEED_OPTIONS.map((opt) => {
            const active = settings.globalThrottleKbps === opt.value;
            return (
              <button
                key={opt.label}
                onClick={() => onUpdateSettings({ globalThrottleKbps: opt.value })}
                className={`min-h-[68px] p-4 text-left border transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#24211D] border-[#D97757]'
                    : 'bg-[#1C1A17] border-[#2C2824] hover:border-[#D97757]'
                }`}
              >
                <div className="text-sm font-bold text-[#F2EFE9] flex items-center justify-between">
                  <span>{opt.label}</span>
                  {active && <Check className="w-4 h-4 text-[#D97757]" />}
                </div>
                <div className="text-xs text-[#9E978E] mt-1">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Section 2: Clean Recent Activity List */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#2C2824] pb-3">
          <div>
            <h2 className="text-lg font-bold text-[#F2EFE9] flex items-center gap-2">
              <Clock className="w-5 h-5 text-[#D97757]" />
              Recent Activity
            </h2>
            <p className="text-xs text-[#9E978E] mt-0.5">
              A simple timeline of uploads, downloads, and shared files.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              const header = 'id,timestamp,userName,action,targetName,bytesTransferred\n';
              const rows = logs
                .map(
                  (l) =>
                    `"${l.id}","${l.timestamp}","${l.userName}","${l.action}","${l.targetName.replace(
                      /"/g,
                      '""'
                    )}",${l.bytesTransferred}`
                )
                .join('\n');
              const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' });
              const blobUrl = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = blobUrl;
              a.download = 'unlimcloud-activity.csv';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
            }}
            className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#D97757]" />
            Download CSV
          </button>
        </div>

        <div className="bg-[#1C1A17] border border-[#2C2824] divide-y divide-[#2C2824]">
          {logs.slice(0, 25).map((log) => (
            <div
              key={log.id}
              className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 hover:bg-[#24211D]"
            >
              <div className="space-y-0.5 min-w-0">
                <div className="text-sm font-semibold text-[#F2EFE9] break-words">
                  {friendlyActionLabel(log.action)} —{' '}
                  <span className="text-[#D97757]">{log.targetName}</span>
                </div>
                <div className="text-xs text-[#9E978E]">
                  By {log.userName}
                  {log.bytesTransferred > 0 ? ` · ${formatBytes(log.bytesTransferred)}` : ''}
                </div>
              </div>
              <div className="text-xs text-[#9E978E] tabular-nums shrink-0">
                {formatShortDate(log.timestamp)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 3. SIMPLE TELEGRAM CLOUD SETUP VIEW
// ============================================================================

interface TelegramStorageViewProps {
  config: TelegramConfigState;
  onSaveConfig: (payload: {
    botToken?: string;
    chatId?: string;
    autoSyncUploads?: boolean;
    clearCredentials?: boolean;
  }) => Promise<void>;
}

export const TelegramStorageView: React.FC<TelegramStorageViewProps> = ({
  config,
  onSaveConfig,
}) => {
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState(config.chatId || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await onSaveConfig({
        botToken: botToken.trim() || undefined,
        chatId: chatId.trim(),
        autoSyncUploads: true,
      });
      setBotToken('');
      setSuccessMsg('Telegram Cloud connected! Your uploads will now save to Telegram.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not connect to Telegram');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="border-b border-[#2C2824] pb-4">
        <h1 className="text-lg sm:text-xl font-bold text-[#F2EFE9]">
          Telegram Unlimited Storage Setup
        </h1>
        <p className="text-xs text-[#9E978E] mt-1">
          Your drive works right away using built-in cloud storage. Connect your Telegram Bot
          below if you want files saved directly inside your private Telegram channel.
        </p>
      </div>

      <div className="p-4 sm:p-5 bg-[#1C1A17] border border-[#2C2824] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-[#2E9E6B] shrink-0 mt-0.5 sm:mt-0" />
          <div>
            <div className="text-sm font-bold text-[#F2EFE9]">
              {config.connected
                ? `Connected to Telegram Bot (@${config.botUsername || 'Active'})`
                : 'Built-In Unlimited Cloud Storage Active'}
            </div>
            <div className="text-xs text-[#9E978E]">
              {config.connected
                ? `Saving files to Telegram Channel ${config.chatId}`
                : 'Ready to upload and share files immediately'}
            </div>
          </div>
        </div>

        {config.connected && (
          <button
            type="button"
            onClick={() => onSaveConfig({ clearCredentials: true })}
            className="min-h-[44px] px-4 py-2 text-xs font-medium text-[#D94848] border border-[#2C2824] bg-[#141311] cursor-pointer"
          >
            Disconnect
          </button>
        )}
      </div>

      <form
        onSubmit={handleConnect}
        className="p-5 sm:p-6 bg-[#1C1A17] border border-[#2C2824] space-y-4"
      >
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-[#F2EFE9]">
            1. Telegram Bot Token (Optional — from @BotFather)
          </label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="Paste your Bot Token here..."
            className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2.5 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-[#F2EFE9]">
            2. Telegram Channel or Chat ID
          </label>
          <input
            type="text"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="e.g. -1002198471092"
            className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2.5 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
          />
        </div>

        {error && <p className="text-xs text-[#D94848]">{error}</p>}
        {successMsg && <p className="text-xs text-[#2E9E6B]">{successMsg}</p>}

        <div className="flex items-center justify-end pt-2 border-t border-[#2C2824]">
          <button
            type="submit"
            disabled={saving}
            className="w-full sm:w-auto min-h-[44px] flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer disabled:opacity-50"
          >
            {saving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {saving ? 'Connecting...' : 'Save Telegram Connection'}
          </button>
        </div>
      </form>
    </div>
  );
};
