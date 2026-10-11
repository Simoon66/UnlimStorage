import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  PictureInPicture2,
  Subtitles,
  Headphones,
  SlidersHorizontal,
  Check,
  Upload,
} from 'lucide-react';
import { TelegramChunk } from '../types';
import { getClientBinaryBlob } from '../services/clientCloudFallback';
import {
  getVideoProgress,
  saveVideoProgress,
  clearVideoProgress,
} from '../utils/mediaProgressAndZip';

interface YouTubeIframePlayerProps {
  fileId: string;
  fileName: string;
  srcUrl: string;
  rawBlob: Blob | null;
  isMkv: boolean;
  fullViewport?: boolean;
  fileSizeBytes?: number;
  fileMimeType?: string;
  telegramChunks?: TelegramChunk[];
  onFallbackContainer?: () => void;
  onPlaybackError?: (msg: string) => void;
}

interface AudioTrackItem {
  index: number;
  id: string;
  label: string;
  language: string;
  codec?: string;
  enabled: boolean;
}

interface SubtitleCueItem {
  start: number;
  end: number;
  text: string;
}

interface SubtitleTrackItem {
  id: string;
  label: string;
  language: string;
  srcUrl?: string;
  isEmbedded?: boolean;
  embeddedIndex?: number;
  serverSubIndex?: number;
  customCues?: SubtitleCueItem[];
}

interface ServerMediaInfoResponse {
  ok: boolean;
  duration: number;
  videoCodec: string;
  pixFmt: string;
  width: number;
  height: number;
  needsTranscode: boolean;
  canCopyVideo: boolean;
  availableQualities?: string[];
  audioTracks: Array<{
    index: number;
    streamIndex: number;
    codec: string;
    language: string;
    title: string;
    label: string;
    channels: number;
  }>;
  subtitleTracks: Array<{
    subIndex: number;
    streamIndex: number;
    codec: string;
    language: string;
    title: string;
    label: string;
  }>;
}

const QUALITY_LABELS: Record<string, { title: string; badge?: string }> = {
  Original: { title: 'Original (100% Lossless)', badge: 'ORIG' },
  Auto: { title: 'Auto (Original Quality)', badge: 'AUTO' },
  '1080p': { title: '1080p Full HD', badge: 'FHD' },
  '720p': { title: '720p HD', badge: 'HD' },
  '480p': { title: '480p Standard' },
  '360p': { title: '360p Data Saver' },
};

const ISO_LANG_LABELS: Record<string, string> = {
  hin: 'Hindi',
  hi: 'Hindi',
  tam: 'Tamil',
  ta: 'Tamil',
  tel: 'Telugu',
  te: 'Telugu',
  eng: 'English',
  en: 'English',
  jpn: 'Japanese',
  ja: 'Japanese',
  ben: 'Bengali',
  bn: 'Bengali',
  kor: 'Korean',
  ko: 'Korean',
  chi: 'Chinese',
  zho: 'Chinese',
  zh: 'Chinese',
  spa: 'Spanish',
  es: 'Spanish',
  fra: 'French',
  fr: 'French',
  ger: 'German',
  deu: 'German',
  de: 'German',
  rus: 'Russian',
  ru: 'Russian',
  ara: 'Arabic',
  por: 'Portuguese',
  ita: 'Italian',
  mal: 'Malayalam',
  kan: 'Kannada',
  mar: 'Marathi',
  urd: 'Urdu',
};

function parseTimestampToSeconds(raw: string): number {
  const clean = raw.trim().replace(',', '.');
  const parts = clean.split(':').map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

/**
 * Parses WebVTT or SRT subtitle text into clean timestamped cues and strips ASS/SSA/HTML tags.
 */
function parseSubtitleCues(rawText: string, offsetSeconds = 0): SubtitleCueItem[] {
  const cues: SubtitleCueItem[] = [];
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0 || lines[0].startsWith('WEBVTT') || lines[0].startsWith('NOTE')) {
      continue;
    }

    const arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx === -1) continue;

    const timeLine = lines[arrowIdx];
    const [startRaw, endWithSettings] = timeLine.split('-->');
    if (!startRaw || !endWithSettings) continue;

    const endRaw = endWithSettings.trim().split(/\s+/)[0];
    const startSec = parseTimestampToSeconds(startRaw) + offsetSeconds;
    const endSec = parseTimestampToSeconds(endRaw) + offsetSeconds;
    if (!(endSec > startSec)) continue;

    const textLines = lines
      .slice(arrowIdx + 1)
      .map((line) =>
        line
          .replace(/\{[^}]*\}/g, '') // Strip ASS/SSA style overrides like {\an8}
          .replace(/<[^>]+>/g, '') // Strip HTML tags
          .trim()
      )
      .filter(Boolean);

    if (textLines.length > 0) {
      cues.push({
        start: startSec,
        end: endSec,
        text: textLines.join('\n'),
      });
    }
  }
  return cues;
}

function parseMatroskaTracksFromHeaderBytes(bytes: Uint8Array): {
  audioTracks: AudioTrackItem[];
  hasHevcVideo: boolean;
} {
  const audioTracks: AudioTrackItem[] = [];
  let hasHevcVideo = false;
  try {
    const textDecoder = new TextDecoder('utf-8', { fatal: false });
    const ascii = textDecoder.decode(bytes);
    if (ascii.includes('V_MPEGH/ISO/HEVC')) {
      hasHevcVideo = true;
    }

    let i = 0;
    const limit = Math.min(bytes.length - 16, 262144);
    while (i < limit) {
      if (bytes[i] === 0x83 && bytes[i + 1] === 0x81) {
        const trackType = bytes[i + 2];
        if (trackType === 2) {
          const winStart = Math.max(0, i - 120);
          const winEnd = Math.min(bytes.length - 8, i + 220);
          let lang = '';
          let codec = '';

          for (let j = winStart; j < winEnd; j++) {
            if (
              bytes[j] === 0x22 &&
              bytes[j + 1] === 0xb5 &&
              bytes[j + 2] === 0x9c &&
              bytes[j + 3] > 0x80 &&
              bytes[j + 3] <= 0x88
            ) {
              const len = bytes[j + 3] - 0x80;
              lang = textDecoder
                .decode(bytes.subarray(j + 4, j + 4 + len))
                .replace(/\0/g, '')
                .trim()
                .toLowerCase();
            }
            if (bytes[j] === 0x86 && bytes[j + 1] > 0x80 && bytes[j + 1] <= 0x9f) {
              const len = bytes[j + 1] - 0x80;
              const rawCodec = textDecoder
                .decode(bytes.subarray(j + 2, j + 2 + len))
                .replace(/\0/g, '')
                .trim();
              if (rawCodec.startsWith('A_')) {
                codec = rawCodec.replace('A_', '').split('/')[0];
              }
            }
          }

          const idx = audioTracks.length;
          const langLabel =
            ISO_LANG_LABELS[lang] || (lang ? lang.toUpperCase() : `Track ${idx + 1}`);
          const fullLabel = codec ? `${langLabel} (${codec})` : langLabel;
          audioTracks.push({
            index: idx,
            id: `ebml_audio_${idx}`,
            label: fullLabel,
            language: lang || `track_${idx + 1}`,
            codec: codec.toLowerCase(),
            enabled: idx === 0,
          });
          i += 20;
          continue;
        }
      }
      i++;
    }
  } catch {
    // ignore binary scan errors
  }
  return { audioTracks, hasHevcVideo };
}

export const YouTubeIframePlayer: React.FC<YouTubeIframePlayerProps> = ({
  fileId,
  fileName,
  srcUrl,
  rawBlob,
  isMkv,
  fullViewport = false,
  fileSizeBytes,
  fileMimeType,
  telegramChunks,
  onFallbackContainer,
  onPlaybackError,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoPlayAfterSwitchRef = useRef<boolean>(false);
  const pendingSeekTargetRef = useRef<number | null>(null);
  const errorRetryCountRef = useRef<number>(0);
  const fetchedSubtitleWindowsRef = useRef<Set<string>>(new Set());

  const isServerApiSource = Boolean(
    srcUrl && !srcUrl.startsWith('blob:') && !srcUrl.startsWith('data:')
  );

  // Check saved playback progress for automatic resume
  const initialResumeProgress = useMemo(() => getVideoProgress(fileId), [fileId]);
  const initialResumeSeconds =
    initialResumeProgress && initialResumeProgress.currentTime >= 5
      ? initialResumeProgress.currentTime
      : 0;
  const hasAppliedNativeResumeRef = useRef<boolean>(false);
  const lastSavedSecRef = useRef<number>(-1);
  const [resumedBannerSeconds, setResumedBannerSeconds] = useState<number | null>(() =>
    initialResumeSeconds >= 5 ? initialResumeSeconds : null
  );

  // Immediately use the server FFmpeg H.264/AAC stream for MKVs so 10-bit HEVC MKVs render crystal-clear video on frame 1
  const [useServerTranscode, setUseServerTranscode] = useState<boolean>(
    () => Boolean(isMkv && isServerApiSource)
  );
  const [streamStartOffset, setStreamStartOffset] = useState<number>(() =>
    Boolean(isMkv && isServerApiSource) ? initialResumeSeconds : 0
  );
  const [probedDuration, setProbedDuration] = useState<number>(() =>
    initialResumeProgress?.duration && initialResumeProgress.duration > 0
      ? initialResumeProgress.duration
      : 0
  );
  const [hydrationNonce, setHydrationNonce] = useState<number>(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [showSpinner, setShowSpinner] = useState(false);
  const [currentTime, setCurrentTime] = useState(() =>
    Boolean(isMkv && isServerApiSource) ? 0 : initialResumeSeconds
  );
  const [duration, setDuration] = useState(0);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  // Smooth timeline scrubbing state (prevents restarting media buffer on every mouse pixel drag)
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState<number>(0);
  const [pendingSeekTime, setPendingSeekTime] = useState<number | null>(null);

  // Scrubber hover time preview
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  // On-screen HUD feedback for keyboard / skip / volume actions
  const [hudBadgeText, setHudBadgeText] = useState<string | null>(null);

  // Multi-Quality stream selector — defaults to 'Original' for 100% lossless zero-downscale playback
  const [availableQualities, setAvailableQualities] = useState<string[]>([
    'Original',
    'Auto',
    '1080p',
    '720p',
    '480p',
    '360p',
  ]);
  const [selectedQuality, setSelectedQuality] = useState<string>('Original');
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  // Multi-Audio tracks (only shown in UI if > 1 track exists on the video)
  const [audioTracks, setAudioTracks] = useState<AudioTrackItem[]>([]);
  const [activeAudioIndex, setActiveAudioIndex] = useState<number>(0);
  const [showAudioMenu, setShowAudioMenu] = useState(false);

  // CC / Subtitles tracks & parsed cues for clean, accurately positioned overlay rendering
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrackItem[]>([]);
  const [activeSubtitleId, setActiveSubtitleId] = useState<string | null>(null);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCueItem[]>([]);
  const [showCcMenu, setShowCcMenu] = useState(false);

  // Debounce the minimal spinner by 320ms so brief seeks/loads don't flash an annoying overlay
  useEffect(() => {
    if (spinnerTimerRef.current) {
      clearTimeout(spinnerTimerRef.current);
      spinnerTimerRef.current = null;
    }
    if (!isBuffering) {
      setShowSpinner(false);
      return;
    }
    spinnerTimerRef.current = setTimeout(() => {
      setShowSpinner(true);
    }, 320);
    return () => {
      if (spinnerTimerRef.current) {
        clearTimeout(spinnerTimerRef.current);
      }
    };
  }, [isBuffering]);

  const showHudFeedback = useCallback((text: string) => {
    setHudBadgeText(text);
    if (hudTimerRef.current) {
      clearTimeout(hudTimerRef.current);
    }
    hudTimerRef.current = setTimeout(() => {
      setHudBadgeText(null);
    }, 1000);
  }, []);

  // Derive API endpoints for media-info, live FFmpeg H.264/AAC streaming, WebVTT subtitle extraction, and binary hydration
  const streamEndpoints = useMemo(() => {
    try {
      const parsed = new URL(srcUrl, window.location.origin);
      const shareMatch = parsed.pathname.match(/^\/api\/public\/share\/([^/]+)\/download/);
      const queryParams = new URLSearchParams(parsed.search);
      queryParams.delete('inline');
      if (fileName) {
        queryParams.set('name', fileName);
      }
      const baseQuery = queryParams.toString();

      if (shareMatch) {
        const token = shareMatch[1];
        return {
          isPublicShare: true,
          ensureUrl: null,
          hydrateUrl: null,
          mediaInfoUrl: `/api/public/share/${token}/media-info${baseQuery ? `?${baseQuery}` : ''}`,
          streamBaseUrl: `/api/public/share/${token}/stream${baseQuery ? `?${baseQuery}` : ''}`,
          subtitlesBaseUrl: `/api/public/share/${token}/subtitles${baseQuery ? `?${baseQuery}` : ''}`,
        };
      }

      const encodedId = encodeURIComponent(fileId);
      return {
        isPublicShare: false,
        ensureUrl: `/api/files/${encodedId}/ensure-streamable${baseQuery ? `?${baseQuery}` : ''}`,
        hydrateUrl: `/api/files/${encodedId}/hydrate-binary${baseQuery ? `?${baseQuery}` : ''}`,
        mediaInfoUrl: `/api/files/${encodedId}/media-info${baseQuery ? `?${baseQuery}` : ''}`,
        streamBaseUrl: `/api/files/${encodedId}/stream${baseQuery ? `?${baseQuery}` : ''}`,
        subtitlesBaseUrl: `/api/files/${encodedId}/subtitles${baseQuery ? `?${baseQuery}` : ''}`,
      };
    } catch {
      const encodedId = encodeURIComponent(fileId);
      const q = fileName ? `?name=${encodeURIComponent(fileName)}` : '';
      return {
        isPublicShare: false,
        ensureUrl: `/api/files/${encodedId}/ensure-streamable${q}`,
        hydrateUrl: `/api/files/${encodedId}/hydrate-binary${q}`,
        mediaInfoUrl: `/api/files/${encodedId}/media-info${q}`,
        streamBaseUrl: `/api/files/${encodedId}/stream${q}`,
        subtitlesBaseUrl: `/api/files/${encodedId}/subtitles${q}`,
      };
    }
  }, [fileId, fileName, srcUrl]);

  // Compute the active <video src="..."> URL immediately (no blocking wait before starting playback!)
  const activeVideoSrc = useMemo(() => {
    if (useServerTranscode && isServerApiSource) {
      const sep = streamEndpoints.streamBaseUrl.includes('?') ? '&' : '?';
      return `${streamEndpoints.streamBaseUrl}${sep}audio=${activeAudioIndex}&quality=${encodeURIComponent(
        selectedQuality
      )}&start=${streamStartOffset.toFixed(2)}${hydrationNonce ? `&r=${hydrationNonce}` : ''}`;
    }
    return srcUrl;
  }, [
    useServerTranscode,
    isServerApiSource,
    streamEndpoints.streamBaseUrl,
    activeAudioIndex,
    selectedQuality,
    streamStartOffset,
    hydrationNonce,
    srcUrl,
  ]);

  // Background inspect media-info (FFprobe) to detect Multi-Audio, Subtitles, Duration, and Qualities
  // Runs in parallel with video startup so playback is NEVER delayed!
  useEffect(() => {
    let cancelled = false;

    const inspectMediaInBackground = async () => {
      try {
        if (streamEndpoints.ensureUrl && isServerApiSource) {
          const ensureRes = await fetch(streamEndpoints.ensureUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: fileName,
              sizeBytes: fileSizeBytes || rawBlob?.size || 0,
              mimeType: fileMimeType || (isMkv ? 'video/x-matroska' : 'video/mp4'),
              telegramChunks: telegramChunks || [],
            }),
          });
          if (ensureRes.ok) {
            const ensureJson = (await ensureRes.json()) as {
              ok?: boolean;
              hasBinaryOrChunks?: boolean;
            };
            if (ensureJson && ensureJson.hasBinaryOrChunks === false && streamEndpoints.hydrateUrl) {
              const clientBlob = rawBlob || (await getClientBinaryBlob(fileId));
              if (clientBlob && clientBlob.size > 64 && !cancelled) {
                await fetch(streamEndpoints.hydrateUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/octet-stream' },
                  body: clientBlob,
                }).catch(() => null);
                if (!cancelled) {
                  setHydrationNonce((n) => n + 1);
                }
              }
            }
          }
        }
      } catch {
        // continue
      }

      if (cancelled) return;

      try {
        const res = await fetch(streamEndpoints.mediaInfoUrl);
        if (res.ok) {
          const info = (await res.json()) as ServerMediaInfoResponse;
          if (!cancelled && info && info.ok) {
            if (info.duration > 0) {
              setProbedDuration(info.duration);
            }
            if (info.availableQualities && info.availableQualities.length > 0) {
              const withAuto = info.availableQualities.includes('Auto')
                ? info.availableQualities
                : ['Auto', ...info.availableQualities];
              setAvailableQualities(withAuto);
            }
            if (info.audioTracks && info.audioTracks.length > 1) {
              setAudioTracks(
                info.audioTracks.map((t, idx) => ({
                  index: t.index ?? idx,
                  id: `server_audio_${t.index ?? idx}`,
                  label: t.label,
                  language: t.language,
                  codec: t.codec,
                  enabled: idx === 0,
                }))
              );
            }
            if (info.subtitleTracks && info.subtitleTracks.length > 0) {
              setSubtitleTracks((prev) => {
                const customOnly = prev.filter(
                  (item) => item.serverSubIndex === undefined && !item.isEmbedded
                );
                const serverSubs: SubtitleTrackItem[] = info.subtitleTracks.map((st) => ({
                  id: `server_sub_${st.subIndex}`,
                  label: st.label,
                  language: st.language || 'en',
                  serverSubIndex: st.subIndex,
                }));
                return [...serverSubs, ...customOnly];
              });
            }
            if (info.needsTranscode && isServerApiSource) {
              setUseServerTranscode(true);
            }
            return;
          }
        }
      } catch {
        // Fallback to client-side header inspection below
      }

      if (isMkv && !cancelled) {
        try {
          let headerBytes: Uint8Array | null = null;
          if (rawBlob && rawBlob.size > 0) {
            const sliceBuf = await rawBlob.slice(0, 262144).arrayBuffer();
            headerBytes = new Uint8Array(sliceBuf);
          } else if (srcUrl && !srcUrl.startsWith('data:')) {
            const rangeRes = await fetch(srcUrl, {
              headers: { Range: 'bytes=0-262143' },
            });
            if (rangeRes.ok) {
              const arrBuf = await rangeRes.arrayBuffer();
              headerBytes = new Uint8Array(arrBuf);
            }
          }
          if (!cancelled && headerBytes && headerBytes.length > 0) {
            const parsed = parseMatroskaTracksFromHeaderBytes(headerBytes);
            if (parsed.audioTracks.length > 1) {
              setAudioTracks(parsed.audioTracks);
            }
          }
        } catch {
          // ignore
        }
      }
    };

    void inspectMediaInBackground();

    return () => {
      cancelled = true;
    };
  }, [
    streamEndpoints.ensureUrl,
    streamEndpoints.hydrateUrl,
    streamEndpoints.mediaInfoUrl,
    fileId,
    fileName,
    fileSizeBytes,
    fileMimeType,
    telegramChunks,
    isMkv,
    isServerApiSource,
    rawBlob,
    srcUrl,
  ]);

  // Auto-dismiss Resume Playback badge after 6.5 seconds
  useEffect(() => {
    if (resumedBannerSeconds === null) return;
    const t = setTimeout(() => {
      setResumedBannerSeconds(null);
    }, 6500);
    return () => clearTimeout(t);
  }, [resumedBannerSeconds]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (seekCommitTimerRef.current) clearTimeout(seekCommitTimerRef.current);
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
      if (spinnerTimerRef.current) clearTimeout(spinnerTimerRef.current);
    };
  }, []);

  const anyMenuOpen = showAudioMenu || showCcMenu || showQualityMenu;

  const scheduleHideControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    if (isPlaying && !anyMenuOpen && !isScrubbing) {
      hideControlsTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 2600);
    }
  }, [isPlaying, anyMenuOpen, isScrubbing]);

  useEffect(() => {
    if (!isPlaying || anyMenuOpen || isScrubbing) {
      setControlsVisible(true);
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }
    } else {
      scheduleHideControls();
    }
    return () => {
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, [isPlaying, anyMenuOpen, isScrubbing, scheduleHideControls]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const handleEnterPip = () => setIsPip(true);
    const handleLeavePip = () => setIsPip(false);
    vid.addEventListener('enterpictureinpicture', handleEnterPip);
    vid.addEventListener('leavepictureinpicture', handleLeavePip);
    return () => {
      vid.removeEventListener('enterpictureinpicture', handleEnterPip);
      vid.removeEventListener('leavepictureinpicture', handleLeavePip);
    };
  }, [activeVideoSrc]);

  const syncBrowserMediaTracks = useCallback(() => {
    const vid = videoRef.current as
      | (HTMLVideoElement & {
          audioTracks?: {
            length: number;
            [index: number]: {
              id?: string;
              label?: string;
              language?: string;
              enabled?: boolean;
            };
          };
        })
      | null;
    if (!vid) return;

    const rawAudio = vid.audioTracks;
    if (rawAudio && rawAudio.length > 1) {
      setAudioTracks((prev) => {
        if (prev.length > 1) return prev;
        const detectedAudio: AudioTrackItem[] = [];
        for (let i = 0; i < rawAudio.length; i++) {
          const track = rawAudio[i];
          const langCode = (track?.language || '').toLowerCase();
          const friendlyLang = ISO_LANG_LABELS[langCode] || track?.language?.toUpperCase() || '';
          detectedAudio.push({
            index: i,
            id: track?.id || `audio_${i}`,
            label:
              track?.label ||
              (friendlyLang ? `Audio (${friendlyLang})` : `Audio Track ${i + 1}`),
            language: langCode,
            enabled: Boolean(track?.enabled),
          });
        }
        return detectedAudio;
      });
    }
  }, []);

  const effectiveDuration = probedDuration > 0 ? probedDuration : duration;
  const rawPlaybackTime = useServerTranscode
    ? Math.min(effectiveDuration || Infinity, streamStartOffset + currentTime)
    : currentTime;
  const displayedCurrentTime = isScrubbing
    ? scrubTime
    : pendingSeekTime !== null
    ? pendingSeekTime
    : rawPlaybackTime;

  // On-demand, windowed subtitle cue loader (ONLY runs when user enables a subtitle track!)
  const currentSubtitleWindow = Math.floor(Math.max(0, displayedCurrentTime) / 120) * 120;

  useEffect(() => {
    if (!activeSubtitleId) {
      setSubtitleCues([]);
      fetchedSubtitleWindowsRef.current.clear();
      return;
    }

    const selected = subtitleTracks.find((t) => t.id === activeSubtitleId);
    if (!selected) {
      setSubtitleCues([]);
      return;
    }

    if (selected.customCues) {
      setSubtitleCues(selected.customCues);
      return;
    }

    if (selected.serverSubIndex !== undefined) {
      const winKey = `${selected.id}:${currentSubtitleWindow}`;
      if (fetchedSubtitleWindowsRef.current.has(winKey)) {
        return;
      }
      fetchedSubtitleWindowsRef.current.add(winKey);

      const sep = streamEndpoints.subtitlesBaseUrl.includes('?') ? '&' : '?';
      const subUrl = `${streamEndpoints.subtitlesBaseUrl}${sep}subIndex=${selected.serverSubIndex}&start=${currentSubtitleWindow}`;
      let cancelled = false;

      fetch(subUrl)
        .then((r) => (r.ok ? r.text() : ''))
        .then((vttText) => {
          if (cancelled || !vttText) return;
          const newCues = parseSubtitleCues(vttText, currentSubtitleWindow);
          if (newCues.length > 0) {
            setSubtitleCues((prev) => {
              const merged = [...prev, ...newCues];
              return merged.filter(
                (c, i, arr) =>
                  arr.findIndex(
                    (x) => Math.abs(x.start - c.start) < 0.25 && x.text === c.text
                  ) === i
              );
            });
          }
        })
        .catch(() => null);

      return () => {
        cancelled = true;
      };
    }
  }, [activeSubtitleId, subtitleTracks, currentSubtitleWindow, streamEndpoints.subtitlesBaseUrl]);

  // Compute active subtitle text for the current timestamp
  const activeSubtitleText = useMemo(() => {
    if (!activeSubtitleId || subtitleCues.length === 0) return null;
    const matches = subtitleCues.filter(
      (c) => displayedCurrentTime >= c.start && displayedCurrentTime <= c.end
    );
    if (matches.length === 0) return null;
    return matches.map((m) => m.text).join('\n');
  }, [activeSubtitleId, subtitleCues, displayedCurrentTime]);

  function formatClock(sec: number) {
    if (!Number.isFinite(sec) || sec < 0) return '00:00';
    const total = Math.floor(sec);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  // Core Seek Engine: Safely seeks within local buffer if seekable, or seamlessly seeks via FFmpeg streamStartOffset
  const seekToTargetSeconds = useCallback(
    (targetSec: number, immediateCommit = false) => {
      const vid = videoRef.current;
      if (!vid) return;
      const maxDur = effectiveDuration || vid.duration || 0;
      const clampedTarget =
        maxDur > 0 ? Math.max(0, Math.min(maxDur - 0.2, targetSec)) : Math.max(0, targetSec);

      pendingSeekTargetRef.current = clampedTarget;
      setPendingSeekTime(clampedTarget);

      if (useServerTranscode && isServerApiSource) {
        const localOffset = clampedTarget - streamStartOffset;
        let canSeekLocally = false;
        if (
          localOffset >= 0 &&
          vid.buffered &&
          vid.buffered.length > 0 &&
          vid.seekable &&
          vid.seekable.length > 0
        ) {
          const seekableEnd = vid.seekable.end(vid.seekable.length - 1);
          if (localOffset >= vid.seekable.start(0) && localOffset <= seekableEnd - 0.35) {
            for (let i = 0; i < vid.buffered.length; i++) {
              if (
                localOffset >= vid.buffered.start(i) &&
                localOffset <= Math.max(0, vid.buffered.end(i) - 0.35)
              ) {
                canSeekLocally = true;
                break;
              }
            }
          }
        }

        if (canSeekLocally) {
          if (seekCommitTimerRef.current) {
            clearTimeout(seekCommitTimerRef.current);
            seekCommitTimerRef.current = null;
          }
          vid.currentTime = localOffset;
          setCurrentTime(localOffset);
          pendingSeekTargetRef.current = null;
          setPendingSeekTime(null);
        } else {
          if (seekCommitTimerRef.current) {
            clearTimeout(seekCommitTimerRef.current);
          }
          const commitFn = () => {
            const finalTarget = pendingSeekTargetRef.current ?? clampedTarget;
            autoPlayAfterSwitchRef.current = !vid.paused || isPlaying;
            errorRetryCountRef.current = 0;
            setIsBuffering(true);
            setStreamStartOffset(finalTarget);
            setCurrentTime(0);
          };

          if (immediateCommit) {
            commitFn();
          } else {
            seekCommitTimerRef.current = setTimeout(commitFn, 140);
          }
        }
      } else {
        try {
          vid.currentTime = clampedTarget;
          setCurrentTime(clampedTarget);
        } catch {
          // ignore if metadata not loaded yet
        }
        pendingSeekTargetRef.current = null;
        setPendingSeekTime(null);
      }
      scheduleHideControls();
    },
    [
      effectiveDuration,
      useServerTranscode,
      isServerApiSource,
      streamStartOffset,
      isPlaying,
      scheduleHideControls,
    ]
  );

  const handleSelectQuality = (quality: string) => {
    setShowQualityMenu(false);
    if (quality === selectedQuality && useServerTranscode) return;

    const resumeAt = displayedCurrentTime;
    const vid = videoRef.current;
    autoPlayAfterSwitchRef.current = vid ? !vid.paused || isPlaying : true;
    errorRetryCountRef.current = 0;

    setSelectedQuality(quality);
    showHudFeedback(`Quality: ${quality}`);

    if (isServerApiSource) {
      setIsBuffering(true);
      setUseServerTranscode(true);
      setStreamStartOffset(resumeAt);
      setCurrentTime(0);
      setPendingSeekTime(resumeAt);
    }
  };

  const handleSelectAudioTrack = (index: number) => {
    setShowAudioMenu(false);
    if (index === activeAudioIndex) return;

    const selectedTrack = audioTracks.find((t) => t.index === index);
    setActiveAudioIndex(index);
    setAudioTracks((prev) =>
      prev.map((item) => ({
        ...item,
        enabled: item.index === index,
      }))
    );
    showHudFeedback(`Audio: ${selectedTrack?.label.split(' ')[0] || `Track ${index + 1}`}`);

    if (isServerApiSource) {
      const resumeAt = displayedCurrentTime;
      autoPlayAfterSwitchRef.current = true;
      errorRetryCountRef.current = 0;
      setIsBuffering(true);
      setUseServerTranscode(true);
      setStreamStartOffset(resumeAt);
      setCurrentTime(0);
      setPendingSeekTime(resumeAt);
      return;
    }

    const vid = videoRef.current as
      | (HTMLVideoElement & {
          audioTracks?: {
            length: number;
            [idx: number]: { enabled: boolean };
          };
        })
      | null;
    if (vid && vid.audioTracks) {
      for (let i = 0; i < vid.audioTracks.length; i++) {
        vid.audioTracks[i].enabled = i === index;
      }
    }
  };

  const handleSelectSubtitle = (trackId: string | null) => {
    fetchedSubtitleWindowsRef.current.clear();
    setSubtitleCues([]);
    setActiveSubtitleId(trackId);
    setShowCcMenu(false);

    const selected = subtitleTracks.find((t) => t.id === trackId);
    showHudFeedback(selected ? `CC: ${selected.label}` : 'CC: Off');
  };

  const handleUploadSubtitleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const rawText = await file.text();
      const parsedCues = parseSubtitleCues(rawText, 0);
      const cleanLabel = file.name.replace(/\.(srt|vtt)$/i, '') || 'Custom CC';
      const newTrack: SubtitleTrackItem = {
        id: `custom_cc_${Date.now()}`,
        label: cleanLabel,
        language: 'en',
        isEmbedded: false,
        customCues: parsedCues,
      };

      fetchedSubtitleWindowsRef.current.clear();
      setSubtitleTracks((prev) => [...prev, newTrack]);
      setActiveSubtitleId(newTrack.id);
      setSubtitleCues(parsedCues);
      setShowCcMenu(false);
      showHudFeedback(`CC Loaded: ${cleanLabel}`);
    } catch {
      // ignore invalid subtitle file
    }
  };

  const togglePlay = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused || vid.ended) {
      if (vid.ended) {
        if (useServerTranscode && streamStartOffset > 0) {
          autoPlayAfterSwitchRef.current = true;
          setStreamStartOffset(0);
          setCurrentTime(0);
          setPendingSeekTime(null);
          return;
        }
        vid.currentTime = 0;
      }
      vid.play().catch(() => null);
    } else {
      vid.pause();
    }
  }, [useServerTranscode, streamStartOffset]);

  const handleSkip = useCallback(
    (deltaSeconds: number) => {
      const baseTime =
        pendingSeekTargetRef.current !== null
          ? pendingSeekTargetRef.current
          : displayedCurrentTime;
      const nextTarget = Math.max(0, baseTime + deltaSeconds);
      showHudFeedback(deltaSeconds > 0 ? `+${deltaSeconds}s ⏩` : `${deltaSeconds}s ⏪`);
      seekToTargetSeconds(nextTarget, false);
    },
    [displayedCurrentTime, seekToTargetSeconds, showHudFeedback]
  );

  const adjustVolumeBy = useCallback(
    (delta: number) => {
      const vid = videoRef.current;
      const baseVol = isMuted ? 0 : volume;
      const nextVol = Math.round(Math.max(0, Math.min(1, baseVol + delta)) * 100) / 100;
      setVolume(nextVol);
      setIsMuted(nextVol === 0);
      if (vid) {
        vid.volume = nextVol;
        vid.muted = nextVol === 0;
      }
      showHudFeedback(nextVol === 0 ? 'Muted 🔇' : `Volume ${Math.round(nextVol * 100)}% 🔊`);
      scheduleHideControls();
    },
    [volume, isMuted, showHudFeedback, scheduleHideControls]
  );

  const handleScrubStart = () => {
    setIsScrubbing(true);
    setScrubTime(displayedCurrentTime);
  };

  const handleScrubChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = Number(e.target.value);
    setScrubTime(newTime);
    if (!isScrubbing) {
      seekToTargetSeconds(newTime, true);
    } else if (!useServerTranscode && videoRef.current) {
      try {
        videoRef.current.currentTime = newTime;
        setCurrentTime(newTime);
      } catch {
        // ignore
      }
    }
  };

  const handleScrubEnd = (
    e:
      | React.PointerEvent<HTMLInputElement>
      | React.MouseEvent<HTMLInputElement>
      | React.TouchEvent<HTMLInputElement>
  ) => {
    const finalVal = Number((e.currentTarget as HTMLInputElement).value);
    setIsScrubbing(false);
    seekToTargetSeconds(Number.isFinite(finalVal) ? finalVal : scrubTime, true);
  };

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const bar = timelineRef.current;
    if (!bar || !effectiveDuration) return;
    const rect = bar.getBoundingClientRect();
    const relX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const pct = (relX / Math.max(1, rect.width)) * 100;
    setHoverPct(pct);
    setHoverTime((pct / 100) * effectiveDuration);
  };

  const handleTimelineMouseLeave = () => {
    setHoverPct(null);
    setHoverTime(null);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vid = videoRef.current;
    const val = Number(e.target.value);
    setVolume(val);
    setIsMuted(val === 0);
    if (vid) {
      vid.volume = val;
      vid.muted = val === 0;
    }
  };

  const toggleMute = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    vid.muted = nextMute;
    showHudFeedback(nextMute ? 'Muted 🔇' : `Volume ${Math.round(volume * 100)}% 🔊`);
  }, [isMuted, volume, showHudFeedback]);

  const togglePictureInPicture = useCallback(async () => {
    const vid = videoRef.current;
    if (!vid) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPip(false);
      } else if (typeof vid.requestPictureInPicture === 'function') {
        await vid.requestPictureInPicture();
        setIsPip(true);
      }
    } catch {
      // PiP not supported on this device
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const targetEl = playerContainerRef.current;
    if (!targetEl) return;
    if (!document.fullscreenElement) {
      targetEl
        .requestFullscreen?.()
        .then(() => setIsFullscreen(true))
        .catch(() => null);
    } else {
      document
        .exitFullscreen?.()
        .then(() => setIsFullscreen(false))
        .catch(() => null);
    }
  }, []);

  // Global keyboard listener while player is mounted so Arrow keys (Seek -10s/+10s, Volume Up/Down), Space, M, F work reliably
  useEffect(() => {
    const onWindowKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range'))
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === ' ' || key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        togglePlay();
      } else if (key === 'arrowleft' || key === 'j') {
        e.preventDefault();
        e.stopPropagation();
        handleSkip(-10);
      } else if (key === 'arrowright' || key === 'l') {
        e.preventDefault();
        e.stopPropagation();
        handleSkip(10);
      } else if (key === 'arrowup') {
        e.preventDefault();
        e.stopPropagation();
        adjustVolumeBy(0.1);
      } else if (key === 'arrowdown') {
        e.preventDefault();
        e.stopPropagation();
        adjustVolumeBy(-0.1);
      } else if (key === 'm') {
        e.preventDefault();
        e.stopPropagation();
        toggleMute();
      } else if (key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        toggleFullscreen();
      } else if (key === 'p') {
        e.preventDefault();
        e.stopPropagation();
        void togglePictureInPicture();
      }
    };

    window.addEventListener('keydown', onWindowKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown, { capture: true });
    };
  }, [
    togglePlay,
    handleSkip,
    adjustVolumeBy,
    toggleMute,
    toggleFullscreen,
    togglePictureInPicture,
  ]);

  const progressPct =
    effectiveDuration > 0 ? Math.min(100, (displayedCurrentTime / effectiveDuration) * 100) : 0;

  const activeAudioTrackObj =
    audioTracks.find((t) => t.index === activeAudioIndex) || audioTracks[0] || null;

  return (
    <div
      className={`w-full bg-black overflow-hidden ${
        fullViewport ? 'h-screen border-0' : 'border border-[#2C2824]'
      }`}
    >
      <input
        ref={subtitleInputRef}
        type="file"
        accept=".vtt,.srt"
        onChange={handleUploadSubtitleFile}
        className="hidden"
      />

      <div
        ref={playerContainerRef}
        tabIndex={0}
        onMouseMove={scheduleHideControls}
        onTouchStart={scheduleHideControls}
        onClick={() => {
          if (showAudioMenu) setShowAudioMenu(false);
          if (showCcMenu) setShowCcMenu(false);
          if (showQualityMenu) setShowQualityMenu(false);
        }}
        className={`relative w-full bg-black flex flex-col justify-between overflow-hidden select-none focus:outline-none ${
          fullViewport
            ? 'h-full'
            : 'aspect-video min-h-[210px] sm:min-h-[320px] max-h-[78vh]'
        }`}
      >
        {/* ====================================================================
            VIDEO STAGE (Fast Load, Centered Play Button, Properly Positioned Subtitles)
        ==================================================================== */}
        <div
          onClick={togglePlay}
          onDoubleClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = e.clientX - rect.left;
            if (relX < rect.width * 0.3) {
              handleSkip(-10);
            } else if (relX > rect.width * 0.7) {
              handleSkip(10);
            } else {
              toggleFullscreen();
            }
          }}
          className="relative flex-1 w-full h-full flex items-center justify-center bg-black cursor-pointer overflow-hidden"
        >
          <video
            ref={videoRef}
            src={activeVideoSrc}
            playsInline
            preload="auto"
            crossOrigin="anonymous"
            onLoadStart={() => {
              setIsBuffering(true);
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => {
              setIsPlaying(false);
              setIsBuffering(false);
            }}
            onEnded={() => {
              setIsPlaying(false);
              setIsBuffering(false);
              setControlsVisible(true);
              clearVideoProgress(fileId);
            }}
            onWaiting={() => {
              setIsBuffering(true);
            }}
            onPlaying={() => {
              setIsBuffering(false);
              pendingSeekTargetRef.current = null;
              setPendingSeekTime(null);
            }}
            onCanPlay={(e) => {
              setIsBuffering(false);
              pendingSeekTargetRef.current = null;
              setPendingSeekTime(null);
              const vid = e.currentTarget;
              vid.volume = volume;
              vid.muted = isMuted;
              if (autoPlayAfterSwitchRef.current) {
                autoPlayAfterSwitchRef.current = false;
                vid.play().catch(() => null);
              }
            }}
            onLoadedData={(e) => {
              setIsBuffering(false);
              const vid = e.currentTarget;
              if (!useServerTranscode && isServerApiSource && vid.videoWidth === 0) {
                autoPlayAfterSwitchRef.current = !vid.paused;
                setIsBuffering(true);
                setUseServerTranscode(true);
                return;
              }
              syncBrowserMediaTracks();
            }}
            onLoadedMetadata={(e) => {
              setIsBuffering(false);
              const vid = e.currentTarget;
              if (
                !useServerTranscode &&
                vid.duration &&
                Number.isFinite(vid.duration) &&
                vid.duration > 0
              ) {
                setDuration(vid.duration);
                if (
                  !hasAppliedNativeResumeRef.current &&
                  initialResumeSeconds >= 5 &&
                  initialResumeSeconds < vid.duration - 8
                ) {
                  hasAppliedNativeResumeRef.current = true;
                  try {
                    vid.currentTime = initialResumeSeconds;
                    setCurrentTime(initialResumeSeconds);
                  } catch {
                    // ignore
                  }
                }
              }
              if (!useServerTranscode && isServerApiSource && vid.videoWidth === 0) {
                autoPlayAfterSwitchRef.current = !vid.paused;
                setIsBuffering(true);
                setUseServerTranscode(true);
                return;
              }
              syncBrowserMediaTracks();
            }}
            onProgress={(e) => {
              const vid = e.currentTarget;
              const maxDur = effectiveDuration || vid.duration || 0;
              if (vid.buffered && vid.buffered.length > 0 && maxDur > 0) {
                const bufEnd = streamStartOffset + vid.buffered.end(vid.buffered.length - 1);
                setBufferedPct(Math.min(100, (bufEnd / maxDur) * 100));
              }
            }}
            onTimeUpdate={(e) => {
              const vid = e.currentTarget;
              if (!vid.paused && vid.currentTime > 0) {
                setIsBuffering(false);
              }
              if (!isScrubbing && pendingSeekTargetRef.current === null) {
                setCurrentTime(vid.currentTime || 0);
              }
              const maxDur = effectiveDuration || vid.duration || 0;
              const actualPos = useServerTranscode
                ? streamStartOffset + (vid.currentTime || 0)
                : vid.currentTime || 0;
              const floorSec = Math.floor(actualPos);
              if (floorSec > 0 && floorSec % 2 === 0 && floorSec !== lastSavedSecRef.current) {
                lastSavedSecRef.current = floorSec;
                saveVideoProgress(fileId, actualPos, maxDur);
              }
              if (vid.buffered && vid.buffered.length > 0 && maxDur > 0) {
                const bufEnd = streamStartOffset + vid.buffered.end(vid.buffered.length - 1);
                setBufferedPct(Math.min(100, (bufEnd / maxDur) * 100));
              }
            }}
            onError={() => {
              if (!useServerTranscode && isServerApiSource) {
                setIsBuffering(true);
                setUseServerTranscode(true);
                return;
              }
              if (useServerTranscode && errorRetryCountRef.current < 2) {
                errorRetryCountRef.current += 1;
                const vid = videoRef.current;
                if (vid) {
                  setTimeout(() => {
                    vid.load();
                    if (autoPlayAfterSwitchRef.current) {
                      vid.play().catch(() => null);
                    }
                  }, 250);
                }
                return;
              }
              setIsBuffering(false);
              if (!isMkv && onFallbackContainer) {
                onFallbackContainer();
              } else if (onPlaybackError) {
                onPlaybackError(
                  'Video stream encountered a network interruption. Click Play or select another quality to resume.'
                );
              }
            }}
            className="w-full h-full max-h-full object-contain"
          />

          {/* Center Play Button (Kept as first <button> child in video stage for Focus Mode & centered via absolute positioning) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-black/80 hover:bg-[#D97757] text-white hover:text-[#141311] border-2 border-white/30 hover:border-[#D97757] flex items-center justify-center transition-all duration-150 cursor-pointer shadow-2xl ${
              !isPlaying && !showSpinner
                ? 'opacity-100 scale-100 pointer-events-auto'
                : 'opacity-0 scale-90 pointer-events-none'
            }`}
            aria-label={fileName ? `Play ${fileName}` : 'Play Video'}
          >
            <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-current ml-1" />
          </button>

          {/* Properly Positioned Cinema Subtitle Overlay (Never overlaps the control bar!) */}
          {activeSubtitleText && (
            <div
              className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-20 w-[90%] max-w-2xl flex flex-col items-center justify-center text-center transition-all duration-200 ${
                controlsVisible ? 'bottom-16 sm:bottom-20' : 'bottom-4 sm:bottom-6'
              }`}
            >
              <span className="inline-block px-3 py-1 bg-black/80 text-[#F2EFE9] text-xs sm:text-sm md:text-base font-medium leading-snug whitespace-pre-line shadow-lg border border-white/10">
                {activeSubtitleText}
              </span>
            </div>
          )}

          {/* On-Screen HUD Badge for Skip (-10s/+10s), Volume Up/Down, Quality & Audio Switches */}
          {hudBadgeText && (
            <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 z-20 px-3 py-1 bg-black/80 border border-white/15 text-white text-xs font-mono font-semibold tracking-wide">
              {hudBadgeText}
            </div>
          )}

          {/* Resume Playback Toast Badge with One-Click "Start Over" */}
          {resumedBannerSeconds !== null && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute top-3 left-3 z-20 flex items-center gap-2.5 px-3 py-1.5 bg-[#141311]/90 border border-[#2C2824] text-[#F2EFE9] text-xs shadow-lg"
            >
              <span className="font-mono text-[11px] text-[#9E978E]">
                Resumed at <strong className="text-[#F2EFE9]">{formatClock(resumedBannerSeconds)}</strong>
              </span>
              <span className="text-[#68625A]">·</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearVideoProgress(fileId);
                  setResumedBannerSeconds(null);
                  seekToTargetSeconds(0, true);
                }}
                className="text-[11px] font-semibold text-[#D97757] hover:underline cursor-pointer"
              >
                Start Over
              </button>
            </div>
          )}

          {/* Minimal, Unobtrusive Circular Ring Spinner (Debounced, no screen darkening or text box) */}
          {showSpinner && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full border-2 border-white/20 border-t-[#D97757] animate-spin" />
          )}
        </div>

        {/* ====================================================================
            MULTI-QUALITY STREAM SELECTOR MENU (Auto, 1080p, 720p, 480p, 360p)
        ==================================================================== */}
        {showQualityMenu && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-14 right-3 sm:right-20 z-30 w-52 max-w-[calc(100vw-24px)] bg-[#141311]/95 border border-[#2C2824] text-[#F2EFE9] shadow-2xl py-1 max-h-60 overflow-y-auto"
          >
            <div className="px-3 py-1.5 text-[11px] font-semibold text-[#9E978E] border-b border-[#2C2824] flex items-center justify-between">
              <span>Video Quality</span>
              <span className="text-[10px] font-mono text-[#D97757]">{selectedQuality}</span>
            </div>
            {availableQualities.map((q) => {
              const active = selectedQuality === q;
              const meta = QUALITY_LABELS[q] || { title: q };
              return (
                <button
                  key={q}
                  type="button"
                  onClick={() => handleSelectQuality(q)}
                  className={`w-full px-3 py-2 text-xs flex items-center justify-between cursor-pointer transition-colors ${
                    active
                      ? 'bg-[#24211D] text-[#D97757] font-semibold'
                      : 'text-[#F2EFE9] hover:bg-[#1C1A17]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{meta.title}</span>
                    {meta.badge && (
                      <span className="px-1 py-0.2 text-[9px] font-mono font-bold bg-[#D97757]/20 text-[#D97757] border border-[#D97757]/40">
                        {meta.badge}
                      </span>
                    )}
                  </div>
                  {active && <Check className="w-3.5 h-3.5 text-[#D97757] shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {/* ====================================================================
            MULTI-AUDIO TRACK SELECTOR MENU (Only rendered if >1 audio track)
        ==================================================================== */}
        {showAudioMenu && audioTracks.length > 1 && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-14 right-3 sm:right-28 z-30 w-56 max-w-[calc(100vw-24px)] bg-[#141311]/95 border border-[#2C2824] text-[#F2EFE9] shadow-2xl py-1 max-h-60 overflow-y-auto"
          >
            <div className="px-3 py-1.5 text-[11px] font-semibold text-[#9E978E] border-b border-[#2C2824] flex items-center justify-between">
              <span>Multi-Audio Track ({audioTracks.length})</span>
            </div>
            {audioTracks.map((track) => {
              const active = activeAudioIndex === track.index;
              return (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => handleSelectAudioTrack(track.index)}
                  className={`w-full px-3 py-2 text-xs flex items-center justify-between cursor-pointer transition-colors ${
                    active
                      ? 'bg-[#24211D] text-[#D97757] font-semibold'
                      : 'text-[#F2EFE9] hover:bg-[#1C1A17]'
                  }`}
                >
                  <span className="truncate">{track.label}</span>
                  {active && <Check className="w-3.5 h-3.5 text-[#D97757] shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {/* ====================================================================
            CC / SUBTITLES MENU
        ==================================================================== */}
        {showCcMenu && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-14 right-3 sm:right-5 z-30 w-56 max-w-[calc(100vw-24px)] bg-[#141311]/95 border border-[#2C2824] text-[#F2EFE9] shadow-2xl py-1 max-h-60 overflow-y-auto"
          >
            <div className="px-3 py-1.5 text-[11px] font-semibold text-[#9E978E] border-b border-[#2C2824] flex items-center justify-between">
              <span>Subtitles / CC</span>
              <button
                type="button"
                onClick={() => subtitleInputRef.current?.click()}
                className="text-[11px] text-[#D97757] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Upload className="w-3 h-3" />
                <span>Load .SRT/.VTT</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleSelectSubtitle(null)}
              className={`w-full px-3 py-2 text-xs flex items-center justify-between cursor-pointer transition-colors ${
                activeSubtitleId === null
                  ? 'bg-[#24211D] text-[#D97757] font-semibold'
                  : 'text-[#F2EFE9] hover:bg-[#1C1A17]'
              }`}
            >
              <span>Off</span>
              {activeSubtitleId === null && <Check className="w-3.5 h-3.5 text-[#D97757]" />}
            </button>

            {subtitleTracks.map((track) => {
              const active = activeSubtitleId === track.id;
              return (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => handleSelectSubtitle(track.id)}
                  className={`w-full px-3 py-2 text-xs flex items-center justify-between cursor-pointer transition-colors ${
                    active
                      ? 'bg-[#24211D] text-[#D97757] font-semibold'
                      : 'text-[#F2EFE9] hover:bg-[#1C1A17]'
                  }`}
                >
                  <span className="truncate">{track.label}</span>
                  {active && <Check className="w-3.5 h-3.5 text-[#D97757] shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {/* ====================================================================
            RESPONSIVE BOTTOM CONTROL BAR
            (Play/Pause, -10s, +10s, Volume, Multi-Audio [if >1], Multi-Quality [Auto], CC, PiP, Fullscreen)
        ==================================================================== */}
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-2.5 sm:px-4 pt-6 pb-2 sm:pb-2.5 space-y-1.5 sm:space-y-2 transition-opacity duration-200 ${
            controlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Timeline Scrubber with Preload Buffer Bar */}
          <div
            ref={timelineRef}
            onMouseMove={handleTimelineMouseMove}
            onMouseLeave={handleTimelineMouseLeave}
            className="relative w-full h-4 flex items-center group/scrub cursor-pointer"
          >
            {hoverPct !== null && hoverTime !== null && effectiveDuration > 0 && (
              <div
                style={{ left: `${Math.max(4, Math.min(96, hoverPct))}%` }}
                className="pointer-events-none absolute -top-6 -translate-x-1/2 px-1.5 py-0.5 bg-black/90 border border-white/15 text-white text-[11px] font-mono tabular-nums whitespace-nowrap"
              >
                {formatClock(hoverTime)}
              </div>
            )}

            <div className="w-full h-1 group-hover/scrub:h-1.5 bg-white/20 relative overflow-hidden transition-all">
              {/* Preload / Buffered Progress */}
              <div
                style={{ width: `${bufferedPct}%` }}
                className="absolute left-0 top-0 bottom-0 bg-white/40 transition-all duration-150"
              />
              {/* Played Progress */}
              <div
                style={{ width: `${progressPct}%` }}
                className="absolute left-0 top-0 bottom-0 bg-[#D97757]"
              />
            </div>

            <div
              style={{ left: `${progressPct}%` }}
              className={`pointer-events-none absolute -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-[#D97757] shadow transition-transform ${
                isScrubbing ? 'scale-110' : 'scale-0 group-hover/scrub:scale-100'
              }`}
            />

            <input
              type="range"
              min={0}
              max={effectiveDuration || 100}
              step={0.1}
              value={displayedCurrentTime}
              onPointerDown={handleScrubStart}
              onTouchStart={handleScrubStart}
              onChange={handleScrubChange}
              onPointerUp={handleScrubEnd}
              onTouchEnd={handleScrubEnd}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              aria-label="Seek video timeline"
            />
          </div>

          {/* Controls Row (Free / Responsive Wrap Layout for Any Device) */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-white">
            {/* Left Controls: Play/Pause, Prev 10s, Next 10s, Volume, Time */}
            <div className="flex items-center gap-0.5 sm:gap-1.5 min-w-0">
              <button
                type="button"
                onClick={togglePlay}
                className="w-8 h-8 flex items-center justify-center text-white/90 hover:text-[#D97757] transition-colors cursor-pointer shrink-0"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current" />
                )}
              </button>

              <button
                type="button"
                onClick={() => handleSkip(-10)}
                className="px-1.5 h-8 flex items-center justify-center gap-0.5 text-white/90 hover:text-[#D97757] transition-colors cursor-pointer shrink-0"
                title="Previous 10 seconds (Left Arrow)"
                aria-label="Previous 10 seconds"
              >
                <RotateCcw className="w-4 h-4" />
                <span className="text-[10px] font-mono">10</span>
              </button>

              <button
                type="button"
                onClick={() => handleSkip(10)}
                className="px-1.5 h-8 flex items-center justify-center gap-0.5 text-white/90 hover:text-[#D97757] transition-colors cursor-pointer shrink-0"
                title="Next 10 seconds (Right Arrow)"
                aria-label="Next 10 seconds"
              >
                <RotateCw className="w-4 h-4" />
                <span className="text-[10px] font-mono">10</span>
              </button>

              {/* Volume */}
              <div className="flex items-center gap-1 ml-0.5 shrink-0">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="w-7 sm:w-8 h-8 flex items-center justify-center text-white/90 hover:text-[#D97757] transition-colors cursor-pointer"
                  title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-[#D94848]" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-12 sm:w-20 h-1 accent-[#D97757] cursor-pointer"
                  aria-label="Volume"
                />
              </div>

              {/* Time Display */}
              <div className="pl-1 text-[11px] sm:text-xs font-mono tabular-nums text-white/85 whitespace-nowrap">
                {formatClock(displayedCurrentTime)} <span className="text-white/35">/</span>{' '}
                {formatClock(effectiveDuration)}
              </div>
            </div>

            {/* Right Controls: Multi-Audio (ONLY if >1 track exists), Multi-Quality (Auto default), CC, Picture-in-Picture, Fullscreen */}
            <div className="flex items-center gap-1 sm:gap-1.5 ml-auto">
              {audioTracks.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowCcMenu(false);
                    setShowQualityMenu(false);
                    setShowAudioMenu((prev) => !prev);
                  }}
                  className={`h-7 sm:h-8 px-2 flex items-center justify-center gap-1 text-xs transition-colors cursor-pointer border ${
                    showAudioMenu
                      ? 'border-[#D97757] bg-[#24211D] text-[#D97757]'
                      : 'border-white/15 bg-black/50 text-white/90 hover:border-[#D97757] hover:text-[#D97757]'
                  }`}
                  title="Switch Audio Track"
                  aria-label="Switch Audio Track"
                >
                  <Headphones className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[10px] sm:text-[11px] font-semibold truncate max-w-[68px] sm:max-w-[84px]">
                    {activeAudioTrackObj
                      ? activeAudioTrackObj.label.split(' ')[0]
                      : `Audio (${audioTracks.length})`}
                  </span>
                </button>
              )}

              {/* Multi-Quality Selector Button (Defaults to Auto) */}
              <button
                type="button"
                onClick={() => {
                  setShowAudioMenu(false);
                  setShowCcMenu(false);
                  setShowQualityMenu((prev) => !prev);
                }}
                className={`h-7 sm:h-8 px-2 flex items-center justify-center gap-1 text-xs transition-colors cursor-pointer border ${
                  showQualityMenu
                    ? 'border-[#D97757] bg-[#24211D] text-[#D97757]'
                    : 'border-white/15 bg-black/50 text-white/90 hover:border-[#D97757] hover:text-[#D97757]'
                }`}
                title="Video Quality (Auto / 1080p / 720p / 480p / 360p)"
                aria-label="Video Quality"
              >
                <SlidersHorizontal className="w-3 h-3 shrink-0" />
                <span className="text-[10px] sm:text-[11px] font-mono font-bold">
                  {selectedQuality}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowAudioMenu(false);
                  setShowQualityMenu(false);
                  setShowCcMenu((prev) => !prev);
                }}
                className={`w-7 sm:w-8 h-8 flex items-center justify-center transition-colors cursor-pointer ${
                  activeSubtitleId !== null || showCcMenu
                    ? 'text-[#D97757]'
                    : 'text-white/90 hover:text-[#D97757]'
                }`}
                title="Subtitles / CC"
                aria-label="Subtitles / CC"
              >
                <Subtitles className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={togglePictureInPicture}
                className={`w-7 sm:w-8 h-8 flex items-center justify-center transition-colors cursor-pointer ${
                  isPip ? 'text-[#D97757]' : 'text-white/90 hover:text-[#D97757]'
                }`}
                title="Picture in Picture (P)"
                aria-label="Picture in Picture"
              >
                <PictureInPicture2 className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                className="w-7 sm:w-8 h-8 flex items-center justify-center text-white/90 hover:text-[#D97757] transition-colors cursor-pointer"
                title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
                aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? (
                  <Minimize className="w-4 h-4" />
                ) : (
                  <Maximize className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
