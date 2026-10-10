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
  Loader2,
  Subtitles,
  Headphones,
  Check,
  Upload,
} from 'lucide-react';

interface YouTubeIframePlayerProps {
  fileId: string;
  fileName: string;
  srcUrl: string;
  rawBlob: Blob | null;
  isMkv: boolean;
  fullViewport?: boolean;
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

interface SubtitleTrackItem {
  id: string;
  label: string;
  language: string;
  srcUrl?: string;
  isEmbedded?: boolean;
  embeddedIndex?: number;
  serverSubIndex?: number;
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

/**
 * Converts SRT subtitle text into WebVTT format so native HTML5 <track> can render .srt files.
 */
function convertSrtToVtt(srtText: string): string {
  const normalized = srtText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${normalized}`;
}

/**
 * Lightweight client-side Matroska (EBML) TrackEntry header scanner fallback
 * in case the server ffprobe endpoint is unreachable.
 */
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

    // Scan for Matroska TrackEntry (0xAE) blocks in the first 256KB
    let i = 0;
    const limit = Math.min(bytes.length - 16, 262144);
    while (i < limit) {
      // Look for TrackType element 0x83 [size 0x81] [type: 1=video, 2=audio, 17=subtitle]
      if (bytes[i] === 0x83 && bytes[i + 1] === 0x81) {
        const trackType = bytes[i + 2];
        if (trackType === 2) {
          // Search nearby window for Language (0x22 0xB5 0x9C) or CodecID (0x86)
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
          const langLabel = ISO_LANG_LABELS[lang] || (lang ? lang.toUpperCase() : `Track ${idx + 1}`);
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
  onFallbackContainer,
  onPlaybackError,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoPlayAfterSwitchRef = useRef<boolean>(false);

  const isServerApiSource = Boolean(
    srcUrl && !srcUrl.startsWith('blob:') && !srcUrl.startsWith('data:')
  );

  // If the file is an MKV streamed from our server, immediately use the FFmpeg H.264/AAC stream
  // so 10-bit HEVC anime MKVs render crystal-clear video on frame 1 without a black screen!
  const [useServerTranscode, setUseServerTranscode] = useState<boolean>(
    () => Boolean(isMkv && isServerApiSource)
  );
  const [streamStartOffset, setStreamStartOffset] = useState<number>(0);
  const [probedDuration, setProbedDuration] = useState<number>(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [preloadStatusText, setPreloadStatusText] = useState<string>('Fast-Loading Video Stream...');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  // Scrubber hover time preview
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  // Multi-Audio tracks (only shown in UI if > 1 track exists on the video)
  const [audioTracks, setAudioTracks] = useState<AudioTrackItem[]>([]);
  const [activeAudioIndex, setActiveAudioIndex] = useState<number>(0);
  const [showAudioMenu, setShowAudioMenu] = useState(false);

  // CC / Subtitles tracks (embedded MKV tracks + native textTracks + user-loaded .vtt/.srt)
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrackItem[]>([]);
  const [activeSubtitleId, setActiveSubtitleId] = useState<string | null>(null);
  const [showCcMenu, setShowCcMenu] = useState(false);

  // Derive API endpoints for media-info, live FFmpeg H.264/AAC streaming, and WebVTT subtitle extraction
  const streamEndpoints = useMemo(() => {
    try {
      const parsed = new URL(srcUrl, window.location.origin);
      const shareMatch = parsed.pathname.match(/^\/api\/public\/share\/([^/]+)\/download/);
      const queryParams = new URLSearchParams(parsed.search);
      queryParams.delete('inline');
      const baseQuery = queryParams.toString();

      if (shareMatch) {
        const token = shareMatch[1];
        return {
          mediaInfoUrl: `/api/public/share/${token}/media-info${baseQuery ? `?${baseQuery}` : ''}`,
          streamBaseUrl: `/api/public/share/${token}/stream${baseQuery ? `?${baseQuery}` : ''}`,
          subtitlesBaseUrl: `/api/public/share/${token}/subtitles${baseQuery ? `?${baseQuery}` : ''}`,
        };
      }

      const encodedId = encodeURIComponent(fileId);
      return {
        mediaInfoUrl: `/api/files/${encodedId}/media-info${baseQuery ? `?${baseQuery}` : ''}`,
        streamBaseUrl: `/api/files/${encodedId}/stream${baseQuery ? `?${baseQuery}` : ''}`,
        subtitlesBaseUrl: `/api/files/${encodedId}/subtitles${baseQuery ? `?${baseQuery}` : ''}`,
      };
    } catch {
      const encodedId = encodeURIComponent(fileId);
      return {
        mediaInfoUrl: `/api/files/${encodedId}/media-info`,
        streamBaseUrl: `/api/files/${encodedId}/stream`,
        subtitlesBaseUrl: `/api/files/${encodedId}/subtitles`,
      };
    }
  }, [fileId, srcUrl]);

  // Compute the active <video src="..."> URL
  const activeVideoSrc = useMemo(() => {
    if (useServerTranscode && isServerApiSource) {
      const sep = streamEndpoints.streamBaseUrl.includes('?') ? '&' : '?';
      return `${streamEndpoints.streamBaseUrl}${sep}audio=${activeAudioIndex}&start=${streamStartOffset.toFixed(
        2
      )}`;
    }
    return srcUrl;
  }, [
    useServerTranscode,
    isServerApiSource,
    streamEndpoints.streamBaseUrl,
    activeAudioIndex,
    streamStartOffset,
    srcUrl,
  ]);

  // Probe server media-info (FFprobe) + fallback EBML header scan to detect Multi-Audio tracks, Subtitles & HEVC codec
  useEffect(() => {
    let cancelled = false;

    const inspectMedia = async () => {
      try {
        const res = await fetch(streamEndpoints.mediaInfoUrl);
        if (res.ok) {
          const info = (await res.json()) as ServerMediaInfoResponse;
          if (!cancelled && info && info.ok) {
            if (info.duration > 0) {
              setProbedDuration(info.duration);
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
                const customOnly = prev.filter((item) => item.serverSubIndex === undefined && !item.isEmbedded);
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

      // Client-side EBML / Matroska header inspection fallback
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

    void inspectMedia();

    return () => {
      cancelled = true;
    };
  }, [streamEndpoints.mediaInfoUrl, isMkv, isServerApiSource, rawBlob, srcUrl]);

  // Warmup / Preload initial byte range for non-transcoded direct streams
  useEffect(() => {
    if (!srcUrl || useServerTranscode || srcUrl.startsWith('blob:') || srcUrl.startsWith('data:')) {
      return;
    }
    const controller = new AbortController();
    fetch(srcUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-1048575' },
      signal: controller.signal,
    }).catch(() => null);
    return () => {
      controller.abort();
    };
  }, [srcUrl, useServerTranscode]);

  // Cleanup custom subtitle blob URLs on unmount
  useEffect(() => {
    return () => {
      subtitleTracks.forEach((t) => {
        if (t.srcUrl && t.srcUrl.startsWith('blob:')) {
          URL.revokeObjectURL(t.srcUrl);
        }
      });
    };
  }, [subtitleTracks]);

  const scheduleHideControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    if (isPlaying && !showAudioMenu && !showCcMenu) {
      hideControlsTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 2500);
    }
  }, [isPlaying, showAudioMenu, showCcMenu]);

  useEffect(() => {
    if (!isPlaying || showAudioMenu || showCcMenu) {
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
  }, [isPlaying, showAudioMenu, showCcMenu, scheduleHideControls]);

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

  // Inspect browser-native audioTracks / textTracks when metadata loads (if not already populated by FFprobe)
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
  const displayedCurrentTime = useServerTranscode
    ? Math.min(effectiveDuration || Infinity, streamStartOffset + currentTime)
    : currentTime;

  const seekToTargetSeconds = useCallback(
    (targetSec: number) => {
      const vid = videoRef.current;
      if (!vid) return;
      const maxDur = effectiveDuration || vid.duration || 0;
      const clampedTarget = maxDur > 0 ? Math.max(0, Math.min(maxDur, targetSec)) : Math.max(0, targetSec);

      if (useServerTranscode && isServerApiSource) {
        // Check if target is already within the currently buffered range of the active stream
        const localOffset = clampedTarget - streamStartOffset;
        let canSeekLocally = false;
        if (localOffset >= 0 && vid.buffered && vid.buffered.length > 0) {
          for (let i = 0; i < vid.buffered.length; i++) {
            if (
              localOffset >= vid.buffered.start(i) &&
              localOffset <= Math.max(0, vid.buffered.end(i) - 0.5)
            ) {
              canSeekLocally = true;
              break;
            }
          }
        }

        if (canSeekLocally) {
          vid.currentTime = localOffset;
          setCurrentTime(localOffset);
        } else {
          autoPlayAfterSwitchRef.current = !vid.paused || isPlaying;
          setIsBuffering(true);
          setPreloadStatusText(`Fast-Seeking to ${formatClock(clampedTarget)}...`);
          setStreamStartOffset(clampedTarget);
          setCurrentTime(0);
        }
      } else {
        vid.currentTime = clampedTarget;
        setCurrentTime(clampedTarget);
      }
      scheduleHideControls();
    },
    [effectiveDuration, useServerTranscode, isServerApiSource, streamStartOffset, isPlaying, scheduleHideControls]
  );

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

    // 1. If server FFmpeg streaming is available, switch the audio stream on the fly from current timestamp
    if (isServerApiSource) {
      const resumeAt = displayedCurrentTime;
      autoPlayAfterSwitchRef.current = true;
      setIsBuffering(true);
      setPreloadStatusText(
        `Switching Audio to ${selectedTrack?.label || `Track ${index + 1}`}...`
      );
      setUseServerTranscode(true);
      setStreamStartOffset(resumeAt);
      setCurrentTime(0);
      return;
    }

    // 2. Fallback to native browser HTMLMediaElement.audioTracks if supported
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
    const vid = videoRef.current;
    setActiveSubtitleId(trackId);
    setShowCcMenu(false);
    if (!vid) return;

    setTimeout(() => {
      const currentVid = videoRef.current;
      if (!currentVid || !currentVid.textTracks) return;
      const selected = subtitleTracks.find((t) => t.id === trackId);
      for (let i = 0; i < currentVid.textTracks.length; i++) {
        const tt = currentVid.textTracks[i];
        if (!trackId) {
          tt.mode = 'disabled';
        } else if (selected && tt.label === selected.label) {
          tt.mode = 'showing';
        } else {
          tt.mode = 'disabled';
        }
      }
    }, 60);
  };

  const handleUploadSubtitleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const rawText = await file.text();
      const isSrt = /\.srt$/i.test(file.name) || !rawText.trimStart().startsWith('WEBVTT');
      const vttContent = isSrt ? convertSrtToVtt(rawText) : rawText;
      const vttBlob = new Blob([vttContent], { type: 'text/vtt' });
      const blobUrl = URL.createObjectURL(vttBlob);

      const cleanLabel = file.name.replace(/\.(srt|vtt)$/i, '') || 'Custom CC';
      const newTrack: SubtitleTrackItem = {
        id: `custom_cc_${Date.now()}`,
        label: cleanLabel,
        language: 'en',
        srcUrl: blobUrl,
        isEmbedded: false,
      };

      setSubtitleTracks((prev) => [...prev, newTrack]);
      setActiveSubtitleId(newTrack.id);
      setShowCcMenu(false);

      setTimeout(() => {
        const vid = videoRef.current;
        if (!vid || !vid.textTracks) return;
        for (let i = 0; i < vid.textTracks.length; i++) {
          const tt = vid.textTracks[i];
          tt.mode = tt.label === newTrack.label ? 'showing' : 'disabled';
        }
      }, 80);
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
      seekToTargetSeconds(displayedCurrentTime + deltaSeconds);
    },
    [displayedCurrentTime, seekToTargetSeconds]
  );

  const handleSeekInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = Number(e.target.value);
    seekToTargetSeconds(newTime);
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
  }, [isMuted]);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
    const key = e.key.toLowerCase();
    if (key === ' ' || key === 'k') {
      e.preventDefault();
      togglePlay();
    } else if (key === 'arrowleft' || key === 'j') {
      e.preventDefault();
      handleSkip(-10);
    } else if (key === 'arrowright' || key === 'l') {
      e.preventDefault();
      handleSkip(10);
    } else if (key === 'm') {
      e.preventDefault();
      toggleMute();
    } else if (key === 'f') {
      e.preventDefault();
      toggleFullscreen();
    } else if (key === 'p') {
      e.preventDefault();
      void togglePictureInPicture();
    }
  };

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
        onKeyDown={handleKeyDown}
        onMouseMove={scheduleHideControls}
        onTouchStart={scheduleHideControls}
        onClick={() => {
          if (showAudioMenu) setShowAudioMenu(false);
          if (showCcMenu) setShowCcMenu(false);
        }}
        className={`relative w-full bg-black flex flex-col justify-between overflow-hidden select-none focus:outline-none ${
          fullViewport ? 'h-full' : 'aspect-video'
        }`}
      >
        {/* ====================================================================
            VIDEO STAGE (Fast Load, Auto Preload, Centered Play Button & Buffering Indicator)
        ==================================================================== */}
        <div
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
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
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              setIsPlaying(false);
              setControlsVisible(true);
            }}
            onWaiting={() => {
              setPreloadStatusText('Buffering HD Stream...');
              setIsBuffering(true);
            }}
            onPlaying={() => {
              setIsBuffering(false);
            }}
            onCanPlay={(e) => {
              setIsBuffering(false);
              const vid = e.currentTarget;
              vid.volume = volume;
              vid.muted = isMuted;
              if (autoPlayAfterSwitchRef.current) {
                autoPlayAfterSwitchRef.current = false;
                vid.play().catch(() => null);
              }
            }}
            onLoadedData={(e) => {
              const vid = e.currentTarget;
              // If browser opened a raw MKV/HEVC stream and decoded audio only (videoWidth === 0 -> black screen),
              // automatically switch to our server-side FFmpeg H.264/AAC stream!
              if (!useServerTranscode && isServerApiSource && vid.videoWidth === 0) {
                autoPlayAfterSwitchRef.current = !vid.paused;
                setPreloadStatusText('Optimizing MKV Video Stream...');
                setIsBuffering(true);
                setUseServerTranscode(true);
                return;
              }
              syncBrowserMediaTracks();
            }}
            onLoadedMetadata={(e) => {
              const vid = e.currentTarget;
              if (vid.duration && Number.isFinite(vid.duration) && vid.duration > 0) {
                setDuration(vid.duration);
              }
              if (!useServerTranscode && isServerApiSource && vid.videoWidth === 0) {
                autoPlayAfterSwitchRef.current = !vid.paused;
                setPreloadStatusText('Optimizing MKV Video Stream...');
                setIsBuffering(true);
                setUseServerTranscode(true);
                return;
              }
              syncBrowserMediaTracks();
              // Re-activate selected subtitle track if any
              if (activeSubtitleId && vid.textTracks) {
                const selected = subtitleTracks.find((t) => t.id === activeSubtitleId);
                for (let i = 0; i < vid.textTracks.length; i++) {
                  const tt = vid.textTracks[i];
                  tt.mode = selected && tt.label === selected.label ? 'showing' : 'disabled';
                }
              }
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
              setCurrentTime(vid.currentTime || 0);
              const maxDur = effectiveDuration || vid.duration || 0;
              if (vid.buffered && vid.buffered.length > 0 && maxDur > 0) {
                const bufEnd = streamStartOffset + vid.buffered.end(vid.buffered.length - 1);
                setBufferedPct(Math.min(100, (bufEnd / maxDur) * 100));
              }
            }}
            onError={() => {
              if (!useServerTranscode && isServerApiSource) {
                setPreloadStatusText('Starting MKV Stream Decoder...');
                setIsBuffering(true);
                setUseServerTranscode(true);
                return;
              }
              setIsBuffering(false);
              if (onFallbackContainer) {
                onFallbackContainer();
              } else if (onPlaybackError) {
                onPlaybackError(
                  'Video stream could not be decoded directly in the browser. Click Download below to watch locally.'
                );
              }
            }}
            className="w-full h-full max-h-full object-contain"
          >
            {subtitleTracks.map((t) => {
              const trackSrc =
                t.serverSubIndex !== undefined
                  ? `${streamEndpoints.subtitlesBaseUrl}${
                      streamEndpoints.subtitlesBaseUrl.includes('?') ? '&' : '?'
                    }subIndex=${t.serverSubIndex}&start=${streamStartOffset.toFixed(2)}`
                  : t.srcUrl;
              if (!trackSrc) return null;
              return (
                <track
                  key={`${t.id}_${streamStartOffset.toFixed(0)}`}
                  kind="subtitles"
                  label={t.label}
                  srcLang={t.language}
                  src={trackSrc}
                  default={activeSubtitleId === t.id}
                />
              );
            })}
          </video>

          {/* Center Play Button (Kept as first <button> child in video stage for Focus Mode & centered via absolute positioning) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-black/80 hover:bg-[#D97757] text-white hover:text-[#141311] border-2 border-white/30 hover:border-[#D97757] flex items-center justify-center transition-all duration-150 cursor-pointer shadow-2xl ${
              !isPlaying && !isBuffering
                ? 'opacity-100 scale-100 pointer-events-auto'
                : 'opacity-0 scale-90 pointer-events-none'
            }`}
            aria-label={fileName ? `Play ${fileName}` : 'Play Video'}
          >
            <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-current ml-1" />
          </button>

          {/* Visual Preloading / Fast-Loading & Buffering Indicator Overlay */}
          {isBuffering && (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/45 px-4">
              <div className="px-4 py-3 bg-[#141311]/95 border border-[#2C2824] flex flex-col items-center gap-2 shadow-2xl max-w-xs w-full">
                <div className="flex items-center gap-2.5">
                  <Loader2 className="w-5 h-5 text-[#D97757] animate-spin shrink-0" />
                  <span className="text-xs font-semibold text-[#F2EFE9] truncate">
                    {preloadStatusText}
                  </span>
                </div>
                <div className="w-full h-1 bg-[#2C2824] overflow-hidden">
                  <div
                    style={{ width: `${Math.max(18, Math.round(bufferedPct))}%` }}
                    className="h-full bg-[#D97757] animate-pulse transition-all duration-200"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ====================================================================
            MULTI-AUDIO TRACK SELECTOR MENU (Only rendered if >1 audio track)
        ==================================================================== */}
        {showAudioMenu && audioTracks.length > 1 && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-14 right-12 sm:right-16 z-30 w-56 bg-[#141311]/95 border border-[#2C2824] text-[#F2EFE9] shadow-2xl py-1 max-h-60 overflow-y-auto"
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
            className="absolute bottom-14 right-3 sm:right-5 z-30 w-56 bg-[#141311]/95 border border-[#2C2824] text-[#F2EFE9] shadow-2xl py-1 max-h-60 overflow-y-auto"
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
            MINIMALIST BOTTOM CONTROL BAR
            (Play/Pause, -10s, +10s, Volume, Multi-Audio [if available], CC, PiP, Fullscreen)
        ==================================================================== */}
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-3 sm:px-4 pt-6 pb-2.5 space-y-2 transition-opacity duration-200 ${
            controlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Timeline Scrubber with Preload Buffer Bar */}
          <div
            ref={timelineRef}
            onMouseMove={handleTimelineMouseMove}
            onMouseLeave={handleTimelineMouseLeave}
            className="relative w-full h-3.5 flex items-center group/scrub cursor-pointer"
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
              className="pointer-events-none absolute -translate-x-1/2 w-3 h-3 rounded-full bg-[#D97757] scale-0 group-hover/scrub:scale-100 transition-transform"
            />

            <input
              type="range"
              min={0}
              max={effectiveDuration || 100}
              step={0.1}
              value={displayedCurrentTime}
              onChange={handleSeekInput}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              aria-label="Seek video timeline"
            />
          </div>

          {/* Controls Row */}
          <div className="flex items-center justify-between gap-2 text-white">
            {/* Left Controls: Play/Pause, Prev 10s, Next 10s, Volume, Time */}
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={togglePlay}
                className="w-8 h-8 flex items-center justify-center text-white/90 hover:text-[#D97757] transition-colors cursor-pointer"
                title={isPlaying ? 'Pause' : 'Play'}
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
                className="px-1.5 h-8 flex items-center justify-center gap-0.5 text-white/90 hover:text-[#D97757] transition-colors cursor-pointer"
                title="Previous 10 seconds"
                aria-label="Previous 10 seconds"
              >
                <RotateCcw className="w-4 h-4" />
                <span className="text-[10px] font-mono">10</span>
              </button>

              <button
                type="button"
                onClick={() => handleSkip(10)}
                className="px-1.5 h-8 flex items-center justify-center gap-0.5 text-white/90 hover:text-[#D97757] transition-colors cursor-pointer"
                title="Next 10 seconds"
                aria-label="Next 10 seconds"
              >
                <RotateCw className="w-4 h-4" />
                <span className="text-[10px] font-mono">10</span>
              </button>

              {/* Volume */}
              <div className="flex items-center gap-1.5 ml-0.5">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="w-8 h-8 flex items-center justify-center text-white/90 hover:text-[#D97757] transition-colors cursor-pointer"
                  title={isMuted ? 'Unmute' : 'Mute'}
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
                  className="w-14 sm:w-20 h-1 accent-[#D97757] cursor-pointer"
                  aria-label="Volume"
                />
              </div>

              {/* Time Display */}
              <div className="pl-1.5 text-xs font-mono tabular-nums text-white/80 whitespace-nowrap">
                {formatClock(displayedCurrentTime)} <span className="text-white/35">/</span>{' '}
                {formatClock(effectiveDuration)}
              </div>
            </div>

            {/* Right Controls: Multi-Audio (ONLY if >1 track exists), CC, Picture-in-Picture, Fullscreen */}
            <div className="flex items-center gap-1 sm:gap-1.5">
              {audioTracks.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowCcMenu(false);
                    setShowAudioMenu((prev) => !prev);
                  }}
                  className={`h-8 px-2 flex items-center justify-center gap-1 text-xs transition-colors cursor-pointer border ${
                    showAudioMenu
                      ? 'border-[#D97757] bg-[#24211D] text-[#D97757]'
                      : 'border-white/15 bg-black/50 text-white/90 hover:border-[#D97757] hover:text-[#D97757]'
                  }`}
                  title="Switch Audio Track"
                  aria-label="Switch Audio Track"
                >
                  <Headphones className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[11px] font-semibold truncate max-w-[80px]">
                    {activeAudioTrackObj
                      ? activeAudioTrackObj.label.split(' ')[0]
                      : `Audio (${audioTracks.length})`}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowAudioMenu(false);
                  setShowCcMenu((prev) => !prev);
                }}
                className={`w-8 h-8 flex items-center justify-center transition-colors cursor-pointer ${
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
                className={`w-8 h-8 flex items-center justify-center transition-colors cursor-pointer ${
                  isPip ? 'text-[#D97757]' : 'text-white/90 hover:text-[#D97757]'
                }`}
                title="Picture in Picture"
                aria-label="Picture in Picture"
              >
                <PictureInPicture2 className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                className="w-8 h-8 flex items-center justify-center text-white/90 hover:text-[#D97757] transition-colors cursor-pointer"
                title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
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
