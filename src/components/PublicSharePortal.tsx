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
} from 'lucide-react';
import { formatBytes, formatShortDate } from '../utils/format';
import { apiFetch } from '../services/clientCloudFallback';
import { YouTubeIframePlayer } from './YouTubeIframePlayer';

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
  hasDirectStream?: boolean;
}

interface DownloadProgressState {
  percent: number;
  loadedBytes: number;
  totalBytes: number;
  chunkIndex?: number;
  totalChunks?: number;
}

interface PublicSharePortalProps {
  token: string;
  onExitPublicPortal: () => void;
}

export const PublicSharePortal: React.FC<PublicSharePortalProps> = ({
  token,
  onExitPublicPortal,
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
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressState | null>(null);

  // Video stream state for JW Player style playback
  const [videoStreamUrl, setVideoStreamUrl] = useState<string | null>(null);
  const [loadingVideoStream, setLoadingVideoStream] = useState(false);
  const [copiedEmbedCode, setCopiedEmbedCode] = useState(false);

  const isVideoShare = React.useMemo(() => {
    if (!share) return false;
    return (
      share.fileMimeType.startsWith('video/') ||
      /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(share.fileName)
    );
  }, [share]);

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

  // Immediately assign direct HTTP 206 Range video stream URL when unlocked (0ms wait)
  useEffect(() => {
    if (!share || !unlockedKey || !isVideoShare) return;
    setLoadingVideoStream(false);
    const directInlineUrl = `/api/public/share/${encodeURIComponent(
      share.token
    )}/download?inline=1&key=${encodeURIComponent(unlockedKey)}&password=${encodeURIComponent(
      passwordInput
    )}`;
    setVideoStreamUrl(directInlineUrl);
  }, [share, unlockedKey, isVideoShare, passwordInput]);

  const handlePublicVideoFallback = React.useCallback(async () => {
    if (!share || !unlockedKey || !videoStreamUrl || videoStreamUrl.startsWith('blob:')) return;
    try {
      const streamEndpoint = `/api/public/share/${encodeURIComponent(
        share.token
      )}/download?key=${encodeURIComponent(unlockedKey)}&password=${encodeURIComponent(
        passwordInput
      )}`;
      const res = await apiFetch(streamEndpoint);
      if (!res.ok) return;
      const rawBlob = await res.blob();
      if (rawBlob.size <= 64) return;
      const normalizedMime =
        share.fileName.toLowerCase().endsWith('.mkv') ||
        share.fileMimeType === 'video/x-matroska'
          ? 'video/webm'
          : share.fileMimeType.startsWith('video/')
          ? share.fileMimeType
          : 'video/mp4';
      const videoBlob = new Blob([rawBlob], { type: normalizedMime });
      setVideoStreamUrl(URL.createObjectURL(videoBlob));
    } catch {
      // ignore fallback error
    }
  }, [share, unlockedKey, videoStreamUrl, passwordInput]);

  useEffect(() => {
    const handleProgress = (event: Event) => {
      const customEvent = event as CustomEvent<{
        token: string;
        loadedBytes: number;
        totalBytes: number;
        percent: number;
        chunkIndex?: number;
        totalChunks?: number;
      }>;
      if (customEvent.detail && customEvent.detail.token === token) {
        setDownloadProgress({
          percent: customEvent.detail.percent,
          loadedBytes: customEvent.detail.loadedBytes,
          totalBytes: customEvent.detail.totalBytes,
          chunkIndex: customEvent.detail.chunkIndex,
          totalChunks: customEvent.detail.totalChunks,
        });
      }
    };

    window.addEventListener('unlimcloud:public-share-progress', handleProgress);
    return () => {
      window.removeEventListener('unlimcloud:public-share-progress', handleProgress);
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
    setDownloadError(null);
    setDownloadProgress({
      percent: 0,
      loadedBytes: 0,
      totalBytes: share.fileSizeBytes || 0,
    });

    try {
      const downloadUrl = `/api/public/share/${encodeURIComponent(
        share.token
      )}/download?key=${encodeURIComponent(unlockedKey || '')}&password=${encodeURIComponent(
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

  const renderShareFileIcon = () => {
    if (!share) return <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-[#D97757]" />;
    if (
      share.fileMimeType.startsWith('video/') ||
      /\.(mp4|webm|mov|mkv)$/i.test(share.fileName)
    ) {
      return <Film className="w-5 h-5 sm:w-6 sm:h-6 text-[#D97757]" />;
    }
    if (
      share.fileMimeType.startsWith('image/') ||
      /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(share.fileName)
    ) {
      return <ImageIcon className="w-5 h-5 sm:w-6 sm:h-6 text-[#D97757]" />;
    }
    if (
      share.fileMimeType.startsWith('audio/') ||
      /\.(mp3|wav|ogg|flac|m4a)$/i.test(share.fileName)
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
      return (
        <div className="w-screen h-screen bg-black overflow-hidden">
          <YouTubeIframePlayer
            fileId={share.token}
            fileName={share.fileName}
            srcUrl={videoStreamUrl}
            rawBlob={null}
            isMkv={share.fileName.toLowerCase().endsWith('.mkv')}
            fullViewport={true}
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
          <span className="whitespace-nowrap shrink-0">Shared File Download</span>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            onClick={onExitPublicPortal}
            className="min-h-[40px] flex items-center gap-2 px-3.5 sm:px-4 py-2 text-xs font-medium text-[#F2EFE9] bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to My Files</span>
          </button>
        </div>
      </header>

      {/* Centered Friendly File Card */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div
          className={`w-full ${
            isVideoShare && unlockedKey ? 'max-w-3xl' : 'max-w-lg'
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
              {/* File Icon & Name */}
              <div className="flex items-start gap-3.5 sm:gap-4">
                <div className="w-11 h-11 sm:w-12 sm:h-12 bg-[#24211D] border border-[#2C2824] flex items-center justify-center shrink-0">
                  {renderShareFileIcon()}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <h1 className="text-base sm:text-xl font-bold text-[#F2EFE9] break-all">
                    {share.fileName}
                  </h1>
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs text-[#9E978E] tabular-nums">
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

              {/* Clean JW Player Video Preview when unlocked */}
              {isVideoShare && unlockedKey && (
                <div className="space-y-2.5">
                  {loadingVideoStream ? (
                    <div className="w-full aspect-video bg-black border border-[#2C2824] flex flex-col items-center justify-center gap-2 text-xs text-[#9E978E]">
                      <Loader2 className="w-6 h-6 text-[#D97757] animate-spin" />
                      <span>Loading video stream...</span>
                    </div>
                  ) : videoStreamUrl ? (
                    <YouTubeIframePlayer
                      fileId={share.token}
                      fileName={share.fileName}
                      srcUrl={videoStreamUrl}
                      rawBlob={null}
                      isMkv={share.fileName.toLowerCase().endsWith('.mkv')}
                      fullViewport={false}
                      onFallbackContainer={handlePublicVideoFallback}
                    />
                  ) : null}

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] text-[#9E978E]">
                      Direct fast-load stream · Preload enabled
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

              {/* Password Box or Download Button */}
              <div className="pt-4 border-t border-[#2C2824]">
                {share.hasPassword && !unlockedKey ? (
                  <form onSubmit={handleVerifyPassword} className="space-y-4">
                    <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-[#F2EFE9]">
                      <Lock className="w-4 h-4 text-[#D97757] shrink-0" />
                      <span>This file is protected with a password</span>
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
                      className="min-h-[48px] w-full flex items-center justify-center gap-2.5 py-3.5 px-6 text-sm font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] transition-colors cursor-pointer disabled:opacity-60"
                    >
                      {downloading ? (
                        <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4 shrink-0" />
                      )}
                      <span className="truncate">
                        {downloading
                          ? downloadProgress && downloadProgress.percent > 0
                            ? `Downloading... ${downloadProgress.percent}% (${formatBytes(
                                downloadProgress.loadedBytes
                              )} / ${formatBytes(downloadProgress.totalBytes)})`
                            : 'Preparing Cloud Stream...'
                          : `Download File (${formatBytes(share.fileSizeBytes)})`}
                      </span>
                    </button>

                    {downloading && downloadProgress && (
                      <div className="space-y-1.5 bg-[#141311] border border-[#2C2824] p-3">
                        <div className="flex items-center justify-between text-xs text-[#9E978E] tabular-nums">
                          <span>
                            {downloadProgress.chunkIndex && downloadProgress.totalChunks
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
        Powered by UnlimStorage — Zero-Knowledge Encrypted Cloud Storage
      </footer>
    </div>
  );
};

