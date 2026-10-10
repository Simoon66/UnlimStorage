import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Globe,
  Link2,
  Lock,
  Check,
  Download,
  UserCheck,
  LogIn,
  Copy,
  ExternalLink,
  FileText,
  AlertTriangle,
  Trash2,
  Coins,
  CreditCard,
  Smartphone,
  Sparkles,
  LogOut,
  Eye,
  FolderInput,
  Folder,
  FolderPlus,
  ChevronRight,
  RotateCcw,
  RotateCw,
  Maximize2,
  Film,
} from 'lucide-react';
import { FileRecord, FolderRecord, ShareLink, User } from '../types';
import { formatBytes, formatShortDate } from '../utils/format';
import {
  getClientBinaryBlob,
  resolveClientMimeType,
} from '../services/clientCloudFallback';

// ============================================================================
// 1. SIMPLE REMOTE URL UPLOAD MODAL
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
    label: 'Sample Document — Cloud Security Guide (Markdown)',
    url: 'https://raw.githubusercontent.com/inulute/unlim-cloud/main/README.md',
    fileName: 'Cloud-Security-Guide.md',
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
// 2. ONE-CLICK SHARE & PASSWORD TOGGLE MODAL
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
  const [createError, setCreateError] = useState<string | null>(null);

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
        .catch((err: unknown) => {
          if (active) {
            setCreateError(err instanceof Error ? err.message : 'Unable to share locked file');
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

        {createError ? (
          <div className="p-6 space-y-4 text-center">
            <p className="text-xs text-[#D94848]">{createError}</p>
            <button
              onClick={onClose}
              className="min-h-[44px] px-5 py-2 text-xs font-bold bg-[#D97757] text-[#141311] cursor-pointer"
            >
              Close
            </button>
          </div>
        ) : creating || !share ? (
          <div className="p-8 text-center text-sm text-[#9E978E]">
            Creating your direct download link...
          </div>
        ) : (
          <div className="p-5 sm:p-6 space-y-5">
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
// 3. RICH MULTI-FORMAT FILE PREVIEW MODAL (MKV, MP4, WebM, Images, Audio, PDF, Code)
// ============================================================================

interface FileDetailDrawerProps {
  file: FileRecord;
  currentFolderName?: string;
  firebaseUid?: string;
  firebaseEmail?: string;
  onClose: () => void;
  onDownload: (file: FileRecord) => void;
  onOpenShareModal: (file: FileRecord) => void;
  onOpenMoveModal?: (file: FileRecord) => void;
  onRequestDelete: (file: FileRecord) => void;
  onGoToPricing?: () => void;
}

export const FileDetailDrawer: React.FC<FileDetailDrawerProps> = ({
  file,
  currentFolderName,
  firebaseUid,
  firebaseEmail,
  onClose,
  onDownload,
  onOpenShareModal,
  onOpenMoveModal,
  onRequestDelete,
  onGoToPricing,
}) => {
  const [copiedText, setCopiedText] = useState(false);
  const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [videoContainerFallback, setVideoContainerFallback] = useState<'webm' | 'mp4'>('webm');
  const [videoPlaybackError, setVideoPlaybackError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const isMkv =
    /\.mkv$/i.test(file.name) || file.mimeType.toLowerCase().includes('matroska');
  const isImage =
    file.mimeType.startsWith('image/') ||
    /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(file.name);
  const isVideo =
    isMkv ||
    file.mimeType.startsWith('video/') ||
    /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
  const isAudio =
    file.mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/i.test(file.name);
  const isPdf = file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.name);

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;
    setVideoPlaybackError(null);

    getClientBinaryBlob(file.id)
      .then((blob) => {
        if (cancelled || !blob) return;
        let targetBlob = blob;
        if (isMkv) {
          // Wrap Matroska (.mkv) blob in a zero-copy WebM/MP4 MIME view so HTML5 <video> demuxes it natively
          const containerType =
            videoContainerFallback === 'mp4' ? 'video/mp4' : 'video/webm';
          targetBlob = new Blob([blob], { type: containerType });
        } else if (!blob.type || blob.type === 'application/octet-stream') {
          targetBlob = new Blob([blob], {
            type: resolveClientMimeType(file.name, file.mimeType),
          });
        }
        const objUrl = URL.createObjectURL(targetBlob);
        revokedUrl = objUrl;
        setLocalBlobUrl(objUrl);
      })
      .catch(() => null);

    return () => {
      cancelled = true;
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
    };
  }, [file.id, file.name, file.mimeType, isMkv, videoContainerFallback]);

  const serverInlineUrl = `/api/files/${encodeURIComponent(
    file.id
  )}/download?inline=1&uid=${encodeURIComponent(
    firebaseUid || ''
  )}&email=${encodeURIComponent(firebaseEmail || '')}`;

  const inlineUrl = localBlobUrl || file.previewDataUrl || serverInlineUrl;

  const handleCopyPreviewText = () => {
    if (!file.previewText) return;
    navigator.clipboard.writeText(file.previewText);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 1800);
  };

  const handleSkipSeconds = (delta: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(
      0,
      Math.min(
        videoRef.current.duration || Number.MAX_SAFE_INTEGER,
        videoRef.current.currentTime + delta
      )
    );
  };

  const handleChangeSpeed = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const handleFullscreen = () => {
    if (!videoRef.current) return;
    if (videoRef.current.requestFullscreen) {
      videoRef.current.requestFullscreen().catch(() => null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl bg-[#1C1A17] border-t sm:border border-[#2C2824] max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2C2824] sticky top-0 bg-[#1C1A17] z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <Eye className="w-4 h-4 text-[#D97757] shrink-0" />
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
          {/* Metadata Row */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#9E978E] tabular-nums">
            <span className="text-[#F2EFE9] font-semibold">{formatBytes(file.sizeBytes)}</span>
            <span aria-hidden="true">·</span>
            <span>Location: {currentFolderName || 'My Cloud Drive (Root)'}</span>
            <span aria-hidden="true">·</span>
            <span>Added {formatShortDate(file.createdAt)}</span>
            <span aria-hidden="true">·</span>
            <span>{file.downloadCount} downloads</span>
          </div>

          {/* Over-25GB Locked State vs. Live Rich Preview */}
          {file.lockedOverQuota ? (
            <div className="p-6 bg-[#141311] border border-[#D99B26] space-y-3 text-center">
              <div className="w-11 h-11 mx-auto bg-[#24211D] border border-[#D99B26] flex items-center justify-center">
                <Lock className="w-5 h-5 text-[#D99B26]" />
              </div>
              <div className="text-sm font-bold text-[#F2EFE9]">
                File Locked — Exceeds 25 GB Free Limit
              </div>
              <p className="text-xs text-[#9E978E] max-w-md mx-auto">
                Your monthly storage plan has expired. Your data is safely preserved for 3 months
                (90 days), but files above your first 25 GB require an active 50 GB or 1 TB plan to
                preview, download, or share.
              </p>
              {onGoToPricing && (
                <button
                  onClick={() => {
                    onClose();
                    onGoToPricing();
                  }}
                  className="min-h-[44px] px-5 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer"
                >
                  Extend Storage Plan with Tokens
                </button>
              )}
            </div>
          ) : isImage ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-[#9E978E]">Image Preview</div>
              <div className="p-3 bg-[#141311] border border-[#2C2824] flex items-center justify-center max-h-96 overflow-hidden">
                <img
                  src={inlineUrl}
                  alt={file.name}
                  className="max-h-80 w-auto object-contain"
                />
              </div>
            </div>
          ) : isVideo ? (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-medium text-[#9E978E]">
                  <Film className="w-3.5 h-3.5 text-[#D97757]" />
                  <span>{isMkv ? 'MKV Matroska Video Player' : 'HD Video Player'}</span>
                </div>
                <div className="flex items-center gap-1">
                  {[0.5, 1, 1.25, 1.5, 2].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => handleChangeSpeed(rate)}
                      className={`px-2 py-1 text-[11px] font-mono border cursor-pointer ${
                        playbackRate === rate
                          ? 'bg-[#D97757] text-[#141311] border-[#D97757] font-bold'
                          : 'bg-[#141311] text-[#9E978E] border-[#2C2824] hover:text-[#F2EFE9]'
                      }`}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-2.5 bg-[#141311] border border-[#2C2824] space-y-2.5">
                <video
                  key={`${file.id}_${videoContainerFallback}_${Boolean(localBlobUrl)}`}
                  ref={videoRef}
                  src={inlineUrl}
                  controls
                  playsInline
                  preload="metadata"
                  onError={() => {
                    if (isMkv && videoContainerFallback === 'webm') {
                      setVideoContainerFallback('mp4');
                    } else {
                      setVideoPlaybackError(
                        'Unable to decode this video stream in browser. If this file was uploaded before the large-file binary update (44B), please re-upload it once, or click Download below to play in VLC / Media Player.'
                      );
                    }
                  }}
                  className="w-full max-h-[360px] bg-black"
                />

                {/* MKV / Video Transport Controls Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSkipSeconds(-10)}
                      className="min-h-[34px] px-3 py-1 text-xs font-medium bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-[#D97757]" />
                      -10s
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSkipSeconds(10)}
                      className="min-h-[34px] px-3 py-1 text-xs font-medium bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCw className="w-3.5 h-3.5 text-[#D97757]" />
                      +10s
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleFullscreen}
                    className="min-h-[34px] px-3 py-1 text-xs font-medium bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1.5 cursor-pointer"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-[#D97757]" />
                    Fullscreen
                  </button>
                </div>

                {videoPlaybackError && (
                  <div className="p-3 bg-[#1C1A17] border border-[#D99B26] text-xs text-[#D99B26]">
                    {videoPlaybackError}
                  </div>
                )}
              </div>
            </div>
          ) : isAudio ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-[#9E978E]">Audio Player</div>
              <div className="p-5 bg-[#141311] border border-[#2C2824]">
                <audio src={inlineUrl} controls className="w-full" />
              </div>
            </div>
          ) : isPdf ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-[#9E978E]">PDF Document Preview</div>
              <iframe
                title={file.name}
                src={inlineUrl}
                className="w-full h-80 bg-[#141311] border border-[#2C2824]"
              />
            </div>
          ) : file.previewText ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#9E978E]">Document / Code Preview</span>
                <button
                  type="button"
                  onClick={handleCopyPreviewText}
                  className="min-h-[34px] px-3 py-1 text-xs font-medium bg-[#141311] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedText ? <Check className="w-3.5 h-3.5 text-[#2E9E6B]" /> : <Copy className="w-3.5 h-3.5 text-[#D97757]" />}
                  {copiedText ? 'Copied' : 'Copy Text'}
                </button>
              </div>
              <pre className="p-4 bg-[#141311] border border-[#2C2824] text-xs font-mono text-[#F2EFE9] overflow-x-auto max-h-72 whitespace-pre-wrap">
                {file.previewText}
              </pre>
            </div>
          ) : (
            <div className="p-8 bg-[#141311] border border-[#2C2824] text-center space-y-2">
              <FileText className="w-8 h-8 text-[#D97757] mx-auto" />
              <div className="text-sm font-bold text-[#F2EFE9]">{file.name}</div>
              <div className="text-xs text-[#9E978E]">
                Binary archive ({formatBytes(file.sizeBytes)}) ready for direct download or sharing.
              </div>
            </div>
          )}

          {/* Action Footer */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-3 border-t border-[#2C2824]">
            <button
              onClick={() => {
                onClose();
                onRequestDelete(file);
              }}
              className="min-h-[44px] px-4 py-2.5 text-xs font-medium text-[#D94848] border border-[#2C2824] bg-[#141311] hover:border-[#D94848] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete File
            </button>

            {!file.lockedOverQuota && (
              <div className="grid grid-cols-3 sm:flex items-center gap-2.5">
                {onOpenMoveModal && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenMoveModal(file);
                    }}
                    className="min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-[#F2EFE9] bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] cursor-pointer"
                  >
                    <FolderInput className="w-3.5 h-3.5 text-[#D97757]" />
                    Move
                  </button>
                )}
                <button
                  onClick={() => {
                    onClose();
                    onOpenShareModal(file);
                  }}
                  className="min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-[#F2EFE9] bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] cursor-pointer"
                >
                  <Link2 className="w-3.5 h-3.5 text-[#D97757]" />
                  Share
                </button>
                <button
                  onClick={() => onDownload(file)}
                  className="min-h-[44px] flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 3B. GOOGLE DRIVE-STYLE MOVE FILE MODAL (Move to Folder / Root + Create Folder)
// ============================================================================

interface MoveFileModalProps {
  file: FileRecord;
  folders: FolderRecord[];
  files: FileRecord[];
  onClose: () => void;
  onMoveFile: (file: FileRecord, targetFolderId: string | null) => Promise<void>;
  onCreateFolder: (name: string, parentId: string | null) => Promise<FolderRecord | null>;
}

export const MoveFileModal: React.FC<MoveFileModalProps> = ({
  file,
  folders,
  files,
  onClose,
  onMoveFile,
  onCreateFolder,
}) => {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(file.folderId);
  const [browsingParentId, setBrowsingParentId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [creatingSubfolder, setCreatingSubfolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const currentFolderObj = folders.find((f) => f.id === file.folderId) || null;
  const browsingFolderObj = folders.find((f) => f.id === browsingParentId) || null;

  const visibleFolders = folders.filter((f) => f.parentId === browsingParentId);

  const handleCreateNewFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setError(null);
    try {
      const created = await onCreateFolder(newFolderName.trim(), browsingParentId);
      if (created) {
        setSelectedFolderId(created.id);
        setNewFolderName('');
        setCreatingSubfolder(false);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create folder');
    }
  };

  const handleConfirmMove = async () => {
    if (selectedFolderId === file.folderId) {
      onClose();
      return;
    }
    setMoving(true);
    setError(null);
    try {
      await onMoveFile(file, selectedFolderId);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not move file');
    } finally {
      setMoving(false);
    }
  };

  const targetDestinationName =
    selectedFolderId === null
      ? 'My Cloud Drive (Root)'
      : folders.find((f) => f.id === selectedFolderId)?.name || 'Selected Folder';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-[#1C1A17] border-t sm:border border-[#2C2824] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2C2824] sticky top-0 bg-[#1C1A17] z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <FolderInput className="w-4 h-4 text-[#D97757] shrink-0" />
            <h2 className="text-base font-bold text-[#F2EFE9] truncate">
              Move &ldquo;{file.name}&rdquo;
            </h2>
          </div>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between text-xs text-[#9E978E]">
            <span>
              Current location:{' '}
              <strong className="text-[#F2EFE9]">
                {currentFolderObj ? currentFolderObj.name : 'My Cloud Drive (Root)'}
              </strong>
            </span>
            <button
              type="button"
              onClick={() => setCreatingSubfolder((prev) => !prev)}
              className="min-h-[34px] px-3 py-1 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1.5 cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5 text-[#D97757]" />
              New Folder
            </button>
          </div>

          {creatingSubfolder && (
            <form
              onSubmit={handleCreateNewFolder}
              className="p-3 bg-[#141311] border border-[#D97757] flex flex-col sm:flex-row gap-2"
            >
              <input
                type="text"
                required
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder name..."
                className="flex-1 min-h-[40px] bg-[#1C1A17] border border-[#2C2824] px-3 py-1.5 text-xs text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="min-h-[40px] px-4 py-1.5 text-xs font-bold bg-[#D97757] text-[#141311] cursor-pointer"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setCreatingSubfolder(false)}
                  className="min-h-[40px] px-3 py-1.5 text-xs text-[#9E978E] border border-[#2C2824] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Breadcrumb navigation inside Move modal */}
          <div className="flex items-center gap-1.5 text-xs text-[#9E978E] bg-[#141311] border border-[#2C2824] px-3 py-2">
            <button
              type="button"
              onClick={() => {
                setBrowsingParentId(null);
                setSelectedFolderId(null);
              }}
              className={`hover:text-[#F2EFE9] cursor-pointer ${
                browsingParentId === null ? 'text-[#D97757] font-bold' : ''
              }`}
            >
              My Cloud Drive (Root)
            </button>
            {browsingFolderObj && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-[#9E978E]" />
                <span className="text-[#F2EFE9] font-semibold truncate">
                  {browsingFolderObj.name}
                </span>
              </>
            )}
          </div>

          {/* Folder List */}
          <div className="border border-[#2C2824] bg-[#141311] divide-y divide-[#2C2824] max-h-64 overflow-y-auto">
            {/* Root Option */}
            <div
              onClick={() => setSelectedFolderId(null)}
              className={`px-4 py-3 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                selectedFolderId === null
                  ? 'bg-[#24211D] text-[#F2EFE9]'
                  : 'hover:bg-[#1C1A17] text-[#9E978E]'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Folder className="w-4 h-4 text-[#D97757] shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[#F2EFE9] truncate">
                    My Cloud Drive (Root)
                  </div>
                  <div className="text-[11px] text-[#9E978E]">
                    Main top-level cloud directory
                  </div>
                </div>
              </div>
              {selectedFolderId === null && (
                <Check className="w-4 h-4 text-[#D97757] shrink-0" />
              )}
            </div>

            {visibleFolders.map((folder) => {
              const isSelected = selectedFolderId === folder.id;
              const isCurrent = file.folderId === folder.id;
              const itemCount = files.filter((f) => f.folderId === folder.id).length;
              const hasSubfolders = folders.some((sub) => sub.parentId === folder.id);

              return (
                <div
                  key={folder.id}
                  onClick={() => setSelectedFolderId(folder.id)}
                  onDoubleClick={() => {
                    setBrowsingParentId(folder.id);
                    setSelectedFolderId(folder.id);
                  }}
                  className={`px-4 py-3 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[#24211D] text-[#F2EFE9]'
                      : 'hover:bg-[#1C1A17] text-[#9E978E]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Folder className="w-4 h-4 text-[#D97757] shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#F2EFE9] truncate">
                        {folder.name}{' '}
                        {isCurrent && (
                          <span className="text-[11px] font-normal text-[#9E978E]">
                            (Current)
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#9E978E]">
                        {itemCount} {itemCount === 1 ? 'file' : 'files'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isSelected && <Check className="w-4 h-4 text-[#D97757]" />}
                    {hasSubfolders && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBrowsingParentId(folder.id);
                          setSelectedFolderId(folder.id);
                        }}
                        className="px-2 py-1 text-[11px] bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] cursor-pointer"
                      >
                        Open
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {error && (
            <div className="p-3 bg-[#141311] border border-[#D94848] text-xs text-[#D94848]">
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-3 border-t border-[#2C2824]">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2.5 text-xs font-medium text-[#9E978E] border border-[#2C2824] bg-[#141311] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmMove}
              disabled={moving || selectedFolderId === file.folderId}
              className="min-h-[44px] px-5 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] disabled:opacity-50 cursor-pointer"
            >
              {moving
                ? 'Moving...'
                : selectedFolderId === file.folderId
                ? 'Already in This Folder'
                : `Move to "${targetDestinationName}"`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 4. DELETE CONFIRMATION MODAL (Files & Folders)
// ============================================================================

export interface DeleteTarget {
  type: 'file' | 'folder';
  id: string;
  name: string;
  subtitle?: string;
}

interface DeleteConfirmModalProps {
  target: DeleteTarget;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  target,
  onCancel,
  onConfirm,
}) => {
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      await onConfirm();
      onCancel();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-[#1C1A17] border-t sm:border border-[#D94848]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2C2824]">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[#D94848]" />
            <h2 className="text-base font-bold text-[#F2EFE9]">
              Confirm {target.type === 'folder' ? 'Folder' : 'File'} Deletion
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          <p className="text-xs sm:text-sm text-[#F2EFE9] leading-relaxed">
            Are you sure you want to permanently delete{' '}
            <strong className="text-[#D97757] break-all">&ldquo;{target.name}&rdquo;</strong>?
          </p>
          {target.subtitle && (
            <div className="p-3 bg-[#141311] border border-[#2C2824] text-xs text-[#9E978E]">
              {target.subtitle}
            </div>
          )}
          <p className="text-xs text-[#9E978E]">
            {target.type === 'file'
              ? 'This file and any active shared download links pointing to it will be permanently removed.'
              : 'This folder will be removed and any files inside will be moved safely to your main drive.'}
          </p>

          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[#2C2824]">
            <button
              type="button"
              onClick={onCancel}
              disabled={deleting}
              className="min-h-[44px] px-4 py-2.5 text-xs font-semibold text-[#F2EFE9] bg-[#141311] border border-[#2C2824] hover:border-[#9E978E] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={deleting}
              className="min-h-[44px] px-4 py-2.5 text-xs font-bold bg-[#D94848] text-[#F2EFE9] hover:bg-[#e05858] flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
              {deleting ? 'Deleting...' : 'Yes, Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 5. BUY TOKENS & PROMO CODE ('1tBfri26') CHECKOUT MODAL (BDT & USD)
// ============================================================================

interface BuyTokensModalProps {
  currentBalance: number;
  onClose: () => void;
  onRedeemPromo: (code: string) => Promise<string>;
  onPurchaseTokens: (payload: {
    tokens: number;
    paymentMethod: string;
    amountLabel: string;
  }) => Promise<string>;
}

const TOKEN_PACKAGES = [
  {
    tokens: 500,
    tag: '50 GB Monthly Pack',
    bdtPrice: '৳450 BDT',
    usdPrice: '$4.50 USD',
  },
  {
    tokens: 1024,
    tag: '1 TB Monthly Pack (Best Value)',
    bdtPrice: '৳850 BDT',
    usdPrice: '$8.50 USD',
  },
  {
    tokens: 2500,
    tag: 'Multi-Month Pro Bundle',
    bdtPrice: '৳1,900 BDT',
    usdPrice: '$19.00 USD',
  },
  {
    tokens: 5000,
    tag: 'Power Vault Bundle',
    bdtPrice: '৳3,500 BDT',
    usdPrice: '$35.00 USD',
  },
];

export const BuyTokensModal: React.FC<BuyTokensModalProps> = ({
  currentBalance,
  onClose,
  onRedeemPromo,
  onPurchaseTokens,
}) => {
  const [selectedTokens, setSelectedTokens] = useState(1024);
  const [paymentMethod, setPaymentMethod] = useState<'bkash' | 'nagad' | 'bdt_card' | 'usd_card'>(
    'bkash'
  );
  const [accountNumber, setAccountNumber] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const selectedPkg =
    TOKEN_PACKAGES.find((p) => p.tokens === selectedTokens) || TOKEN_PACKAGES[1];
  const isUsd = paymentMethod === 'usd_card';

  const handleApplyPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoCode.trim()) return;
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const msg = await onRedeemPromo(promoCode.trim());
      setSuccessMsg(msg);
      setPromoCode('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid promo code');
    } finally {
      setBusy(false);
    }
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const methodLabel =
        paymentMethod === 'bkash'
          ? 'bKash (BDT)'
          : paymentMethod === 'nagad'
          ? 'Nagad (BDT)'
          : paymentMethod === 'bdt_card'
          ? 'BDT Card'
          : 'USD Card';
      const amountLabel = isUsd ? selectedPkg.usdPrice : selectedPkg.bdtPrice;
      const msg = await onPurchaseTokens({
        tokens: selectedPkg.tokens,
        paymentMethod: methodLabel,
        amountLabel,
      });
      setSuccessMsg(msg);
      setAccountNumber('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-xl bg-[#1C1A17] border-t sm:border border-[#2C2824] max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2C2824] sticky top-0 bg-[#1C1A17] z-10">
          <div className="flex items-center gap-2.5">
            <Coins className="w-4 h-4 text-[#D97757]" />
            <h2 className="text-base font-bold text-[#F2EFE9]">
              Buy Storage Tokens & Promo Code
            </h2>
          </div>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-6">
          {/* Wallet Balance Banner */}
          <div className="p-4 bg-[#141311] border border-[#2C2824] flex items-center justify-between">
            <div>
              <div className="text-xs text-[#9E978E]">Current Wallet Balance</div>
              <div className="text-xl font-bold text-[#F2EFE9] tabular-nums mt-0.5">
                {currentBalance.toLocaleString()}{' '}
                <span className="text-xs font-semibold text-[#D97757]">Tokens</span>
              </div>
            </div>
            <div className="text-right text-xs text-[#9E978E]">
              <div>50 GB = 500 Tokens/mo</div>
              <div>1 TB = 1,024 Tokens/mo</div>
            </div>
          </div>

          {/* Promo Code Redemption Section */}
          <form
            onSubmit={handleApplyPromo}
            className="p-4 bg-[#24211D] border border-[#D97757]/60 space-y-3"
          >
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#F2EFE9] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#D97757]" />
                Have a Promo Code?
              </label>
              <span className="text-[11px] text-[#9E978E]">Instant Token Credit</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                placeholder="Enter promo code..."
                className="flex-1 min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2 text-xs font-mono text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
              />
              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] px-5 py-2 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer shrink-0"
              >
                Apply Promo Code
              </button>
            </div>
          </form>

          {error && (
            <div className="p-3 bg-[#141311] border border-[#D94848] text-xs text-[#D94848]">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="p-3 bg-[#141311] border border-[#2E9E6B] text-xs text-[#2E9E6B] font-semibold">
              {successMsg}
            </div>
          )}

          {/* Real Money Checkout Form (bKash, Nagad, BDT Card, USD Card) */}
          <form onSubmit={handleCheckout} className="space-y-4 pt-2 border-t border-[#2C2824]">
            <div className="text-xs font-bold text-[#F2EFE9] uppercase tracking-wider">
              1. Select Token Package
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {TOKEN_PACKAGES.map((pkg) => {
                const active = selectedTokens === pkg.tokens;
                return (
                  <button
                    key={pkg.tokens}
                    type="button"
                    onClick={() => setSelectedTokens(pkg.tokens)}
                    className={`p-3.5 text-left border transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#24211D] border-[#D97757]'
                        : 'bg-[#141311] border-[#2C2824] hover:border-[#9E978E]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-[#F2EFE9] tabular-nums">
                        {pkg.tokens.toLocaleString()} Tokens
                      </span>
                      <span className="text-xs font-bold text-[#D97757] tabular-nums">
                        {isUsd ? pkg.usdPrice : pkg.bdtPrice}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#9E978E] mt-1">{pkg.tag}</div>
                  </button>
                );
              })}
            </div>

            <div className="text-xs font-bold text-[#F2EFE9] uppercase tracking-wider pt-2">
              2. Choose Payment Method (BDT / USD)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'bkash', label: 'bKash (BDT)', icon: Smartphone },
                { id: 'nagad', label: 'Nagad (BDT)', icon: Smartphone },
                { id: 'bdt_card', label: 'BDT Card', icon: CreditCard },
                { id: 'usd_card', label: 'USD Card ($)', icon: CreditCard },
              ].map((m) => {
                const Icon = m.icon;
                const active = paymentMethod === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      setPaymentMethod(m.id as 'bkash' | 'nagad' | 'bdt_card' | 'usd_card')
                    }
                    className={`min-h-[44px] px-3 py-2 text-xs font-semibold border flex items-center justify-center gap-1.5 cursor-pointer ${
                      active
                        ? 'bg-[#24211D] border-[#D97757] text-[#F2EFE9]'
                        : 'bg-[#141311] border-[#2C2824] text-[#9E978E]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 text-[#D97757]" />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs text-[#9E978E]">
                {paymentMethod === 'bkash' || paymentMethod === 'nagad'
                  ? 'Mobile Wallet Number'
                  : 'Card Number'}
              </label>
              <input
                type="text"
                required
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder={
                  paymentMethod === 'bkash' || paymentMethod === 'nagad'
                    ? '017XXXXXXXX'
                    : '4242 •••• •••• 4242'
                }
                className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
              />
            </div>

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-3 border-t border-[#2C2824]">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 py-2.5 text-xs font-medium text-[#9E978E] border border-[#2C2824] bg-[#141311] cursor-pointer"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] px-6 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer"
              >
                {busy
                  ? 'Processing...'
                  : `Pay ${isUsd ? selectedPkg.usdPrice : selectedPkg.bdtPrice} & Get ${selectedPkg.tokens.toLocaleString()} Tokens`}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 6. FIREBASE GOOGLE AUTH & ACCOUNT MODAL
// ============================================================================

interface AuthModalProps {
  currentUser: User;
  isAdmin: boolean;
  onClose: () => void;
  onGoogleSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  currentUser,
  isAdmin,
  onClose,
  onGoogleSignIn,
  onSignOut,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleClick = async () => {
    setBusy(true);
    setError(null);
    try {
      await onGoogleSignIn();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google Sign-In failed');
    } finally {
      setBusy(false);
    }
  };

  const planLabel =
    currentUser.planId === 'ultra_1tb'
      ? '1 TB Ultra Plan'
      : currentUser.planId === 'pro_50gb'
      ? '50 GB Pro Plan'
      : '25 GB Free Plan';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-[#1C1A17] border-t sm:border border-[#2C2824] max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2C2824]">
          <h2 className="text-base font-bold text-[#F2EFE9]">Account & Cloud Security</h2>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {/* Active Profile Card */}
          <div className="p-4 bg-[#141311] border border-[#D97757] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#D97757]">
                {isAdmin ? 'Administrator Account' : 'Personal Cloud Account'}
              </span>
              <span className="text-[11px] text-[#2E9E6B] font-medium flex items-center gap-1">
                <UserCheck className="w-3.5 h-3.5" /> Google Verified
              </span>
            </div>
            <div className="text-sm font-bold text-[#F2EFE9] truncate">{currentUser.name}</div>
            <div className="text-xs text-[#9E978E] truncate">{currentUser.email}</div>
            <div className="pt-2 border-t border-[#2C2824] flex items-center justify-between text-xs text-[#9E978E]">
              <span>Active Plan:</span>
              <strong className="text-[#F2EFE9]">{planLabel}</strong>
            </div>
          </div>

          {/* Switch Google Account Button */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleGoogleClick}
              disabled={busy}
              className="w-full min-h-[46px] px-4 py-2.5 text-xs font-bold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <LogIn className="w-4 h-4 text-[#D97757]" />
              {busy ? 'Connecting to Google...' : 'Switch Google Account'}
            </button>
            {error && <p className="text-xs text-[#D94848]">{error}</p>}
          </div>

          <div className="pt-3 border-t border-[#2C2824] flex items-center justify-between">
            <button
              type="button"
              onClick={async () => {
                await onSignOut();
                onClose();
              }}
              className="min-h-[40px] px-4 py-2 text-xs font-medium text-[#D94848] border border-[#2C2824] bg-[#141311] hover:border-[#D94848] flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-5 py-2 text-xs font-semibold text-[#F2EFE9] bg-[#24211D] border border-[#2C2824] cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
