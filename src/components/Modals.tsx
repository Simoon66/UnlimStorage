import React, { useState, useEffect } from 'react';
import {
  X,
  Globe,
  Link2,
  Lock,
  Check,
  Download,
  UserCheck,
  UserPlus,
  LogIn,
  Copy,
  ExternalLink,
  FileText,
} from 'lucide-react';
import { FileRecord, FolderRecord, ShareLink, User } from '../types';
import { formatBytes, formatShortDate } from '../utils/format';

// ============================================================================
// 1. SIMPLE REMOTE URL UPLOAD MODAL (Mobile Bottom-Sheet + Desktop Modal)
// ============================================================================

interface RemoteUploadModalProps {
  folders: FolderRecord[];
  currentFolderId: string | null;
  onClose: () => void;
  onStartRemoteUpload: (payload: {
    url: string;
    customFileName?: string;
    folderId: string | null;
    syncToTelegram: boolean;
  }) => Promise<void>;
}

const SAMPLE_REMOTE_URLS = [
  {
    label: 'Sample Document — UnlimCloud Guide (Markdown)',
    url: 'https://raw.githubusercontent.com/inulute/unlim-cloud/main/README.md',
    fileName: 'UnlimCloud-Guide.md',
  },
  {
    label: 'Sample Config — TypeScript Schema (JSON)',
    url: 'https://json.schemastore.org/tsconfig.json',
    fileName: 'tsconfig-sample.json',
  },
];

export const RemoteUploadModal: React.FC<RemoteUploadModalProps> = ({
  folders,
  currentFolderId,
  onClose,
  onStartRemoteUpload,
}) => {
  const [url, setUrl] = useState('');
  const [customFileName, setCustomFileName] = useState('');
  const [folderId, setFolderId] = useState<string | null>(currentFolderId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onStartRemoteUpload({
        url: url.trim(),
        customFileName: customFileName.trim() || undefined,
        folderId,
        syncToTelegram: true,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not fetch file from link');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-[#1C1A17] border-t sm:border border-[#2C2824] max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2C2824] sticky top-0 bg-[#1C1A17] z-10">
          <div className="flex items-center gap-2.5">
            <Globe className="w-4 h-4 text-[#D97757]" />
            <h2 className="text-base font-bold text-[#F2EFE9]">Upload from Web Link</h2>
          </div>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-[#F2EFE9]">
              Paste any direct file link (URL)
            </label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/file.pdf"
              className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2.5 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
            />
          </div>

          <div className="space-y-1.5">
            <div className="text-xs text-[#9E978E]">Or tap a sample link to test:</div>
            <div className="grid grid-cols-1 gap-2">
              {SAMPLE_REMOTE_URLS.map((preset) => (
                <button
                  key={preset.url}
                  type="button"
                  onClick={() => {
                    setUrl(preset.url);
                    setCustomFileName(preset.fileName);
                  }}
                  className="min-h-[44px] text-left px-3.5 py-2.5 text-xs bg-[#141311] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center justify-between gap-2 cursor-pointer"
                >
                  <span className="truncate">{preset.label}</span>
                  <span className="text-[#D97757] font-semibold shrink-0">Use Link</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs text-[#9E978E]">Save As Name (Optional)</label>
              <input
                type="text"
                value={customFileName}
                onChange={(e) => setCustomFileName(e.target.value)}
                placeholder="Automatic from link"
                className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs text-[#9E978E]">Save Inside Folder</label>
              <select
                value={folderId || ''}
                onChange={(e) => setFolderId(e.target.value || null)}
                className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
              >
                <option value="">My Files (Main Drive)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-xs text-[#D94848]">{error}</p>}

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-3 border-t border-[#2C2824]">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2.5 text-xs font-medium text-[#9E978E] hover:text-[#F2EFE9] border border-[#2C2824] bg-[#141311] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] px-5 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'Starting Transfer...' : 'Upload to My Drive'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ============================================================================
// 2. ONE-CLICK SHARE & PASSWORD TOGGLE MODAL (Mobile Ergonomic)
// ============================================================================

interface CreateShareModalProps {
  file: FileRecord;
  existingShare?: ShareLink;
  defaultThrottleKbps: number | null;
  onClose: () => void;
  onCreateShare: (payload: {
    fileId: string;
    customSlug?: string;
    password?: string;
    expiresInHours?: number | null;
    maxDownloads?: number | null;
    throttleKbps?: number | null;
    bandwidthCapMb?: number | null;
  }) => Promise<ShareLink>;
  onUpdateShare: (
    shareId: string,
    patch: {
      active?: boolean;
      throttleKbps?: number | null;
      password?: string | null;
    }
  ) => Promise<ShareLink>;
  onPreviewPublicPortal: (token: string) => void;
}

export const CreateShareModal: React.FC<CreateShareModalProps> = ({
  file,
  existingShare,
  defaultThrottleKbps,
  onClose,
  onCreateShare,
  onUpdateShare,
  onPreviewPublicPortal,
}) => {
  const [share, setShare] = useState<ShareLink | null>(existingShare || null);
  const [creating, setCreating] = useState(!existingShare);
  const [copied, setCopied] = useState(false);

  const [usePassword, setUsePassword] = useState<boolean>(
    existingShare ? existingShare.hasPassword : false
  );
  const [passwordInput, setPasswordInput] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!existingShare) {
      setCreating(true);
      onCreateShare({
        fileId: file.id,
        throttleKbps: defaultThrottleKbps,
      })
        .then((created) => {
          if (active) {
            setShare(created);
            setUsePassword(created.hasPassword);
          }
        })
        .finally(() => {
          if (active) setCreating(false);
        });
    }
    return () => {
      active = false;
    };
  }, [existingShare, file.id, defaultThrottleKbps, onCreateShare]);

  const shareUrl = share
    ? `${window.location.origin}/?share=${encodeURIComponent(share.token)}`
    : '';

  const copyShareUrl = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTogglePassword = async (checked: boolean) => {
    setUsePassword(checked);
    setSavedNotice(null);
    if (!checked && share && share.hasPassword) {
      setSavingSettings(true);
      try {
        const updated = await onUpdateShare(share.id, { password: null });
        setShare(updated);
        setPasswordInput('');
        setSavedNotice('Password removed — anyone with the link can download.');
      } finally {
        setSavingSettings(false);
      }
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!share || !passwordInput.trim()) return;
    setSavingSettings(true);
    setSavedNotice(null);
    try {
      const updated = await onUpdateShare(share.id, { password: passwordInput.trim() });
      setShare(updated);
      setSavedNotice('Password saved! Link is now password-protected.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSpeedChange = async (val: string) => {
    if (!share) return;
    setSavingSettings(true);
    setSavedNotice(null);
    try {
      const updated = await onUpdateShare(share.id, {
        throttleKbps: val ? Number(val) : null,
      });
      setShare(updated);
      setSavedNotice('Download speed limit updated.');
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-[#1C1A17] border-t sm:border border-[#2C2824] max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2C2824] sticky top-0 bg-[#1C1A17] z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <Link2 className="w-4 h-4 text-[#D97757] shrink-0" />
            <h2 className="text-base font-bold text-[#F2EFE9] truncate">
              Share &ldquo;{file.name}&rdquo;
            </h2>
          </div>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {creating || !share ? (
          <div className="p-8 text-center text-sm text-[#9E978E]">
            Creating your direct download link...
          </div>
        ) : (
          <div className="p-5 sm:p-6 space-y-5">
            {/* Step 1: One-Click Copy Link Box */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-[#F2EFE9]">
                Direct Download Link (Ready to Share)
              </label>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="flex-1 min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2.5 text-xs font-mono text-[#F2EFE9]"
                />
                <button
                  type="button"
                  onClick={copyShareUrl}
                  className="min-h-[44px] px-5 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
              </div>
            </div>

            {/* Step 2: Optional Password Toggle */}
            <div className="p-4 bg-[#141311] border border-[#2C2824] space-y-3">
              <label className="flex items-center justify-between gap-3 cursor-pointer min-h-[44px]">
                <div className="flex items-center gap-2.5">
                  <Lock className="w-4 h-4 text-[#D97757] shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-[#F2EFE9]">
                      Protect link with a password
                    </div>
                    <div className="text-[11px] text-[#9E978E]">
                      Require visitors to enter a password before downloading
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={usePassword}
                  onChange={(e) => handleTogglePassword(e.target.checked)}
                  className="accent-[#D97757] w-5 h-5 shrink-0"
                />
              </label>

              {usePassword && (
                <form
                  onSubmit={handleSavePassword}
                  className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2"
                >
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    placeholder={
                      share.hasPassword
                        ? 'Password is active (type new to change)'
                        : 'Type a password...'
                    }
                    className="flex-1 min-h-[44px] bg-[#1C1A17] border border-[#2C2824] px-3.5 py-2 text-xs text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                    required
                  />
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="min-h-[44px] px-4 py-2 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] shrink-0 cursor-pointer"
                  >
                    {savingSettings ? 'Saving...' : 'Save Password'}
                  </button>
                </form>
              )}
            </div>

            {/* Step 3: Simple Download Speed Limit */}
            <div className="p-4 bg-[#141311] border border-[#2C2824] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-[#F2EFE9]">Download Speed Limit</div>
                <div className="text-[11px] text-[#9E978E]">
                  Control how much bandwidth this shared link can use
                </div>
              </div>
              <select
                value={share.throttleKbps || ''}
                onChange={(e) => handleSpeedChange(e.target.value)}
                className="min-h-[44px] bg-[#1C1A17] border border-[#2C2824] px-3 py-2 text-xs text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
              >
                <option value="">Full Speed (Unlimited)</option>
                <option value="2048">Fast (2 MB/s)</option>
                <option value="1024">Standard (1 MB/s)</option>
                <option value="512">Data Saver (512 KB/s)</option>
              </select>
            </div>

            {savedNotice && <p className="text-xs text-[#2E9E6B]">{savedNotice}</p>}

            {/* Footer Buttons */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-3 border-t border-[#2C2824]">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onPreviewPublicPortal(share.token);
                }}
                className="min-h-[44px] flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-medium text-[#F2EFE9] bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open Download Page
              </button>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-6 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 3. SIMPLE FILE PREVIEW MODAL (Mobile Bottom-Sheet + Desktop Modal)
// ============================================================================

interface FileDetailDrawerProps {
  file: FileRecord;
  onClose: () => void;
  onDownload: (file: FileRecord) => void;
  onOpenShareModal: (file: FileRecord) => void;
  onDelete: (file: FileRecord) => Promise<void>;
}

export const FileDetailDrawer: React.FC<FileDetailDrawerProps> = ({
  file,
  onClose,
  onDownload,
  onOpenShareModal,
  onDelete,
}) => {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-xl bg-[#1C1A17] border-t sm:border border-[#2C2824] max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2C2824] sticky top-0 bg-[#1C1A17] z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <FileText className="w-4 h-4 text-[#D97757] shrink-0" />
            <h2 className="text-base font-bold text-[#F2EFE9] truncate">{file.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#9E978E] tabular-nums">
            <span className="text-[#F2EFE9] font-semibold">{formatBytes(file.sizeBytes)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {file.storageDriver === 'telegram'
                ? 'Stored in Telegram Cloud'
                : 'Stored in Cloud Drive'}
            </span>
            <span aria-hidden="true">·</span>
            <span>Added {formatShortDate(file.createdAt)}</span>
            <span aria-hidden="true">·</span>
            <span>{file.downloadCount} downloads</span>
          </div>

          {file.previewText ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-[#9E978E]">File Preview</div>
              <pre className="p-4 bg-[#141311] border border-[#2C2824] text-xs font-mono text-[#F2EFE9] overflow-x-auto max-h-60 whitespace-pre-wrap">
                {file.previewText}
              </pre>
            </div>
          ) : (
            <div className="p-8 bg-[#141311] border border-[#2C2824] text-center text-xs text-[#9E978E]">
              This file is ready for direct download or sharing.
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-3 border-t border-[#2C2824]">
            <button
              onClick={async () => {
                await onDelete(file);
                onClose();
              }}
              className="min-h-[44px] px-4 py-2.5 text-xs font-medium text-[#D94848] border border-[#2C2824] bg-[#141311] hover:border-[#D94848] cursor-pointer"
            >
              Delete File
            </button>

            <div className="grid grid-cols-2 sm:flex items-center gap-2.5">
              <button
                onClick={() => {
                  onClose();
                  onOpenShareModal(file);
                }}
                className="min-h-[44px] flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-[#F2EFE9] bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] cursor-pointer"
              >
                <Link2 className="w-3.5 h-3.5 text-[#D97757]" />
                Share Link
              </button>
              <button
                onClick={() => onDownload(file)}
                className="min-h-[44px] flex items-center justify-center gap-1.5 px-5 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 4. USER ACCOUNT SWITCHER & LOGIN MODAL (Mobile Ergonomic)
// ============================================================================

interface AuthModalProps {
  currentUser: User;
  users: User[];
  onClose: () => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (
    name: string,
    email: string,
    password: string,
    role: 'admin' | 'member'
  ) => Promise<void>;
  onSwitchUser: (userId: string) => Promise<void>;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  currentUser,
  users,
  onClose,
  onLogin,
  onRegister,
  onSwitchUser,
}) => {
  const [tab, setTab] = useState<'switch' | 'login' | 'register'>('switch');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (tab === 'login') {
        await onLogin(email, password);
      } else {
        await onRegister(name, email, password, role);
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-[#1C1A17] border-t sm:border border-[#2C2824] max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2C2824]">
          <h2 className="text-base font-bold text-[#F2EFE9]">Account & Sign In</h2>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-3 border-b border-[#2C2824] bg-[#141311] text-xs font-medium">
          <button
            type="button"
            onClick={() => {
              setTab('switch');
              setError(null);
            }}
            className={`min-h-[44px] py-2.5 flex items-center justify-center gap-1.5 border-r border-[#2C2824] cursor-pointer ${
              tab === 'switch'
                ? 'bg-[#1C1A17] text-[#D97757] font-bold'
                : 'text-[#9E978E] hover:text-[#F2EFE9]'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            Switch
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('login');
              setError(null);
            }}
            className={`min-h-[44px] py-2.5 flex items-center justify-center gap-1.5 border-r border-[#2C2824] cursor-pointer ${
              tab === 'login'
                ? 'bg-[#1C1A17] text-[#D97757] font-bold'
                : 'text-[#9E978E] hover:text-[#F2EFE9]'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('register');
              setError(null);
            }}
            className={`min-h-[44px] py-2.5 flex items-center justify-center gap-1.5 cursor-pointer ${
              tab === 'register'
                ? 'bg-[#1C1A17] text-[#D97757] font-bold'
                : 'text-[#9E978E] hover:text-[#F2EFE9]'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Register
          </button>
        </div>

        {tab === 'switch' ? (
          <div className="p-5 sm:p-6 space-y-3">
            {users.map((u) => {
              const isCurrent = u.id === currentUser.id;
              return (
                <div
                  key={u.id}
                  className={`p-3.5 border flex items-center justify-between gap-3 ${
                    isCurrent
                      ? 'bg-[#24211D] border-[#D97757]'
                      : 'bg-[#141311] border-[#2C2824]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[#F2EFE9] truncate">{u.name}</div>
                    <div className="text-xs text-[#9E978E] truncate">{u.email}</div>
                  </div>
                  {isCurrent ? (
                    <span className="text-xs font-medium text-[#2E9E6B] shrink-0">Active</span>
                  ) : (
                    <button
                      type="button"
                      onClick={async () => {
                        await onSwitchUser(u.id);
                        onClose();
                      }}
                      className="min-h-[40px] px-4 py-2 text-xs font-semibold bg-[#D97757] text-[#141311] shrink-0 cursor-pointer"
                    >
                      Switch
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <form onSubmit={handleAuthSubmit} className="p-5 sm:p-6 space-y-4">
            {tab === 'register' && (
              <div className="space-y-1.5">
                <label className="block text-xs text-[#9E978E]">Your Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs text-[#9E978E]">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@unlim.cloud"
                className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs text-[#9E978E]">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={tab === 'login' ? 'Demo: admin123' : 'Create a password'}
                className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
              />
            </div>

            {error && <p className="text-xs text-[#D94848]">{error}</p>}

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-2 border-t border-[#2C2824]">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 py-2 text-xs font-medium text-[#9E978E] border border-[#2C2824] bg-[#141311] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] px-5 py-2 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer"
              >
                {busy ? 'Please wait...' : tab === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
