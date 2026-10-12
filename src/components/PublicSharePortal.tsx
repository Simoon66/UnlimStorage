import React, { useState, useEffect } from 'react';
import {
  Lock,
  Download,
  ArrowLeft,
  AlertTriangle,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  CheckCircle2,
  Loader2,
  Code2,
  Check,
  Folder,
  LayoutGrid,
  List as ListIcon,
  Play,
  Archive,
  Copy,
  FolderPlus,
  Search,
  X,
} from 'lucide-react';
import { formatBytes, formatShortDate } from '../utils/format';
import { apiFetch } from '../services/clientCloudFallback';
import { YouTubeIframePlayer } from './YouTubeIframePlayer';
import { SharedFolderFileEntry, FolderRecord, TelegramChunk } from '../types';
import { buildZipBlob, getWatchPercentage } from '../utils/mediaProgressAndZip';
import { PWAInstallButton } from './PWAInstallButton';

interface PublicShareMetadata {
  token: string;
  targetType?: 'file' | 'folder';
  folderId?: string | null;
  sharedFiles?: SharedFolderFileEntry[];
  fileId?: string;
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
  hasDirectStream?: boolean;
  telegramChunks?: TelegramChunk[];
}

interface DownloadProgressState {
  percent: number;
  loadedBytes: number;
  totalBytes: number;
  chunkIndex?: number;
  totalChunks?: number;
  statusLabel?: string;
}

interface PublicSharePortalProps {
  token: string;
  onExitPublicPortal: () => void;
  isAuthenticated?: boolean;
  userFolders?: FolderRecord[];
  onCopyToMyDrive?: (payload: {
    token: string;
    targetFolderId: string | null;
    fileIds?: string[];
    password?: string;
  }) => Promise<number>;
  onCreateFolder?: (name: string) => Promise<FolderRecord | null>;
}

function isMediaVideoFile(name: string, mimeType: string): boolean {
  return (
    (mimeType || '').startsWith('video/') ||
    /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(name || '')
  );
}

export const PublicSharePortal: React.FC<PublicSharePortalProps> = ({
  token,
  onExitPublicPortal,
  isAuthenticated,
  userFolders = [],
  onCopyToMyDrive,
  onCreateFolder,
}) => {
  const isEmbedMode = React.useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('embed') === '1' || params.get('embed') === 'true';
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<PublicShareMetadata | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [unlockedKey, setUnlockedKey] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadingItemId, setDownloadingItemId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressState | null>(null);

  // Video stream state for JW Player style playback
  const [videoStreamUrl, setVideoStreamUrl] = useState<string | null>(null);
  const [loadingVideoStream, setLoadingVideoStream] = useState(false);
  const [copiedEmbedCode, setCopiedEmbedCode] = useState(false);

  // Shared Folder Gallery state + Search Bar & Filter
  const [folderLayout, setFolderLayout] = useState<'grid' | 'list'>('grid');
  const [activeFolderVideo, setActiveFolderVideo] = useState<SharedFolderFileEntry | null>(null);
  const [gallerySearchQuery, setGallerySearchQuery] = useState('');
  const [galleryTypeFilter, setGalleryTypeFilter] = useState<'all' | 'video' | 'image' | 'audio' | 'doc'>('all');

  // Google Drive-style "Save Copy to My Folder" state
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copyTargetFileIds, setCopyTargetFileIds] = useState<string[] | undefined>(undefined);
  const [copyTargetLabel, setCopyTargetLabel] = useState<string>('');
  const [selectedDestFolderId, setSelectedDestFolderId] = useState<string | null>(null);
  const [copyingToDrive, setCopyingToDrive] = useState(false);
  const [copiedSuccessMsg, setCopiedSuccessMsg] = useState<string | null>(null);
  const [creatingNewFolder, setCreatingNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const isFolderShare = React.useMemo(() => {
    if (!share) return false;
    return (
      share.targetType === 'folder' ||
      share.fileMimeType === 'application/x-unlim-folder' ||
      (Array.isArray(share.sharedFiles) && share.sharedFiles.length > 0)
    );
  }, [share]);

  const isVideoShare = React.useMemo(() => {
    if (!share || isFolderShare) return false;
    return isMediaVideoFile(share.fileName, share.fileMimeType);
  }, [share, isFolderShare]);

  const isImageShare = React.useMemo(() => {
    if (!share || isFolderShare) return false;
    return (
      (share.fileMimeType || '').startsWith('image/') ||
      /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|avif)$/i.test(share.fileName || '')
    );
  }, [share, isFolderShare]);

  const isAudioShare = React.useMemo(() => {
    if (!share || isFolderShare) return false;
    return (
      (share.fileMimeType || '').startsWith('audio/') ||
      /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(share.fileName || '')
    );
  }, [share, isFolderShare]);

  const isPdfShare = React.useMemo(() => {
    if (!share || isFolderShare) return false;
    return (
      share.fileMimeType === 'application/pdf' || /\.pdf$/i.test(share.fileName || '')
    );
  }, [share, isFolderShare]);

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
          const shareData = data.share as PublicShareMetadata;
          setShare(shareData);
          if (!shareData.hasPassword) {
            setUnlockedKey('open');
          }
          if (
            Array.isArray(shareData.sharedFiles) &&
            shareData.sharedFiles.length > 0
          ) {
            const firstVid = shareData.sharedFiles.find((f) =>
              isMediaVideoFile(f.name, f.mimeType)
            );
            if (firstVid) {
              setActiveFolderVideo(firstVid);
            }
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

  // Immediately assign direct HTTP 206 Range video stream URL when unlocked (0ms wait)
  useEffect(() => {
    if (!share || !unlockedKey) return;
    if (isFolderShare) {
      if (activeFolderVideo) {
        const folderVideoUrl = `/api/public/share/${encodeURIComponent(
          share.token
        )}/download?inline=1&fileId=${encodeURIComponent(
          activeFolderVideo.id
        )}&name=${encodeURIComponent(activeFolderVideo.name)}&key=${encodeURIComponent(
          unlockedKey
        )}&password=${encodeURIComponent(passwordInput)}`;
        setVideoStreamUrl(folderVideoUrl);
      } else {
        setVideoStreamUrl(null);
      }
      return;
    }
    if (!isVideoShare) return;
    setLoadingVideoStream(false);
    const directInlineUrl = `/api/public/share/${encodeURIComponent(
      share.token
    )}/download?inline=1&key=${encodeURIComponent(unlockedKey)}&password=${encodeURIComponent(
      passwordInput
    )}`;
    setVideoStreamUrl(directInlineUrl);
  }, [share, unlockedKey, isVideoShare, isFolderShare, activeFolderVideo, passwordInput]);

  const handlePublicVideoFallback = React.useCallback(async () => {
    if (!share || !unlockedKey || !videoStreamUrl || videoStreamUrl.startsWith('blob:')) return;
    try {
      const targetFileIdParam =
        isFolderShare && activeFolderVideo
          ? `&fileId=${encodeURIComponent(activeFolderVideo.id)}`
          : '';
      const streamEndpoint = `/api/public/share/${encodeURIComponent(
        share.token
      )}/download?key=${encodeURIComponent(unlockedKey)}&password=${encodeURIComponent(
        passwordInput
      )}${targetFileIdParam}`;
      const res = await apiFetch(streamEndpoint);
      if (!res.ok) return;
      const rawBlob = await res.blob();
      if (rawBlob.size <= 64) return;
      const targetName =
        isFolderShare && activeFolderVideo ? activeFolderVideo.name : share.fileName;
      const targetMime =
        isFolderShare && activeFolderVideo ? activeFolderVideo.mimeType : share.fileMimeType;
      const normalizedMime =
        targetName.toLowerCase().endsWith('.mkv') || targetMime === 'video/x-matroska'
          ? 'video/webm'
          : targetMime || 'video/mp4';
      const playableBlob = new Blob([rawBlob], { type: normalizedMime });
      const blobUrl = URL.createObjectURL(playableBlob);
      setVideoStreamUrl(blobUrl);
    } catch {
      // ignore fallback error
    }
  }, [share, unlockedKey, videoStreamUrl, passwordInput, isFolderShare, activeFolderVideo]);

  useEffect(() => {
    const handleProgressEvent = (ev: Event) => {
      const custom = ev as CustomEvent<{
        token: string;
        loadedBytes: number;
        totalBytes: number;
        chunkIndex: number;
        totalChunks: number;
      }>;
      if (!custom.detail || custom.detail.token !== token) return;
      const { loadedBytes, totalBytes, chunkIndex, totalChunks } = custom.detail;
      const pct =
        totalBytes > 0 ? Math.min(99, Math.round((loadedBytes / totalBytes) * 100)) : 0;
      setDownloadProgress({
        percent: pct,
        loadedBytes,
        totalBytes,
        chunkIndex,
        totalChunks,
      });
    };

    window.addEventListener('unlim:share-download-progress', handleProgressEvent);
    return () => {
      window.removeEventListener('unlim:share-download-progress', handleProgressEvent);
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
        setAuthError(data.error || 'Incorrect password');
      } else {
        setUnlockedKey(data.accessKey || 'unlocked');
      }
    } catch {
      setAuthError('Could not verify password');
    } finally {
      setVerifying(false);
    }
  };

  const handleDownloadSingleFolderItem = async (item: SharedFolderFileEntry) => {
    if (!share || !unlockedKey || downloading) return;
    setDownloadingItemId(item.id);
    setDownloadError(null);
    try {
      const downloadUrl = `/api/public/share/${encodeURIComponent(
        share.token
      )}/download?fileId=${encodeURIComponent(item.id)}&key=${encodeURIComponent(
        unlockedKey
      )}&password=${encodeURIComponent(passwordInput)}`;
      const res = await apiFetch(downloadUrl);
      if (!res.ok) {
        throw new Error('Could not download file from shared folder.');
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = item.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (err: unknown) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadingItemId(null);
    }
  };

  const handleDownloadFolderZip = async () => {
    if (!share || !unlockedKey || downloading) return;
    const items = share.sharedFiles || [];
    if (items.length === 0) return;

    setDownloading(true);
    setDownloadError(null);
    const totalBytes = items.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);
    let loadedBytes = 0;

    setDownloadProgress({
      percent: 1,
      loadedBytes: 0,
      totalBytes,
      statusLabel: `Preparing ${items.length} files for ZIP archive...`,
    });

    try {
      const zipEntries: { name: string; data: Uint8Array }[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        setDownloadProgress({
          percent: Math.min(95, Math.round(((i + 0.2) / items.length) * 100)),
          loadedBytes,
          totalBytes,
          statusLabel: `Packaging ${i + 1}/${items.length}: ${item.name}`,
        });

        const itemUrl = `/api/public/share/${encodeURIComponent(
          share.token
        )}/download?fileId=${encodeURIComponent(item.id)}&key=${encodeURIComponent(
          unlockedKey
        )}&password=${encodeURIComponent(passwordInput)}`;
        const res = await apiFetch(itemUrl);
        if (!res.ok) continue;
        const arrBuf = await res.arrayBuffer();
        const bytes = new Uint8Array(arrBuf);
        zipEntries.push({ name: item.name, data: bytes });
        loadedBytes += bytes.byteLength;

        setDownloadProgress({
          percent: Math.min(98, Math.round(((i + 1) / items.length) * 100)),
          loadedBytes,
          totalBytes,
          statusLabel: `Packaged ${i + 1}/${items.length}: ${item.name}`,
        });
      }

      if (zipEntries.length === 0) {
        throw new Error('No downloadable files were found in this shared folder.');
      }

      const zipBlob = buildZipBlob(zipEntries);
      setDownloadProgress({
        percent: 100,
        loadedBytes: zipBlob.size,
        totalBytes: zipBlob.size,
        statusLabel: 'ZIP Archive Ready!',
      });

      const blobUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const baseFolderName = (share.fileName || 'Shared-Folder').replace(/\.zip$/i, '');
      a.download = `${baseFolderName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (err: unknown) {
      setDownloadError(
        err instanceof Error ? err.message : 'Failed to build folder ZIP archive.'
      );
    } finally {
      setDownloading(false);
      setTimeout(() => setDownloadProgress(null), 2500);
    }
  };

  const handleStartDownload = async () => {
    if (!share || !unlockedKey || downloading) return;
    if (isFolderShare) {
      await handleDownloadFolderZip();
      return;
    }
    setDownloading(true);
    setDownloadError(null);
    setDownloadProgress({
      percent: 0,
      loadedBytes: 0,
      totalBytes: share.fileSizeBytes || 0,
    });
    try {
      const downloadUrl = `/api/public/share/${encodeURIComponent(
        share.token
      )}/download?key=${encodeURIComponent(unlockedKey)}&password=${encodeURIComponent(
        passwordInput
      )}`;
      const res = await apiFetch(downloadUrl);
      if (!res.ok) {
        let errMessage = 'Could not download shared file. Please try again.';
        try {
          const errJson = await res.json();
          if (errJson?.error) errMessage = errJson.error;
        } catch {
          // ignore
        }
        setDownloadError(errMessage);
        return;
      }

      let blob: Blob;
      const contentType =
        res.headers.get('Content-Type') || share.fileMimeType || 'application/octet-stream';
      const totalBytes = Number(res.headers.get('Content-Length')) || share.fileSizeBytes || 0;

      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            receivedBytes += value.byteLength;
            if (totalBytes > 0) {
              setDownloadProgress((prev) => ({
                percent: Math.min(99, Math.round((receivedBytes / totalBytes) * 100)),
                loadedBytes: receivedBytes,
                totalBytes,
                chunkIndex: prev?.chunkIndex,
                totalChunks: prev?.totalChunks,
              }));
            }
          }
        }
        blob = new Blob(chunks as BlobPart[], { type: contentType });
      } else {
        blob = await res.blob();
      }

      setDownloadProgress({
        percent: 100,
        loadedBytes: blob.size || totalBytes,
        totalBytes: blob.size || totalBytes,
      });

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = share.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      setShare((prev) =>
        prev
          ? {
              ...prev,
              downloadCount: prev.downloadCount + 1,
            }
          : prev
      );
    } catch (err: unknown) {
      setDownloadError(
        err instanceof Error ? err.message : 'Network error while downloading shared file.'
      );
    } finally {
      setDownloading(false);
      setTimeout(() => setDownloadProgress(null), 2500);
    }
  };

  const renderShareFileIcon = (name?: string, mime?: string) => {
    const targetName = name || share?.fileName || '';
    const targetMime = mime || share?.fileMimeType || '';
    if (!name && isFolderShare) {
      return <Folder className="w-5 h-5 sm:w-6 sm:h-6 text-[#D97757]" />;
    }
    if (isMediaVideoFile(targetName, targetMime)) {
      return <Film className="w-5 h-5 sm:w-6 sm:h-6 text-[#D97757]" />;
    }
    if (
      targetMime.startsWith('image/') ||
      /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(targetName)
    ) {
      return <ImageIcon className="w-5 h-5 sm:w-6 sm:h-6 text-[#D97757]" />;
    }
    if (
      targetMime.startsWith('audio/') ||
      /\.(mp3|wav|ogg|flac|m4a)$/i.test(targetName)
    ) {
      return <Music className="w-5 h-5 sm:w-6 sm:h-6 text-[#D97757]" />;
    }
    return <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-[#D97757]" />;
  };

  // ============================================================================
  // CLEAN JW PLAYER IFRAME EMBED MODE (?share=TOKEN&embed=1)
  // ============================================================================
  if (isEmbedMode) {
    if (loading || loadingVideoStream) {
      return (
        <div className="w-screen h-screen bg-black flex items-center justify-center text-white">
          <div className="w-9 h-9 rounded-full border-2 border-white/20 border-t-[#D97757] animate-spin" />
        </div>
      );
    }

    if (error || !share) {
      return (
        <div className="w-screen h-screen bg-black flex flex-col items-center justify-center text-white p-4 text-center space-y-2">
          <AlertTriangle className="w-7 h-7 text-[#D94848]" />
          <div className="text-sm font-semibold">Video Unavailable</div>
          <div className="text-xs text-white/60">
            {error || 'This embedded stream link has expired or been removed.'}
          </div>
        </div>
      );
    }

    if (share.hasPassword && !unlockedKey) {
      return (
        <div className="w-screen h-screen bg-black flex items-center justify-center p-4 text-white">
          <form
            onSubmit={handleVerifyPassword}
            className="w-full max-w-sm bg-[#141311] border border-[#2C2824] p-5 space-y-3"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-[#F2EFE9]">
              <Lock className="w-4 h-4 text-[#D97757]" />
              <span>Protected Video Stream</span>
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter password..."
                className="flex-1 min-h-[40px] bg-black border border-[#2C2824] px-3 py-2 text-xs text-white focus:outline-none focus:border-[#D97757]"
                required
              />
              <button
                type="submit"
                disabled={verifying}
                className="min-h-[40px] px-4 py-2 text-xs font-bold bg-[#D97757] text-[#141311] cursor-pointer"
              >
                {verifying ? '...' : 'Unlock'}
              </button>
            </div>
            {authError && <p className="text-[11px] text-[#D94848]">{authError}</p>}
          </form>
        </div>
      );
    }

    if (videoStreamUrl) {
      const targetName =
        isFolderShare && activeFolderVideo ? activeFolderVideo.name : share.fileName;
      const targetId =
        isFolderShare && activeFolderVideo ? activeFolderVideo.id : share.fileId || share.token;
      const targetSize =
        isFolderShare && activeFolderVideo ? activeFolderVideo.sizeBytes : share.fileSizeBytes;
      const targetMime =
        isFolderShare && activeFolderVideo ? activeFolderVideo.mimeType : share.fileMimeType;
      const targetChunks =
        isFolderShare && activeFolderVideo
          ? activeFolderVideo.telegramChunks
          : share.telegramChunks;
      return (
        <div className="w-screen h-screen bg-black overflow-hidden">
          <YouTubeIframePlayer
            fileId={targetId}
            fileName={targetName}
            srcUrl={videoStreamUrl}
            rawBlob={null}
            isMkv={targetName.toLowerCase().endsWith('.mkv')}
            fullViewport={true}
            fileSizeBytes={targetSize}
            fileMimeType={targetMime}
            telegramChunks={targetChunks}
            onFallbackContainer={handlePublicVideoFallback}
          />
        </div>
      );
    }

    return (
      <div className="w-screen h-screen bg-black flex flex-col items-center justify-center text-white p-4 gap-3">
        <div className="text-xs text-white/70">{share.fileName}</div>
        <button
          onClick={handleStartDownload}
          disabled={downloading}
          className="px-5 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] cursor-pointer"
        >
          {downloading ? 'Downloading...' : `Download (${formatBytes(share.fileSizeBytes)})`}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#141311] text-[#F2EFE9] flex flex-col justify-between">
      {/* Clean Phone-Friendly Header */}
      <header className="flex items-center justify-between gap-3 sm:gap-8 px-4 sm:px-6 py-3.5 border-b border-[#2C2824] bg-[#1C1A17]">
        <button
          onClick={onExitPublicPortal}
          className="text-lg font-bold tracking-tight text-[#F2EFE9] whitespace-nowrap shrink-0 cursor-pointer"
        >
          UnlimStorage
        </button>

        <nav className="hidden md:flex items-center gap-4 text-sm text-[#9E978E]">
          <span className="whitespace-nowrap shrink-0">
            {isFolderShare ? 'Shared Folder Gallery & Direct Streaming' : 'Shared File Download & Streaming'}
          </span>
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <PWAInstallButton compact />
          <button
            onClick={onExitPublicPortal}
            className="min-h-[40px] flex items-center gap-2 px-3.5 sm:px-4 py-2 text-xs font-medium text-[#F2EFE9] bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to My Files</span>
          </button>
        </div>
      </header>

      {/* Centered Friendly File or Folder Gallery Card */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div
          className={`w-full ${
            (isVideoShare || isFolderShare) && unlockedKey ? 'max-w-4xl' : 'max-w-lg'
          } bg-[#1C1A17] border border-[#2C2824]`}
        >
          {loading ? (
            <div className="p-5 sm:p-8 space-y-4">
              <div className="h-12 w-12 bg-[#24211D] border border-[#2C2824] animate-pulse" />
              <div className="h-6 w-56 bg-[#24211D] border border-[#2C2824] animate-pulse" />
              <div className="h-12 w-full bg-[#24211D] border border-[#2C2824] animate-pulse" />
            </div>
          ) : error || !share ? (
            <div className="p-6 sm:p-8 space-y-5 text-center">
              <div className="w-12 h-12 mx-auto bg-[#24211D] border border-[#2C2824] flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-[#D94848]" />
              </div>
              <div className="space-y-2">
                <h1 className="text-lg sm:text-xl font-bold text-[#F2EFE9]">Link Unavailable</h1>
                <p className="text-xs sm:text-sm text-[#9E978E]">
                  {error || 'This shared link has expired or been turned off by the owner.'}
                </p>
              </div>
              <button
                onClick={onExitPublicPortal}
                className="min-h-[44px] w-full sm:w-auto px-5 py-2.5 text-xs font-semibold bg-[#D97757] text-[#141311] hover:bg-[#E08568] transition-colors cursor-pointer"
              >
                Go to My Drive
              </button>
            </div>
          ) : (
            <div className="p-5 sm:p-8 space-y-6">
              {/* File / Folder Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5 sm:gap-4 min-w-0">
                  <div className="w-11 h-11 sm:w-12 sm:h-12 bg-[#24211D] border border-[#2C2824] flex items-center justify-center shrink-0">
                    {renderShareFileIcon()}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <h1 className="text-base sm:text-xl font-bold text-[#F2EFE9] break-all">
                      {share.fileName}
                    </h1>
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs text-[#9E978E] tabular-nums">
                      {isFolderShare && Array.isArray(share.sharedFiles) && (
                        <>
                          <span className="text-[#D97757] font-semibold">
                            {share.sharedFiles.length} {share.sharedFiles.length === 1 ? 'item' : 'items'}
                          </span>
                          <span aria-hidden="true">·</span>
                        </>
                      )}
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

                {/* Folder Gallery Layout Switcher */}
                {isFolderShare && unlockedKey && (
                  <div className="flex items-center gap-1 bg-[#141311] border border-[#2C2824] p-0.5 self-start sm:self-center shrink-0">
                    <button
                      type="button"
                      onClick={() => setFolderLayout('grid')}
                      className={`px-2.5 py-1.5 text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
                        folderLayout === 'grid'
                          ? 'bg-[#24211D] text-[#D97757]'
                          : 'text-[#9E978E] hover:text-[#F2EFE9]'
                      }`}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      <span>Grid</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFolderLayout('list')}
                      className={`px-2.5 py-1.5 text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors ${
                        folderLayout === 'list'
                          ? 'bg-[#24211D] text-[#D97757]'
                          : 'text-[#9E978E] hover:text-[#F2EFE9]'
                      }`}
                    >
                      <ListIcon className="w-3.5 h-3.5" />
                      <span>List</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Direct Multi-Quality Video Player for Single Video Share OR Selected Folder Video */}
              {(isVideoShare || (isFolderShare && activeFolderVideo)) && unlockedKey && (
                <div className="space-y-2.5">
                  {isFolderShare && activeFolderVideo && (
                    <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#141311] border border-[#2C2824] text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <Play className="w-3.5 h-3.5 text-[#D97757] fill-current shrink-0" />
                        <span className="text-[#9E978E] shrink-0">Now Playing:</span>
                        <span className="font-semibold text-[#F2EFE9] truncate">
                          {activeFolderVideo.name}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-[#9E978E] shrink-0 tabular-nums">
                        {formatBytes(activeFolderVideo.sizeBytes)}
                      </span>
                    </div>
                  )}

                  {loadingVideoStream ? (
                    <div className="w-full aspect-video bg-black border border-[#2C2824] flex flex-col items-center justify-center gap-2 text-xs text-[#9E978E]">
                      <Loader2 className="w-6 h-6 text-[#D97757] animate-spin" />
                      <span>Loading video stream...</span>
                    </div>
                  ) : videoStreamUrl ? (
                    <YouTubeIframePlayer
                      key={isFolderShare && activeFolderVideo ? activeFolderVideo.id : share.token}
                      fileId={
                        isFolderShare && activeFolderVideo
                          ? activeFolderVideo.id
                          : share.fileId || share.token
                      }
                      fileName={
                        isFolderShare && activeFolderVideo
                          ? activeFolderVideo.name
                          : share.fileName
                      }
                      srcUrl={videoStreamUrl}
                      rawBlob={null}
                      isMkv={(isFolderShare && activeFolderVideo
                        ? activeFolderVideo.name
                        : share.fileName
                      )
                        .toLowerCase()
                        .endsWith('.mkv')}
                      fullViewport={false}
                      fileSizeBytes={
                        isFolderShare && activeFolderVideo
                          ? activeFolderVideo.sizeBytes
                          : share.fileSizeBytes
                      }
                      fileMimeType={
                        isFolderShare && activeFolderVideo
                          ? activeFolderVideo.mimeType
                          : share.fileMimeType
                      }
                      telegramChunks={
                        isFolderShare && activeFolderVideo
                          ? activeFolderVideo.telegramChunks
                          : share.telegramChunks
                      }
                      onFallbackContainer={handlePublicVideoFallback}
                    />
                  ) : null}

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] text-[#9E978E]">
                      Adaptive Network Stream (1080p High / 720p / 480p) · Auto-resume enabled
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const embedUrl = `${window.location.origin}/?share=${encodeURIComponent(
                          share.token
                        )}&embed=1`;
                        const snippet = `<iframe src="${embedUrl}" width="100%" height="480" frameborder="0" allowfullscreen allow="autoplay; fullscreen"></iframe>`;
                        navigator.clipboard.writeText(snippet);
                        setCopiedEmbedCode(true);
                        setTimeout(() => setCopiedEmbedCode(false), 2000);
                      }}
                      className="min-h-[32px] px-3 py-1 text-[11px] font-semibold bg-[#141311] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedEmbedCode ? (
                        <Check className="w-3.5 h-3.5 text-[#2E9E6B]" />
                      ) : (
                        <Code2 className="w-3.5 h-3.5 text-[#D97757]" />
                      )}
                      <span>{copiedEmbedCode ? 'Copied Iframe!' : 'Copy Embed Iframe'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Universal Preview for Single Image / Audio / PDF Shares */}
              {!isFolderShare && !isVideoShare && unlockedKey && (
                <>
                  {isImageShare && (
                    <div className="p-3 bg-[#141311] border border-[#2C2824] flex items-center justify-center max-h-96 overflow-hidden">
                      <img
                        src={`/api/public/share/${encodeURIComponent(
                          share.token
                        )}/download?inline=1&key=${encodeURIComponent(
                          unlockedKey
                        )}&password=${encodeURIComponent(passwordInput)}`}
                        alt={share.fileName}
                        className="max-h-80 w-auto object-contain"
                      />
                    </div>
                  )}
                  {isAudioShare && (
                    <div className="p-4 bg-[#141311] border border-[#2C2824]">
                      <audio
                        controls
                        src={`/api/public/share/${encodeURIComponent(
                          share.token
                        )}/download?inline=1&key=${encodeURIComponent(
                          unlockedKey
                        )}&password=${encodeURIComponent(passwordInput)}`}
                        className="w-full"
                      />
                    </div>
                  )}
                  {isPdfShare && (
                    <iframe
                      title={share.fileName}
                      src={`/api/public/share/${encodeURIComponent(
                        share.token
                      )}/download?inline=1&key=${encodeURIComponent(
                        unlockedKey
                      )}&password=${encodeURIComponent(passwordInput)}`}
                      className="w-full h-96 bg-[#141311] border border-[#2C2824]"
                    />
                  )}
                </>
              )}

              {/* Shared Folder Gallery View with Search Bar & Media Type Filter */}
              {isFolderShare && unlockedKey && Array.isArray(share.sharedFiles) && (() => {
                const filteredGalleryItems = share.sharedFiles.filter((item) => {
                  if (gallerySearchQuery.trim()) {
                    const q = gallerySearchQuery.toLowerCase();
                    if (!item.name.toLowerCase().includes(q)) return false;
                  }
                  if (galleryTypeFilter !== 'all') {
                    const mime = (item.mimeType || '').toLowerCase();
                    const name = (item.name || '').toLowerCase();
                    const isVid = isMediaVideoFile(item.name, item.mimeType);
                    const isImg = mime.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/.test(name);
                    const isAud = mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/.test(name);
                    if (galleryTypeFilter === 'video' && !isVid) return false;
                    if (galleryTypeFilter === 'image' && !isImg) return false;
                    if (galleryTypeFilter === 'audio' && !isAud) return false;
                    if (galleryTypeFilter === 'doc' && (isVid || isImg || isAud)) return false;
                  }
                  return true;
                });

                return (
                <div className="space-y-3 pt-2 border-t border-[#2C2824]">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#9E978E]">
                    <span className="font-semibold text-[#F2EFE9]">
                      Folder Gallery ({filteredGalleryItems.length} of {share.sharedFiles.length})
                    </span>
                    <span>Search files, stream video, or copy to your own folder</span>
                  </div>

                  {/* Gallery Search Bar + Media Filter Tabs */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 text-[#9E978E] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={gallerySearchQuery}
                        onChange={(e) => setGallerySearchQuery(e.target.value)}
                        placeholder="Search files in this shared gallery..."
                        className="w-full min-h-[38px] bg-[#141311] border border-[#2C2824] pl-9 pr-8 py-1.5 text-xs text-[#F2EFE9] placeholder-[#9E978E] focus:outline-none focus:border-[#D97757]"
                      />
                      {gallerySearchQuery && (
                        <button
                          type="button"
                          onClick={() => setGallerySearchQuery('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1 bg-[#141311] border border-[#2C2824] p-0.5 overflow-x-auto">
                      {(
                        [
                          { id: 'all', label: 'All' },
                          { id: 'video', label: 'Videos' },
                          { id: 'image', label: 'Photos' },
                          { id: 'audio', label: 'Audio' },
                          { id: 'doc', label: 'Docs' },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setGalleryTypeFilter(tab.id)}
                          className={`px-2.5 py-1 text-[11px] font-semibold cursor-pointer whitespace-nowrap ${
                            galleryTypeFilter === tab.id
                              ? 'bg-[#D97757] text-[#141311]'
                              : 'text-[#9E978E] hover:text-[#F2EFE9]'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredGalleryItems.length === 0 ? (
                    <div className="p-6 text-center bg-[#141311] border border-[#2C2824] text-xs text-[#9E978E]">
                      {share.sharedFiles.length === 0
                        ? 'This shared folder is currently empty.'
                        : 'No files match your gallery search or filter.'}
                    </div>
                  ) : folderLayout === 'grid' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-[420px] overflow-y-auto pr-1">
                      {filteredGalleryItems.map((item) => {
                        const isVid = isMediaVideoFile(item.name, item.mimeType);
                        const isPlayingThis = activeFolderVideo?.id === item.id;
                        const watchPct = isVid ? getWatchPercentage(item.id) : null;
                        return (
                          <div
                            key={item.id}
                            onClick={() => {
                              if (isVid) setActiveFolderVideo(item);
                            }}
                            className={`group relative flex flex-col justify-between p-3.5 bg-[#141311] border transition-colors ${
                              isPlayingThis
                                ? 'border-[#D97757] bg-[#24211D]/60'
                                : 'border-[#2C2824] hover:border-[#D97757]/60'
                            } ${isVid ? 'cursor-pointer' : ''}`}
                          >
                            <div className="space-y-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="w-9 h-9 bg-[#1C1A17] border border-[#2C2824] flex items-center justify-center shrink-0 overflow-hidden">
                                  {item.previewDataUrl && item.mimeType.startsWith('image/') ? (
                                    <img
                                      src={item.previewDataUrl}
                                      alt={item.name}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    renderShareFileIcon(item.name, item.mimeType)
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  {isVid && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveFolderVideo(item);
                                      }}
                                      className={`px-2 py-1 text-[11px] font-semibold flex items-center gap-1 cursor-pointer ${
                                        isPlayingThis
                                          ? 'bg-[#D97757] text-[#141311]'
                                          : 'bg-[#24211D] text-[#F2EFE9] hover:bg-[#D97757] hover:text-[#141311]'
                                      }`}
                                    >
                                      <Play className="w-3 h-3 fill-current" />
                                      <span>{isPlayingThis ? 'Playing' : 'Stream'}</span>
                                    </button>
                                  )}
                                  {onCopyToMyDrive && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setCopyTargetFileIds([item.id]);
                                        setCopyTargetLabel(item.name);
                                        setCopiedSuccessMsg(null);
                                        setShowCopyModal(true);
                                      }}
                                      className="p-1.5 bg-[#24211D] hover:border-[#D97757] text-[#F2EFE9] border border-[#2C2824] cursor-pointer"
                                      title={`Copy "${item.name}" to My Drive`}
                                    >
                                      <Copy className="w-3.5 h-3.5 text-[#D97757]" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleDownloadSingleFolderItem(item);
                                    }}
                                    disabled={downloadingItemId === item.id}
                                    className="p-1.5 bg-[#24211D] hover:bg-[#2C2824] text-[#F2EFE9] border border-[#2C2824] cursor-pointer"
                                    title={`Download ${item.name}`}
                                  >
                                    {downloadingItemId === item.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D97757]" />
                                    ) : (
                                      <Download className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                              </div>
                              <div className="space-y-1">
                                <div className="text-xs font-semibold text-[#F2EFE9] line-clamp-2 break-all">
                                  {item.name}
                                </div>
                                <div className="text-[11px] text-[#9E978E] font-mono tabular-nums">
                                  {formatBytes(item.sizeBytes)}
                                  {watchPct !== null ? ` · ${watchPct}% watched` : ''}
                                </div>
                              </div>
                            </div>
                            {watchPct !== null && (
                              <div className="w-full h-1 bg-[#24211D] mt-2.5 overflow-hidden">
                                <div
                                  className="h-full bg-[#D97757]"
                                  style={{ width: `${watchPct}%` }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="divide-y divide-[#2C2824] border border-[#2C2824] bg-[#141311] max-h-[420px] overflow-y-auto">
                      {filteredGalleryItems.map((item) => {
                        const isVid = isMediaVideoFile(item.name, item.mimeType);
                        const isPlayingThis = activeFolderVideo?.id === item.id;
                        return (
                          <div
                            key={item.id}
                            onClick={() => {
                              if (isVid) setActiveFolderVideo(item);
                            }}
                            className={`flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs transition-colors ${
                              isPlayingThis ? 'bg-[#24211D]' : 'hover:bg-[#1C1A17]'
                            } ${isVid ? 'cursor-pointer' : ''}`}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              {renderShareFileIcon(item.name, item.mimeType)}
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-[#F2EFE9] truncate">
                                  {item.name}
                                </div>
                                <div className="text-[11px] text-[#9E978E] font-mono tabular-nums">
                                  {formatBytes(item.sizeBytes)}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {isVid && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveFolderVideo(item);
                                  }}
                                  className={`px-2.5 py-1 text-[11px] font-semibold flex items-center gap-1 cursor-pointer ${
                                    isPlayingThis
                                      ? 'bg-[#D97757] text-[#141311]'
                                      : 'bg-[#24211D] text-[#F2EFE9] border border-[#2C2824] hover:border-[#D97757]'
                                  }`}
                                >
                                  <Play className="w-3 h-3 fill-current" />
                                  <span>{isPlayingThis ? 'Playing' : 'Stream'}</span>
                                </button>
                              )}
                              {onCopyToMyDrive && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCopyTargetFileIds([item.id]);
                                    setCopyTargetLabel(item.name);
                                    setCopiedSuccessMsg(null);
                                    setShowCopyModal(true);
                                  }}
                                  className="px-2.5 py-1 text-[11px] font-medium bg-[#24211D] hover:border-[#D97757] text-[#F2EFE9] border border-[#2C2824] flex items-center gap-1 cursor-pointer"
                                >
                                  <Copy className="w-3 h-3 text-[#D97757]" />
                                  <span>Copy to Drive</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDownloadSingleFolderItem(item);
                                }}
                                disabled={downloadingItemId === item.id}
                                className="px-2.5 py-1 text-[11px] font-medium bg-[#24211D] hover:bg-[#2C2824] text-[#F2EFE9] border border-[#2C2824] flex items-center gap-1 cursor-pointer"
                              >
                                {downloadingItemId === item.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin text-[#D97757]" />
                                ) : (
                                  <Download className="w-3 h-3" />
                                )}
                                <span>Download</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                );
              })()}

              {/* Password Box or Primary Download + Save Copy to My Drive Buttons */}
              <div className="pt-4 border-t border-[#2C2824]">
                {share.hasPassword && !unlockedKey ? (
                  <form onSubmit={handleVerifyPassword} className="space-y-4">
                    <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-[#F2EFE9]">
                      <Lock className="w-4 h-4 text-[#D97757] shrink-0" />
                      <span>
                        This shared {isFolderShare ? 'folder' : 'file'} is protected with a password
                      </span>
                    </div>
                    {share.token === 'tg-spec-vault-2026' && (
                      <p className="text-xs text-[#9E978E]">
                        Demo password for this link:{' '}
                        <span className="font-mono text-[#F2EFE9]">unlim2026</span>
                      </p>
                    )}
                    <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3">
                      <input
                        type="password"
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        placeholder="Enter password to unlock..."
                        className="flex-1 min-h-[44px] bg-[#141311] border border-[#2C2824] px-4 py-2.5 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                        required
                      />
                      <button
                        type="submit"
                        disabled={verifying}
                        className="min-h-[44px] px-6 py-2.5 text-sm font-semibold bg-[#D97757] text-[#141311] hover:bg-[#E08568] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        {verifying ? 'Checking...' : `Unlock ${isFolderShare ? 'Folder' : 'File'}`}
                      </button>
                    </div>
                    {authError && <p className="text-xs text-[#D94848]">{authError}</p>}
                  </form>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        onClick={handleStartDownload}
                        disabled={downloading}
                        className="min-h-[48px] w-full flex items-center justify-center gap-2.5 py-3.5 px-5 text-sm font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] transition-colors cursor-pointer disabled:opacity-60"
                      >
                        {downloading ? (
                          <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                        ) : isFolderShare ? (
                          <Archive className="w-4 h-4 shrink-0" />
                        ) : (
                          <Download className="w-4 h-4 shrink-0" />
                        )}
                        <span className="truncate">
                          {downloading
                            ? downloadProgress?.statusLabel
                              ? `${downloadProgress.statusLabel} (${downloadProgress.percent}%)`
                              : downloadProgress && downloadProgress.percent > 0
                              ? `Downloading... ${downloadProgress.percent}%`
                              : 'Preparing Cloud Stream...'
                            : isFolderShare
                            ? `Download Folder .ZIP (${formatBytes(share.fileSizeBytes)})`
                            : `Download File (${formatBytes(share.fileSizeBytes)})`}
                        </span>
                      </button>

                      {onCopyToMyDrive && (
                        <button
                          type="button"
                          onClick={() => {
                            setCopyTargetFileIds(undefined);
                            setCopyTargetLabel(share.fileName);
                            setCopiedSuccessMsg(null);
                            setShowCopyModal(true);
                          }}
                          className="min-h-[48px] w-full flex items-center justify-center gap-2 py-3.5 px-5 text-sm font-bold bg-[#24211D] border border-[#D97757] text-[#F2EFE9] hover:bg-[#D97757] hover:text-[#141311] transition-colors cursor-pointer"
                        >
                          <Copy className="w-4 h-4 shrink-0" />
                          <span className="truncate">
                            {isFolderShare
                              ? 'Copy All to My Drive Folder'
                              : 'Save Copy to My Drive Folder'}
                          </span>
                        </button>
                      )}
                    </div>

                    {copiedSuccessMsg && (
                      <div className="p-3 bg-[#141311] border border-[#2E9E6B] flex items-center justify-between gap-3 text-xs text-[#2E9E6B]">
                        <span>{copiedSuccessMsg}</span>
                        <button
                          type="button"
                          onClick={onExitPublicPortal}
                          className="px-3 py-1 font-bold bg-[#2E9E6B] text-[#141311] cursor-pointer shrink-0"
                        >
                          Open My Drive
                        </button>
                      </div>
                    )}

                    {/* Google Drive-Style "Save Copy to My Folder" Modal inside Public Share Portal */}
                    {showCopyModal && onCopyToMyDrive && (
                      <div className="p-4 bg-[#141311] border border-[#D97757] space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs font-bold text-[#F2EFE9]">
                            <Copy className="w-4 h-4 text-[#D97757]" />
                            <span>Save Copy of &ldquo;{copyTargetLabel}&rdquo; to Your Folder</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowCopyModal(false)}
                            className="text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        {!isAuthenticated ? (
                          <div className="text-xs text-[#9E978E] space-y-2">
                            <p>Please sign in to your UnlimStorage account first to copy shared files into your folders.</p>
                            <button
                              type="button"
                              onClick={onExitPublicPortal}
                              className="min-h-[38px] px-4 py-2 font-bold bg-[#D97757] text-[#141311] cursor-pointer"
                            >
                              Go to Sign In
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between text-xs text-[#9E978E]">
                              <span>Choose destination folder in your drive:</span>
                              {onCreateFolder && (
                                <button
                                  type="button"
                                  onClick={() => setCreatingNewFolder((prev) => !prev)}
                                  className="px-2.5 py-1 bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1 cursor-pointer"
                                >
                                  <FolderPlus className="w-3 h-3 text-[#D97757]" />
                                  <span>New Folder</span>
                                </button>
                              )}
                            </div>

                            {creatingNewFolder && onCreateFolder && (
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={newFolderName}
                                  onChange={(e) => setNewFolderName(e.target.value)}
                                  placeholder="New folder name..."
                                  className="flex-1 min-h-[36px] bg-[#1C1A17] border border-[#2C2824] px-3 py-1 text-xs text-[#F2EFE9]"
                                />
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!newFolderName.trim()) return;
                                    const created = await onCreateFolder(newFolderName.trim());
                                    if (created) {
                                      setSelectedDestFolderId(created.id);
                                      setNewFolderName('');
                                      setCreatingNewFolder(false);
                                    }
                                  }}
                                  className="px-3 py-1 text-xs font-bold bg-[#D97757] text-[#141311] cursor-pointer"
                                >
                                  Create
                                </button>
                              </div>
                            )}

                            <div className="max-h-44 overflow-y-auto border border-[#2C2824] divide-y divide-[#2C2824] bg-[#1C1A17]">
                              <div
                                onClick={() => setSelectedDestFolderId(null)}
                                className={`px-3 py-2.5 flex items-center justify-between text-xs cursor-pointer ${
                                  selectedDestFolderId === null
                                    ? 'bg-[#24211D] text-[#D97757] font-bold'
                                    : 'text-[#F2EFE9] hover:bg-[#24211D]/50'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <Folder className="w-4 h-4 text-[#D97757]" />
                                  <span>My Cloud Drive (Root)</span>
                                </div>
                                {selectedDestFolderId === null && <Check className="w-4 h-4" />}
                              </div>
                              {userFolders
                                .filter((f) => !f.trashed)
                                .map((folder) => (
                                  <div
                                    key={folder.id}
                                    onClick={() => setSelectedDestFolderId(folder.id)}
                                    className={`px-3 py-2.5 flex items-center justify-between text-xs cursor-pointer ${
                                      selectedDestFolderId === folder.id
                                        ? 'bg-[#24211D] text-[#D97757] font-bold'
                                        : 'text-[#F2EFE9] hover:bg-[#24211D]/50'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 truncate">
                                      <Folder className="w-4 h-4 text-[#D97757] shrink-0" />
                                      <span className="truncate">{folder.name}</span>
                                    </div>
                                    {selectedDestFolderId === folder.id && (
                                      <Check className="w-4 h-4 shrink-0" />
                                    )}
                                  </div>
                                ))}
                            </div>

                            <div className="flex justify-end gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => setShowCopyModal(false)}
                                className="min-h-[38px] px-4 py-1.5 text-xs text-[#9E978E] border border-[#2C2824] cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={copyingToDrive}
                                onClick={async () => {
                                  setCopyingToDrive(true);
                                  setDownloadError(null);
                                  try {
                                    const count = await onCopyToMyDrive({
                                      token: share.token,
                                      targetFolderId: selectedDestFolderId,
                                      fileIds: copyTargetFileIds,
                                      password: passwordInput || undefined,
                                    });
                                    const destFolderName =
                                      selectedDestFolderId === null
                                        ? 'My Cloud Drive (Root)'
                                        : userFolders.find((f) => f.id === selectedDestFolderId)
                                            ?.name || 'Selected Folder';
                                    setCopiedSuccessMsg(
                                      `Copied ${count} ${
                                        count === 1 ? 'file' : 'files'
                                      } to "${destFolderName}"!`
                                    );
                                    setShowCopyModal(false);
                                  } catch (err: unknown) {
                                    setDownloadError(
                                      err instanceof Error
                                        ? err.message
                                        : 'Failed to copy shared file to your drive'
                                    );
                                  } finally {
                                    setCopyingToDrive(false);
                                  }
                                }}
                                className="min-h-[38px] px-5 py-1.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer disabled:opacity-50"
                              >
                                {copyingToDrive ? 'Saving Copy...' : 'Save Copy Here'}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {downloading && downloadProgress && (
                      <div className="space-y-1.5 bg-[#141311] border border-[#2C2824] p-3">
                        <div className="flex items-center justify-between text-xs text-[#9E978E] tabular-nums">
                          <span>
                            {downloadProgress.statusLabel
                              ? downloadProgress.statusLabel
                              : downloadProgress.chunkIndex && downloadProgress.totalChunks
                              ? `Fetching cloud part ${downloadProgress.chunkIndex} of ${downloadProgress.totalChunks}`
                              : 'Streaming binary data'}
                          </span>
                          <span className="text-[#F2EFE9] font-semibold">
                            {downloadProgress.percent}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-[#24211D] overflow-hidden">
                          <div
                            className="h-full bg-[#D97757] transition-all duration-200"
                            style={{ width: `${Math.max(2, downloadProgress.percent)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {downloadError && (
                      <div className="p-3 bg-[#D94848]/10 border border-[#D94848]/40 text-xs text-[#D94848]">
                        {downloadError}
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs text-[#9E978E] tabular-nums">
                      <span className="flex items-center gap-1.5 text-[#2E9E6B]">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        {isFolderShare
                          ? 'Direct streaming, gallery search & copy to drive enabled'
                          : 'Ready for direct download or copy to your drive'}
                      </span>
                      <span className="font-semibold text-[#2E9E6B]">
                        Unlimited Full Speed Enabled
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
        Powered by UnlimStorage — Zero-Knowledge Encrypted Cloud Storage
      </footer>
    </div>
  );
};
