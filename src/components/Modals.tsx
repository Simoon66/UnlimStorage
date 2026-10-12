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
  Tag,
  Plus,
} from 'lucide-react';
import { FileRecord, FolderRecord, ShareLink, User } from '../types';
import { formatBytes, formatShortDate } from '../utils/format';
import {
  getClientBinaryBlob,
  getMemoryBinaryBlobSync,
  resolveClientMimeType,
} from '../services/clientCloudFallback';
import { YouTubeIframePlayer } from './YouTubeIframePlayer';

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
    <div className="animate-app-backdrop fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="animate-app-modal w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-[#1C1A17] border-t sm:border border-[#2C2824] shadow-2xl max-h-[92vh] overflow-y-auto">
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
  file?: FileRecord | null;
  folder?: FolderRecord | null;
  existingShare?: ShareLink;
  defaultThrottleKbps: number | null;
  onClose: () => void;
  onCreateShare: (payload: {
    fileId: string;
    folderId?: string;
    targetType?: 'file' | 'folder';
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
  folder,
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
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  const [usePassword, setUsePassword] = useState<boolean>(
    existingShare ? existingShare.hasPassword : false
  );
  const [passwordInput, setPasswordInput] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const targetName = folder ? folder.name : file?.name || 'Item';
  const targetId = folder ? folder.id : file?.id || '';
  const isFolderShare = Boolean(folder);

  const isVideoFile =
    !isFolderShare &&
    Boolean(
      file &&
        (file.mimeType.startsWith('video/') ||
          /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name))
    );

  useEffect(() => {
    let active = true;
    if (!existingShare && targetId) {
      setCreating(true);
      onCreateShare({
        fileId: targetId,
        folderId: folder ? folder.id : undefined,
        targetType: folder ? 'folder' : 'file',
        throttleKbps: null,
      })
        .then((created) => {
          if (active) {
            setShare(created);
            setUsePassword(created.hasPassword);
          }
        })
        .catch((err: unknown) => {
          if (active) {
            setCreateError(err instanceof Error ? err.message : 'Unable to create share link');
          }
        })
        .finally(() => {
          if (active) setCreating(false);
        });
    }
    return () => {
      active = false;
    };
  }, [existingShare, targetId, folder, defaultThrottleKbps, onCreateShare]);

  const shareUrl = share
    ? `${window.location.origin}/?share=${encodeURIComponent(share.token)}`
    : '';

  const embedIframeCode = share
    ? `<iframe src="${window.location.origin}/?share=${encodeURIComponent(share.token)}&embed=1" width="100%" height="480" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>`
    : '';

  const copyShareUrl = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyEmbedCode = () => {
    if (!embedIframeCode) return;
    navigator.clipboard.writeText(embedIframeCode);
    setCopiedEmbed(true);
    setTimeout(() => setCopiedEmbed(false), 2000);
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
    <div className="animate-app-backdrop fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="animate-app-modal w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-[#1C1A17] border-t sm:border border-[#2C2824] shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2C2824] sticky top-0 bg-[#1C1A17] z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            {isFolderShare ? (
              <Folder className="w-4 h-4 text-[#D97757] shrink-0" />
            ) : (
              <Link2 className="w-4 h-4 text-[#D97757] shrink-0" />
            )}
            <h2 className="text-base font-bold text-[#F2EFE9] truncate">
              {isFolderShare
                ? `Share Folder Gallery: “${targetName}”`
                : `Share “${targetName}”`}
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
            {isFolderShare
              ? 'Creating your public folder gallery link...'
              : 'Creating your direct download link...'}
          </div>
        ) : (
          <div className="p-5 sm:p-6 space-y-5">
            <div className="space-y-2">
              <label className="block text-xs font-medium text-[#F2EFE9]">
                {isFolderShare
                  ? 'Public Folder Gallery Link (Grid/List View + Video Streaming + ZIP Download)'
                  : 'Direct Download Link (Ready to Share)'}
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

            {isVideoFile && !usePassword && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-[#F2EFE9]">
                  JW Player Iframe Embed Code
                </label>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={embedIframeCode}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className="flex-1 min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2.5 text-xs font-mono text-[#9E978E]"
                  />
                  <button
                    type="button"
                    onClick={copyEmbedCode}
                    className="min-h-[44px] px-4 py-2.5 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    {copiedEmbed ? <Check className="w-4 h-4 text-[#2E9E6B]" /> : <Copy className="w-4 h-4 text-[#D97757]" />}
                    {copiedEmbed ? 'Iframe Copied!' : 'Copy Iframe'}
                  </button>
                </div>
              </div>
            )}

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

            <div className="p-3.5 bg-[#141311] border border-[#2C2824] flex items-center justify-between gap-3 text-xs">
              <div>
                <div className="font-semibold text-[#F2EFE9]">Transfer Speed</div>
                <div className="text-[11px] text-[#9E978E]">
                  Recipients download at full unlimited speed matching their connection
                </div>
              </div>
              <span className="px-2.5 py-1 text-[11px] font-bold bg-[#24211D] border border-[#2C2824] text-[#2E9E6B] shrink-0">
                Unlimited Speed
              </span>
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
  isSavedOffline?: boolean;
  onClose: () => void;
  onDownload: (file: FileRecord) => void;
  onOpenShareModal: (file: FileRecord) => void;
  onOpenMoveModal?: (file: FileRecord) => void;
  onOpenCopyModal?: (file: FileRecord) => void;
  onToggleOffline?: (file: FileRecord) => void;
  onRequestDelete: (file: FileRecord) => void;
  onGoToPricing?: () => void;
}

export const FileDetailDrawer: React.FC<FileDetailDrawerProps> = ({
  file,
  currentFolderName,
  firebaseUid,
  firebaseEmail,
  isSavedOffline,
  onClose,
  onDownload,
  onOpenShareModal,
  onOpenMoveModal,
  onOpenCopyModal,
  onToggleOffline,
  onRequestDelete,
  onGoToPricing,
}) => {
  const [copiedText, setCopiedText] = useState(false);
  const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);
  const [rawBlob, setRawBlob] = useState<Blob | null>(null);
  const [videoContainerFallback, setVideoContainerFallback] = useState<'webm' | 'mp4'>('webm');
  const [videoPlaybackError, setVideoPlaybackError] = useState<string | null>(null);
  const [dynamicTextPreview, setDynamicTextPreview] = useState<string | null>(
    file.previewText || null
  );
  const [loadingTextPreview, setLoadingTextPreview] = useState(false);
  const [zipEntriesPreview, setZipEntriesPreview] = useState<string[]>([]);
  const [imageZoomed, setImageZoomed] = useState(false);

  const isMkv =
    /\.mkv$/i.test(file.name) || file.mimeType.toLowerCase().includes('matroska');
  const isImage =
    file.mimeType.startsWith('image/') ||
    /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|avif)$/i.test(file.name);
  const isVideo =
    isMkv ||
    file.mimeType.startsWith('video/') ||
    /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
  const isAudio =
    file.mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(file.name);
  const isPdf = file.mimeType === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isTextOrCode =
    file.mimeType.startsWith('text/') ||
    /application\/(json|javascript|typescript|xml|x-sh|sql|yaml|x-yaml|csv)/i.test(
      file.mimeType
    ) ||
    /\.(txt|md|markdown|json|csv|tsv|js|jsx|ts|tsx|py|html|css|scss|sql|yml|yaml|xml|sh|env|ini|conf|log|c|cpp|h|java|go|rs|php|rb)$/i.test(
      file.name
    );
  const isCsv = /\.csv$/i.test(file.name) || file.mimeType === 'text/csv';
  const isArchive =
    /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|iso|dmg|apk)$/i.test(file.name) ||
    /zip|compressed|archive|tar|octet-stream/i.test(file.mimeType);
  const isOfficeDoc = /\.(doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf)$/i.test(file.name);

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;
    setVideoPlaybackError(null);
    setDynamicTextPreview(file.previewText || null);
    setZipEntriesPreview([]);

    const inspectBlobExtras = async (blob: Blob) => {
      if (cancelled) return;
      // 1. Dynamically decode text/code/CSV/JSON files up to 2 MB so every text file previews live
      if (isTextOrCode && !file.previewText && blob.size > 0 && blob.size <= 2 * 1024 * 1024) {
        try {
          const text = await blob.text();
          if (!cancelled && text) {
            setDynamicTextPreview(text.slice(0, 100000));
          }
        } catch {
          // ignore
        }
      }
      // 2. If ZIP archive, parse local file header filenames so users can preview archive contents
      if (/\.zip$/i.test(file.name) && blob.size > 22 && blob.size <= 150 * 1024 * 1024) {
        try {
          const sliceBuf = await blob.slice(0, Math.min(blob.size, 512 * 1024)).arrayBuffer();
          const view = new DataView(sliceBuf);
          const names: string[] = [];
          let offset = 0;
          const decoder = new TextDecoder('utf-8');
          while (offset + 30 <= view.byteLength && names.length < 60) {
            const sig = view.getUint32(offset, true);
            if (sig === 0x04034b50) {
              const nameLen = view.getUint16(offset + 26, true);
              const extraLen = view.getUint16(offset + 28, true);
              const compSize = view.getUint32(offset + 18, true);
              if (offset + 30 + nameLen <= view.byteLength) {
                const nameBytes = new Uint8Array(sliceBuf, offset + 30, nameLen);
                const decodedName = decoder.decode(nameBytes);
                if (decodedName) names.push(decodedName);
              }
              offset += 30 + nameLen + extraLen + (compSize > 0 && compSize < 0xffffffff ? compSize : 0);
            } else {
              offset += 1;
            }
          }
          if (!cancelled && names.length > 0) {
            setZipEntriesPreview(names);
          }
        } catch {
          // ignore zip preview parse errors
        }
      }
    };

    const applyBlob = (blob: Blob) => {
      if (cancelled) return;
      setRawBlob(blob);
      void inspectBlobExtras(blob);
      let targetBlob = blob;
      if (isMkv) {
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
    };

    const memBlob = getMemoryBinaryBlobSync(file.id);
    if (memBlob && memBlob.size > 64) {
      applyBlob(memBlob);
    } else {
      setLoadingTextPreview(isTextOrCode && !file.previewText);
      // First check fast local IndexedDB cache (<2ms) for all files including videos
      getClientBinaryBlob(file.id, isVideo && !isSavedOffline ? undefined : file)
        .then((blob) => {
          if (cancelled || !blob || blob.size <= 64) return;
          applyBlob(blob);
        })
        .catch(() => null)
        .finally(() => {
          if (!cancelled) setLoadingTextPreview(false);
        });
    }

    return () => {
      cancelled = true;
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
    };
  }, [
    file,
    file.id,
    file.name,
    file.mimeType,
    file.previewText,
    isMkv,
    isVideo,
    isTextOrCode,
    isSavedOffline,
    videoContainerFallback,
  ]);

  const serverInlineUrl = `/api/files/${encodeURIComponent(
    file.id
  )}/download?inline=1&uid=${encodeURIComponent(
    firebaseUid || ''
  )}&email=${encodeURIComponent(firebaseEmail || '')}&name=${encodeURIComponent(file.name)}`;

  const inlineUrl: string = isVideo
    ? !isMkv && localBlobUrl
      ? localBlobUrl
      : serverInlineUrl
    : localBlobUrl || serverInlineUrl || file.previewDataUrl || '';

  // Fetch text preview from serverInlineUrl if not cached in IndexedDB
  useEffect(() => {
    if (!isTextOrCode || dynamicTextPreview || localBlobUrl || file.lockedOverQuota) return;
    let active = true;
    setLoadingTextPreview(true);
    fetch(serverInlineUrl)
      .then(async (res) => {
        if (!res.ok) return;
        const txt = await res.text();
        if (active && txt) {
          setDynamicTextPreview(txt.slice(0, 100000));
        }
      })
      .catch(() => null)
      .finally(() => {
        if (active) setLoadingTextPreview(false);
      });
    return () => {
      active = false;
    };
  }, [isTextOrCode, dynamicTextPreview, localBlobUrl, serverInlineUrl, file.lockedOverQuota]);

  const handleVideoFallback = () => {
    if (isMkv && videoContainerFallback === 'webm') {
      setVideoContainerFallback('mp4');
      return;
    }
    if (!localBlobUrl) {
      getClientBinaryBlob(file.id, file)
        .then((blob) => {
          if (!blob) {
            setVideoPlaybackError(
              'Video stream could not be decoded directly in the browser. Click Download below to watch locally.'
            );
            return;
          }
          const containerType = isMkv ? 'video/webm' : resolveClientMimeType(file.name, file.mimeType);
          const objUrl = URL.createObjectURL(new Blob([blob], { type: containerType }));
          setLocalBlobUrl(objUrl);
        })
        .catch(() => {
          setVideoPlaybackError(
            'Video stream could not be decoded directly in the browser. Click Download below to watch locally.'
          );
        });
    }
  };

  const handleCopyPreviewText = () => {
    const textToCopy = dynamicTextPreview || file.previewText;
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 1800);
  };

  const csvRows = React.useMemo(() => {
    if (!isCsv || !dynamicTextPreview) return null;
    const lines = dynamicTextPreview
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 25);
    if (lines.length === 0) return null;
    return lines.map((line) => line.split(',').map((cell) => cell.replace(/^"|"$/g, '').trim()));
  }, [isCsv, dynamicTextPreview]);

  return (
    <div className="animate-app-backdrop fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className={`animate-app-modal w-full ${
          isVideo || isPdf || isTextOrCode ? 'sm:max-w-4xl' : 'sm:max-w-2xl'
        } bg-white border-t sm:border border-[#E2E8F0] rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[94vh] overflow-y-auto`}
      >
        {/* Mobile Sheet Grab Handle */}
        <div className="w-10 h-1 rounded-full bg-[#CBD5E1] mx-auto mt-2.5 mb-0.5 sm:hidden" />

        {/* Clean Sticky Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-[#E2E8F0] sticky top-0 bg-white/95 backdrop-blur-md z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#EFF6FF] border border-[#DBEAFE] flex items-center justify-center shrink-0">
              <Eye className="w-4 h-4 text-[#2563EB]" />
            </div>
            <h2 className="text-sm sm:text-base font-bold text-[#0F172A] truncate">{file.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] hover:border-[#CBD5E1] flex items-center justify-center text-[#64748B] hover:text-[#0F172A] shrink-0 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3.5 sm:p-5 space-y-3.5 sm:space-y-4">
          {/* 1. Universal Live Rich Preview (Placed immediately at top for native app feel) */}
          {file.lockedOverQuota ? (
            <div className="p-6 bg-[#F8FAFC] border border-[#D97706] rounded-2xl space-y-3 text-center">
              <div className="w-11 h-11 mx-auto bg-white border border-[#D97706] rounded-xl flex items-center justify-center">
                <Lock className="w-5 h-5 text-[#D97706]" />
              </div>
              <div className="text-sm font-bold text-[#0F172A]">
                File Locked — Exceeds 25 GB Free Limit
              </div>
              <p className="text-xs text-[#475569] max-w-md mx-auto">
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
                  className="min-h-[42px] px-5 py-2.5 text-xs font-bold bg-[#2563EB] text-white hover:bg-[#1D4ED8] rounded-xl cursor-pointer"
                >
                  Extend Storage Plan with Tokens
                </button>
              )}
            </div>
          ) : isImage ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#475569]">
                  Original Lossless Image
                </span>
                <button
                  type="button"
                  onClick={() => setImageZoomed((z) => !z)}
                  className="px-2.5 py-1 text-xs font-medium bg-[#F8FAFC] border border-[#E2E8F0] hover:border-[#2563EB] text-[#0F172A] rounded-lg cursor-pointer"
                >
                  {imageZoomed ? 'Fit to Window' : '1:1 Full Resolution'}
                </button>
              </div>
              <div
                onClick={() => setImageZoomed((z) => !z)}
                className={`p-2.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl flex items-center justify-center cursor-zoom-in ${
                  imageZoomed ? 'max-h-[75vh] overflow-auto' : 'max-h-[440px] overflow-hidden'
                }`}
              >
                <img
                  src={inlineUrl}
                  alt={file.name}
                  className={
                    imageZoomed
                      ? 'max-w-none w-auto h-auto'
                      : 'max-h-[410px] w-auto object-contain rounded-xl'
                  }
                />
              </div>
            </div>
          ) : isVideo ? (
            <div className="space-y-2">
              <YouTubeIframePlayer
                key={`${file.id}_${videoContainerFallback}`}
                fileId={file.id}
                fileName={file.name}
                srcUrl={serverInlineUrl}
                localBlobUrl={localBlobUrl}
                rawBlob={rawBlob}
                isMkv={isMkv}
                fileSizeBytes={file.sizeBytes}
                fileMimeType={file.mimeType}
                telegramChunks={file.telegramChunks}
                onFallbackContainer={handleVideoFallback}
                onPlaybackError={(msg) => setVideoPlaybackError(msg)}
              />

              {videoPlaybackError && (
                <div className="p-3 bg-[#FEF3C7] border border-[#D97706] rounded-xl text-xs text-[#B45309]">
                  {videoPlaybackError}
                </div>
              )}
            </div>
          ) : isAudio ? (
            <div className="p-4 sm:p-5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl space-y-3">
              <div className="text-xs font-semibold text-[#0F172A] truncate">{file.name}</div>
              <audio src={inlineUrl} controls className="w-full" />
            </div>
          ) : isPdf ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#475569]">PDF Document Preview</span>
                <a
                  href={inlineUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 text-xs font-semibold bg-[#F8FAFC] border border-[#E2E8F0] hover:border-[#2563EB] text-[#2563EB] rounded-lg"
                >
                  Open Full PDF
                </a>
              </div>
              <iframe
                title={file.name}
                src={inlineUrl}
                className="w-full h-[420px] bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl"
              />
            </div>
          ) : isTextOrCode || dynamicTextPreview ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#475569]">
                  {isCsv ? 'Spreadsheet / CSV Preview' : 'Document / Code Preview'}
                </span>
                {dynamicTextPreview && (
                  <button
                    type="button"
                    onClick={handleCopyPreviewText}
                    className="min-h-[32px] px-3 py-1 text-xs font-medium bg-[#F8FAFC] border border-[#E2E8F0] hover:border-[#2563EB] text-[#0F172A] rounded-lg flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedText ? (
                      <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-[#2563EB]" />
                    )}
                    {copiedText ? 'Copied' : 'Copy Content'}
                  </button>
                )}
              </div>

              {loadingTextPreview ? (
                <div className="p-8 bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl text-center text-xs text-[#64748B]">
                  Loading live file preview...
                </div>
              ) : csvRows && csvRows.length > 0 ? (
                <div className="border border-[#E2E8F0] rounded-2xl overflow-x-auto max-h-80 bg-white">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
                        {csvRows[0].map((col, idx) => (
                          <th key={idx} className="px-3 py-2 font-bold text-[#0F172A] border-r border-[#E2E8F0] last:border-r-0">
                            {col || `Column ${idx + 1}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {csvRows.slice(1).map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-[#F8FAFC]">
                          {row.map((cell, cIdx) => (
                            <td key={cIdx} className="px-3 py-1.5 text-[#475569] border-r border-[#E2E8F0] last:border-r-0 font-mono">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <pre className="p-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl text-xs font-mono text-[#0F172A] overflow-x-auto max-h-96 whitespace-pre-wrap">
                  {dynamicTextPreview || 'Empty text document.'}
                </pre>
              )}
            </div>
          ) : (
            /* Universal Inspector for Office Docs, ZIP/RAR Archives & Binary Packages */
            <div className="p-5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 bg-white border border-[#E2E8F0] rounded-xl flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-[#2563EB]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[#0F172A] break-all">{file.name}</div>
                    <div className="text-xs text-[#64748B] mt-0.5">
                      {isOfficeDoc
                        ? 'Office Document · Verified Lossless Cloud Copy'
                        : isArchive
                        ? 'Compressed Archive · Integrity Verified'
                        : 'Binary File Stream · Ready for Instant Download'}
                    </div>
                  </div>
                </div>
                <span className="px-2.5 py-1 text-[10px] font-bold bg-[#DCFCE7] text-[#15803D] rounded-lg shrink-0">
                  100% Original
                </span>
              </div>

              {zipEntriesPreview.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-[#E2E8F0]">
                  <div className="text-xs font-semibold text-[#0F172A]">
                    Archive Contents ({zipEntriesPreview.length} items)
                  </div>
                  <div className="max-h-40 overflow-y-auto bg-white border border-[#E2E8F0] rounded-xl divide-y divide-[#E2E8F0] text-xs font-mono">
                    {zipEntriesPreview.map((entryName, idx) => (
                      <div key={idx} className="px-3 py-1.5 text-[#475569] truncate">
                        {entryName}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. Compact, Clean File Metadata Card */}
          <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#64748B] tabular-nums">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-bold text-[#0F172A] shrink-0">
                {formatBytes(file.sizeBytes)}
              </span>
              <span className="text-[#CBD5E1]" aria-hidden="true">
                •
              </span>
              <span className="truncate max-w-[155px] sm:max-w-xs">
                {currentFolderName || 'My Cloud Drive'}
              </span>
              {isSavedOffline && (
                <span className="md:hidden px-1.5 py-0.5 rounded-md bg-[#DCFCE7] text-[#15803D] text-[10px] font-bold shrink-0">
                  Offline
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span>{formatShortDate(file.createdAt)}</span>
              <span className="text-[#CBD5E1]" aria-hidden="true">
                •
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white border border-[#E2E8F0] font-mono text-[10px] font-semibold text-[#475569] uppercase">
                {(file.name.split('.').pop() || file.mimeType.split('/')[1] || 'FILE').slice(0, 8)}
              </span>
            </div>
          </div>

          {/* 3. Symmetrical, Uniform-Height Rounded Action Buttons */}
          {!file.lockedOverQuota ? (
            <div className="space-y-2 pt-1">
              {/* Primary Action Row: Download & Share (2 Equal Columns) */}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => onDownload(file)}
                  className="h-11 rounded-xl px-4 text-xs sm:text-sm font-bold bg-[#2563EB] hover:bg-[#1D4ED8] text-white shadow-xs flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span>Download</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenShareModal(file);
                  }}
                  className="h-11 rounded-xl px-4 text-xs sm:text-sm font-bold bg-[#F8FAFC] hover:bg-[#F1F5F9] border border-[#E2E8F0] hover:border-[#2563EB] text-[#0F172A] flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                >
                  <Link2 className="w-4 h-4 text-[#2563EB] shrink-0" />
                  <span>Share Link</span>
                </button>
              </div>

              {/* Secondary Quick Actions Row: Move, Copy, Offline (Mobile), Delete */}
              <div className="grid grid-cols-4 md:grid-cols-3 gap-2">
                {onOpenMoveModal && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenMoveModal(file);
                    }}
                    className="h-11 rounded-xl px-2.5 text-xs font-semibold bg-[#F8FAFC] hover:bg-[#F1F5F9] border border-[#E2E8F0] hover:border-[#2563EB] text-[#0F172A] flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <FolderInput className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
                    <span>Move</span>
                  </button>
                )}

                {onOpenCopyModal && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenCopyModal(file);
                    }}
                    className="h-11 rounded-xl px-2.5 text-xs font-semibold bg-[#F8FAFC] hover:bg-[#F1F5F9] border border-[#E2E8F0] hover:border-[#2563EB] text-[#0F172A] flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
                    <span>Copy</span>
                  </button>
                )}

                {onToggleOffline && (
                  <button
                    type="button"
                    onClick={() => onToggleOffline(file)}
                    className={`md:hidden h-11 rounded-xl px-2.5 text-xs font-semibold border flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
                      isSavedOffline
                        ? 'bg-[#DCFCE7]/50 border-[#16A34A] text-[#15803D]'
                        : 'bg-[#F8FAFC] hover:bg-[#F1F5F9] border-[#E2E8F0] hover:border-[#2563EB] text-[#0F172A]'
                    }`}
                  >
                    {isSavedOffline ? (
                      <Check className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
                    ) : (
                      <Download className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
                    )}
                    <span>{isSavedOffline ? 'Saved' : 'Offline'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onRequestDelete(file);
                  }}
                  className="h-11 rounded-xl px-2.5 text-xs font-semibold bg-[#FEF2F2] hover:bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626] flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Delete</span>
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                onClose();
                onRequestDelete(file);
              }}
              className="w-full h-11 rounded-xl px-4 text-xs font-semibold bg-[#FEF2F2] hover:bg-[#FEE2E2] border border-[#FECACA] text-[#DC2626] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete File</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 3B. GOOGLE DRIVE-STYLE MOVE / COPY FILE MODAL (Move or Copy to Folder / Root)
// ============================================================================

interface MoveFileModalProps {
  file?: FileRecord | null;
  targetFiles?: FileRecord[];
  mode?: 'move' | 'copy';
  folders: FolderRecord[];
  files: FileRecord[];
  onClose: () => void;
  onMoveFile: (file: FileRecord, targetFolderId: string | null) => Promise<void>;
  onMoveFiles?: (files: FileRecord[], targetFolderId: string | null) => Promise<void>;
  onCopyFiles?: (files: FileRecord[], targetFolderId: string | null) => Promise<void>;
  onCreateFolder: (name: string, parentId: string | null) => Promise<FolderRecord | null>;
}

export const MoveFileModal: React.FC<MoveFileModalProps> = ({
  file,
  targetFiles,
  mode = 'move',
  folders,
  files,
  onClose,
  onMoveFile,
  onMoveFiles,
  onCopyFiles,
  onCreateFolder,
}) => {
  const [activeActionMode, setActiveActionMode] = useState<'move' | 'copy'>(mode);
  const effectiveFiles =
    targetFiles && targetFiles.length > 0 ? targetFiles : file ? [file] : [];
  const primaryFile = effectiveFiles[0];
  const isBatchMove = effectiveFiles.length > 1;
  const allSameFolder = effectiveFiles.every(
    (f) => f.folderId === primaryFile?.folderId
  );
  const initialFolderId = allSameFolder && primaryFile ? primaryFile.folderId : null;

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(initialFolderId);
  const [browsingParentId, setBrowsingParentId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [creatingSubfolder, setCreatingSubfolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const currentFolderObj =
    allSameFolder && primaryFile
      ? folders.find((f) => f.id === primaryFile.folderId) || null
      : null;
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
    if (effectiveFiles.length === 0) {
      onClose();
      return;
    }
    if (
      activeActionMode === 'move' &&
      allSameFolder &&
      selectedFolderId === primaryFile?.folderId
    ) {
      onClose();
      return;
    }
    setMoving(true);
    setError(null);
    try {
      if (activeActionMode === 'copy' && onCopyFiles) {
        await onCopyFiles(effectiveFiles, selectedFolderId);
      } else if (isBatchMove && onMoveFiles) {
        await onMoveFiles(effectiveFiles, selectedFolderId);
      } else if (isBatchMove) {
        for (const item of effectiveFiles) {
          await onMoveFile(item, selectedFolderId);
        }
      } else if (primaryFile) {
        await onMoveFile(primaryFile, selectedFolderId);
      }
      onClose();
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : activeActionMode === 'copy'
          ? 'Could not copy files'
          : 'Could not move files'
      );
    } finally {
      setMoving(false);
    }
  };

  const targetDestinationName =
    selectedFolderId === null
      ? 'My Cloud Drive (Root)'
      : folders.find((f) => f.id === selectedFolderId)?.name || 'Selected Folder';

  return (
    <div className="animate-app-backdrop fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="animate-app-modal w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-[#1C1A17] border-t sm:border border-[#2C2824] shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2C2824] sticky top-0 bg-[#1C1A17] z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            {activeActionMode === 'copy' ? (
              <Copy className="w-4 h-4 text-[#D97757] shrink-0" />
            ) : (
              <FolderInput className="w-4 h-4 text-[#D97757] shrink-0" />
            )}
            <h2 className="text-base font-bold text-[#F2EFE9] truncate">
              {activeActionMode === 'copy'
                ? isBatchMove
                  ? `Copy ${effectiveFiles.length} Selected Files`
                  : `Copy "${primaryFile?.name || 'File'}"`
                : isBatchMove
                ? `Move ${effectiveFiles.length} Selected Files`
                : `Move "${primaryFile?.name || 'File'}"`}
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
          {onCopyFiles && (
            <div className="grid grid-cols-2 gap-1 p-1 bg-[#141311] border border-[#2C2824]">
              <button
                type="button"
                onClick={() => setActiveActionMode('move')}
                className={`min-h-[36px] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  activeActionMode === 'move'
                    ? 'bg-[#D97757] text-[#141311]'
                    : 'text-[#9E978E] hover:text-[#F2EFE9]'
                }`}
              >
                <FolderInput className="w-3.5 h-3.5" />
                <span>Move File</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveActionMode('copy')}
                className={`min-h-[36px] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  activeActionMode === 'copy'
                    ? 'bg-[#D97757] text-[#141311]'
                    : 'text-[#9E978E] hover:text-[#F2EFE9]'
                }`}
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Make a Copy</span>
              </button>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-[#9E978E]">
            <span>
              Current location:{' '}
              <strong className="text-[#F2EFE9]">
                {!allSameFolder
                  ? 'Multiple Folders'
                  : currentFolderObj
                  ? currentFolderObj.name
                  : 'My Cloud Drive (Root)'}
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
              const isCurrent = allSameFolder && primaryFile?.folderId === folder.id;
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
              disabled={
                moving ||
                (activeActionMode === 'move' &&
                  allSameFolder &&
                  selectedFolderId === primaryFile?.folderId)
              }
              className="min-h-[44px] px-5 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] disabled:opacity-50 cursor-pointer"
            >
              {moving
                ? activeActionMode === 'copy'
                  ? 'Copying...'
                  : 'Moving...'
                : activeActionMode === 'move' &&
                  allSameFolder &&
                  selectedFolderId === primaryFile?.folderId
                ? 'Already in This Folder'
                : activeActionMode === 'copy'
                ? `Copy to "${targetDestinationName}"`
                : `Move to "${targetDestinationName}"`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 4. DELETE CONFIRMATION MODAL (Files, Batch Files & Folders)
// ============================================================================

export interface DeleteTarget {
  type: 'file' | 'folder' | 'batch-files' | 'empty-trash';
  id: string;
  name: string;
  subtitle?: string;
  fileIds?: string[];
  permanent?: boolean;
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
  const isPermanent = Boolean(target.permanent || target.type === 'empty-trash');

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
    <div className="animate-app-backdrop fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className={`animate-app-modal w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl bg-[#1C1A17] border-t sm:border ${
          isPermanent ? 'border-[#D94848]' : 'border-[#D97757]'
        }`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2C2824]">
          <div className="flex items-center gap-2.5">
            {isPermanent ? (
              <AlertTriangle className="w-4 h-4 text-[#D94848]" />
            ) : (
              <Trash2 className="w-4 h-4 text-[#D97757]" />
            )}
            <h2 className="text-base font-bold text-[#F2EFE9]">
              {target.type === 'empty-trash'
                ? 'Empty Trash Bin Forever'
                : isPermanent
                ? `Permanently Delete ${
                    target.type === 'folder'
                      ? 'Folder'
                      : target.type === 'batch-files'
                      ? 'Selected Files'
                      : 'File'
                  }`
                : `Move ${
                    target.type === 'folder'
                      ? 'Folder'
                      : target.type === 'batch-files'
                      ? 'Selected Files'
                      : 'File'
                  } to Trash Bin`}
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
            {target.type === 'empty-trash' ? (
              <>
                Are you sure you want to permanently purge{' '}
                <strong className="text-[#D94848]">{target.name}</strong> from your Trash Bin?
              </>
            ) : isPermanent ? (
              <>
                Are you sure you want to permanently delete{' '}
                <strong className="text-[#D94848] break-all">&ldquo;{target.name}&rdquo;</strong>?
              </>
            ) : (
              <>
                Move{' '}
                <strong className="text-[#D97757] break-all">&ldquo;{target.name}&rdquo;</strong>{' '}
                to the Trash Bin?
              </>
            )}
          </p>
          {target.subtitle && (
            <div className="p-3 bg-[#141311] border border-[#2C2824] text-xs text-[#9E978E]">
              {target.subtitle}
            </div>
          )}
          <p className="text-xs text-[#9E978E]">
            {isPermanent
              ? target.type === 'empty-trash'
                ? 'All items in your Trash Bin and their binary storage chunks will be permanently erased across all devices. This cannot be undone.'
                : target.type === 'folder'
                ? 'This folder will be permanently removed across all devices.'
                : 'This item and any active shared download links pointing to it will be permanently erased across all devices.'
              : 'You can restore items anytime from the Trash Bin tab before deleting them forever.'}
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
              className={`min-h-[44px] px-4 py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                isPermanent
                  ? 'bg-[#D94848] text-[#F2EFE9] hover:bg-[#e05858]'
                  : 'bg-[#D97757] text-[#141311] hover:bg-[#E08568]'
              }`}
            >
              <Trash2 className="w-4 h-4" />
              {deleting
                ? isPermanent
                  ? 'Deleting...'
                  : 'Moving...'
                : isPermanent
                ? 'Delete Forever'
                : 'Move to Trash'}
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
    <div className="animate-app-backdrop fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="animate-app-modal w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl bg-[#1C1A17] border-t sm:border border-[#2C2824] shadow-2xl max-h-[92vh] overflow-y-auto">
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
    isAdmin || currentUser.role === 'admin' || currentUser.planId === 'unlimited_admin'
      ? 'Unlimited Admin Storage'
      : currentUser.planId === 'ultra_1tb'
      ? '1 TB Ultra Plan'
      : currentUser.planId === 'pro_50gb'
      ? '50 GB Pro Plan'
      : '25 GB Free Plan';

  return (
    <div className="animate-app-backdrop fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="animate-app-modal w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-[#1C1A17] border-t sm:border border-[#2C2824] shadow-2xl max-h-[92vh] overflow-y-auto">
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

// ============================================================================
// 7. MANAGE FILE TAGS / CUSTOM LABELS MODAL (Single File or Batch Selection)
// ============================================================================

const PRESET_FILE_TAGS = ['Work', 'Personal', 'Archive', 'Important', 'Project', 'Media'];

interface ManageTagsModalProps {
  targetFiles: FileRecord[];
  allExistingTags: string[];
  onClose: () => void;
  onSaveTags: (files: FileRecord[], updatedTags: string[]) => Promise<void>;
}

export const ManageTagsModal: React.FC<ManageTagsModalProps> = ({
  targetFiles,
  allExistingTags,
  onClose,
  onSaveTags,
}) => {
  const isBatch = targetFiles.length > 1;
  const initialTags = React.useMemo(() => {
    if (targetFiles.length === 0) return [];
    if (targetFiles.length === 1) {
      return Array.isArray(targetFiles[0].tags) ? [...targetFiles[0].tags] : [];
    }
    // For batch selection, start with tags common to all selected files
    const firstTags = Array.isArray(targetFiles[0].tags) ? targetFiles[0].tags : [];
    return firstTags.filter((tag) =>
      targetFiles.every((f) =>
        (f.tags || []).some((t) => t.toLowerCase() === tag.toLowerCase())
      )
    );
  }, [targetFiles]);

  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags);
  const [customTagInput, setCustomTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableSuggestions = React.useMemo(() => {
    const merged = new Map<string, string>();
    for (const preset of PRESET_FILE_TAGS) {
      merged.set(preset.toLowerCase(), preset);
    }
    for (const existing of allExistingTags) {
      if (!merged.has(existing.toLowerCase())) {
        merged.set(existing.toLowerCase(), existing);
      }
    }
    return Array.from(merged.values());
  }, [allExistingTags]);

  const toggleTag = (tagLabel: string) => {
    const clean = tagLabel.trim().slice(0, 32);
    if (!clean) return;
    setSelectedTags((prev) => {
      const exists = prev.some((t) => t.toLowerCase() === clean.toLowerCase());
      if (exists) {
        return prev.filter((t) => t.toLowerCase() !== clean.toLowerCase());
      }
      if (prev.length >= 12) return prev;
      return [...prev, clean];
    });
  };

  const handleAddCustomTag = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = customTagInput.trim().slice(0, 32);
    if (!clean) return;
    setSelectedTags((prev) => {
      if (prev.some((t) => t.toLowerCase() === clean.toLowerCase())) return prev;
      if (prev.length >= 12) return prev;
      return [...prev, clean];
    });
    setCustomTagInput('');
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSaveTags(targetFiles, selectedTags);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update file labels');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-app-backdrop fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="animate-app-modal w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-[#1C1A17] border-t sm:border border-[#2C2824] shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2C2824] sticky top-0 bg-[#1C1A17] z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <Tag className="w-4 h-4 text-[#D97757] shrink-0" />
            <h2 className="text-base font-bold text-[#F2EFE9] truncate">
              {isBatch
                ? `Label ${targetFiles.length} Selected Files`
                : `Labels for "${targetFiles[0]?.name || 'File'}"`}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {/* Active Tags on File(s) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#9E978E] uppercase tracking-wider">
                Active Labels ({selectedTags.length}/12)
              </span>
              {selectedTags.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedTags([])}
                  className="text-xs text-[#D94848] hover:underline cursor-pointer"
                >
                  Clear All
                </button>
              )}
            </div>
            <div className="min-h-[48px] p-3 bg-[#141311] border border-[#2C2824] flex flex-wrap items-center gap-2">
              {selectedTags.length === 0 ? (
                <span className="text-xs text-[#9E978E]">
                  No labels assigned yet. Click a preset below or type a custom label.
                </span>
              ) : (
                selectedTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-[#24211D] border border-[#D97757] text-[#F2EFE9]"
                  >
                    <Tag className="w-3 h-3 text-[#D97757]" />
                    <span>{tag}</span>
                    <button
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className="text-[#9E978E] hover:text-[#F2EFE9] ml-0.5 cursor-pointer"
                      aria-label={`Remove ${tag} label`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Add Custom Label Input */}
          <form onSubmit={handleAddCustomTag} className="space-y-2">
            <label className="block text-xs font-semibold text-[#9E978E] uppercase tracking-wider">
              Add Custom Label
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                maxLength={32}
                value={customTagInput}
                onChange={(e) => setCustomTagInput(e.target.value)}
                placeholder="e.g., Work, Personal, Archive, Client..."
                className="flex-1 min-h-[42px] bg-[#141311] border border-[#2C2824] px-3.5 py-2 text-xs text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
              />
              <button
                type="submit"
                disabled={!customTagInput.trim()}
                className="min-h-[42px] px-4 py-2 text-xs font-bold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#D97757]" />
                Add
              </button>
            </div>
          </form>

          {/* Quick Toggle Presets & Existing Labels */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-[#9E978E] uppercase tracking-wider">
              Quick Labels (Tap to Toggle)
            </div>
            <div className="flex flex-wrap gap-2">
              {availableSuggestions.map((label) => {
                const isActive = selectedTags.some(
                  (t) => t.toLowerCase() === label.toLowerCase()
                );
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleTag(label)}
                    className={`min-h-[36px] px-3 py-1.5 text-xs font-semibold border transition-colors flex items-center gap-1.5 cursor-pointer ${
                      isActive
                        ? 'bg-[#D97757] border-[#D97757] text-[#141311]'
                        : 'bg-[#141311] border-[#2C2824] text-[#9E978E] hover:border-[#D97757] hover:text-[#F2EFE9]'
                    }`}
                  >
                    {isActive ? <Check className="w-3.5 h-3.5" /> : <Tag className="w-3 h-3" />}
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
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
              onClick={handleSave}
              disabled={saving}
              className="min-h-[44px] px-5 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] disabled:opacity-50 cursor-pointer"
            >
              {saving
                ? 'Saving Labels...'
                : isBatch
                ? `Apply Labels to ${targetFiles.length} Files`
                : 'Save Labels'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 8. FOLDER PIN LOCK & UNLOCK MODAL (4-6 Digit Numeric PIN Protection)
// ============================================================================

export interface FolderPinModalState {
  folder: FolderRecord;
  mode: 'unlock' | 'manage';
}

interface FolderPinModalProps {
  state: FolderPinModalState;
  onClose: () => void;
  onUnlockSuccess: (folder: FolderRecord) => void;
  onSavePin: (folder: FolderRecord, newPin: string | null) => Promise<void>;
  verifyPinFn: (inputPin: string, storedHash?: string | null) => Promise<boolean>;
}

export const FolderPinModal: React.FC<FolderPinModalProps> = ({
  state,
  onClose,
  onUnlockSuccess,
  onSavePin,
  verifyPinFn,
}) => {
  const { folder, mode } = state;
  const hasExistingPin = Boolean(folder.isPinProtected && folder.pinHash);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const clean = currentPin.trim();
    if (!clean) {
      setError('Please enter your folder PIN.');
      return;
    }
    setBusy(true);
    try {
      const ok = await verifyPinFn(clean, folder.pinHash);
      if (!ok) {
        setError('Incorrect PIN code. Please try again.');
        return;
      }
      onUnlockSuccess(folder);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleSetPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (hasExistingPin) {
      const verified = await verifyPinFn(currentPin.trim(), folder.pinHash);
      if (!verified) {
        setError('Current PIN is incorrect.');
        return;
      }
    }

    const cleanNew = newPin.trim();
    if (!/^\d{4,8}$/.test(cleanNew)) {
      setError('PIN must be 4 to 8 digits (numbers only).');
      return;
    }
    if (cleanNew !== confirmPin.trim()) {
      setError('New PIN and confirmation do not match.');
      return;
    }

    setBusy(true);
    try {
      await onSavePin(folder, cleanNew);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update folder PIN');
    } finally {
      setBusy(false);
    }
  };

  const handleRemovePin = async () => {
    setError(null);
    if (hasExistingPin) {
      const verified = await verifyPinFn(currentPin.trim(), folder.pinHash);
      if (!verified) {
        setError('Enter the current folder PIN above before removing PIN lock.');
        return;
      }
    }
    setBusy(true);
    try {
      await onSavePin(folder, null);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove folder PIN');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-app-backdrop fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="animate-app-modal w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl bg-[#1C1A17] border-t sm:border border-[#D97757]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2C2824]">
          <div className="flex items-center gap-2.5 min-w-0">
            <Lock className="w-4 h-4 text-[#D97757] shrink-0" />
            <h2 className="text-base font-bold text-[#F2EFE9] truncate">
              {mode === 'unlock'
                ? `Unlock "${folder.name}"`
                : hasExistingPin
                ? `Manage PIN Lock — "${folder.name}"`
                : `Set PIN Lock — "${folder.name}"`}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {mode === 'unlock' ? (
          <form onSubmit={handleUnlockSubmit} className="p-5 sm:p-6 space-y-4">
            <p className="text-xs text-[#9E978E] leading-relaxed">
              This private folder is protected with a PIN lock. Enter your numeric PIN below to open{' '}
              <strong className="text-[#F2EFE9]">{folder.name}</strong>.
            </p>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#F2EFE9]">
                Folder PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                autoFocus
                required
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
                className="w-full min-h-[48px] bg-[#141311] border border-[#2C2824] px-4 py-2.5 text-center text-lg font-mono tracking-[0.4em] text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
              />
            </div>

            {error && (
              <div className="p-3 bg-[#141311] border border-[#D94848] text-xs text-[#D94848]">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[#2C2824]">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 py-2.5 text-xs font-semibold text-[#9E978E] bg-[#141311] border border-[#2C2824] hover:text-[#F2EFE9] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || currentPin.length < 4}
                className="min-h-[44px] px-4 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] disabled:opacity-50 cursor-pointer"
              >
                {busy ? 'Verifying...' : 'Unlock Folder'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSetPinSubmit} className="p-5 sm:p-6 space-y-4">
            <p className="text-xs text-[#9E978E] leading-relaxed">
              Protect <strong className="text-[#F2EFE9]">{folder.name}</strong> with a 4 to 8 digit
              numeric PIN. Visitors or sessions without the PIN will not be able to open this folder.
            </p>

            {hasExistingPin && (
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#F2EFE9]">
                  Current PIN (Required to change or remove)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  required
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter current PIN..."
                  className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2 text-sm font-mono tracking-widest text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#F2EFE9]">
                  {hasExistingPin ? 'New PIN (4-8 digits)' : 'Set PIN (4-8 digits)'}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 2580"
                  className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2 text-sm font-mono tracking-widest text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#F2EFE9]">
                  Confirm PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="Repeat PIN"
                  className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2 text-sm font-mono tracking-widest text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-[#141311] border border-[#D94848] text-xs text-[#D94848]">
                {error}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-3 border-t border-[#2C2824]">
              {hasExistingPin ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleRemovePin}
                  className="min-h-[44px] px-4 py-2 text-xs font-semibold text-[#D94848] bg-[#141311] border border-[#D94848] hover:bg-[#D94848] hover:text-[#F2EFE9] cursor-pointer"
                >
                  Remove PIN Lock
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] px-4 py-2 text-xs font-semibold text-[#9E978E] bg-[#141311] border border-[#2C2824] cursor-pointer"
                >
                  Cancel
                </button>
              )}

              <div className="flex items-center gap-2">
                {hasExistingPin && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-[44px] px-4 py-2 text-xs font-semibold text-[#9E978E] bg-[#141311] border border-[#2C2824] cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={busy || newPin.length < 4}
                  className="flex-1 sm:flex-initial min-h-[44px] px-5 py-2 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] disabled:opacity-50 cursor-pointer"
                >
                  {busy ? 'Saving...' : hasExistingPin ? 'Update PIN' : 'Enable PIN Lock'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

