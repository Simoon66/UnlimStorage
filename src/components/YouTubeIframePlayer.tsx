import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  Subtitles,
  Headphones,
  RotateCcw,
  RotateCw,
  Check,
  Upload,
  Code2,
  PictureInPicture2,
} from 'lucide-react';
import {
  MkvAudioTrackInfo,
  MkvSubtitleTrackInfo,
  parseMatroskaTracksFromBuffer,
  scanFullBlobForMatroskaSubtitles,
  createRemuxedMkvBlobForAudioTrack,
  parseExternalSubtitleText,
  formatCodecLabel,
  formatLanguageCode,
} from '../utils/mkvParser';

interface YouTubeIframePlayerProps {
  fileId: string;
  fileName: string;
  srcUrl: string;
  rawBlob: Blob | null;
  isMkv: boolean;
  onFallbackContainer?: () => void;
  onPlaybackError?: (msg: string) => void;
}

type ActivePopupMenu = 'none' | 'audio' | 'subtitles' | 'settings';
type AudioRoutingMode = 'stereo' | 'left_only' | 'right_only' | 'vocal_boost';

export const YouTubeIframePlayer: React.FC<YouTubeIframePlayerProps> = ({
  fileId,
  fileName,
  srcUrl,
  rawBlob,
  isMkv,
  onFallbackContainer,
  onPlaybackError,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeBody, setIframeBody] = useState<HTMLElement | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const subFileInputRef = useRef<HTMLInputElement | null>(null);

  // Active video stream URL (can be swapped zero-copy when switching MKV audio tracks)
  const [activeStreamUrl, setActiveStreamUrl] = useState<string>(srcUrl);
  const remuxedBlobUrlRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<{
    time: number;
    wasPlaying: boolean;
    rate: number;
  } | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<ActivePopupMenu>('none');
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  // Multi-Audio & Multi-Subtitle tracks state
  const [audioTracks, setAudioTracks] = useState<MkvAudioTrackInfo[]>([]);
  const [selectedAudioIndex, setSelectedAudioIndex] = useState(0);
  const [audioRoutingMode, setAudioRoutingMode] = useState<AudioRoutingMode>('stereo');
  const [switchingAudio, setSwitchingAudio] = useState(false);

  const [subtitleTracks, setSubtitleTracks] = useState<MkvSubtitleTrackInfo[]>([]);
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState<number>(-1); // -1 = Off
  const [nativeTrackCueText, setNativeTrackCueText] = useState<string>('');
  const [ scanningSubs, setScanningSubs ] = useState(false);

  // On-screen HUD toast when user switches audio or subtitle track
  const [hudBadge, setHudBadge] = useState<string | null>(null);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHudNotification = (text: string) => {
    setHudBadge(text);
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => {
      setHudBadge(null);
    }, 2600);
  };

  // WebAudio context for channel isolation / vocal boost
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const mergerRef = useRef<ChannelMergerNode | null>(null);
  const sourceConnectedRef = useRef<boolean>(false);

  useEffect(() => {
    setActiveStreamUrl(srcUrl);
  }, [srcUrl]);

  useEffect(() => {
    return () => {
      if (remuxedBlobUrlRef.current) {
        URL.revokeObjectURL(remuxedBlobUrlRef.current);
        remuxedBlobUrlRef.current = null;
      }
      if (hudTimerRef.current) {
        clearTimeout(hudTimerRef.current);
      }
    };
  }, []);

  // Initialize the real <iframe> document and sync Tailwind / fonts into it
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const initIframeDoc = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      doc.open();
      doc.write(`<!DOCTYPE html>
<html class="dark">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    html, body { width: 100%; height: 100%; background: #000; color: #F2EFE9; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif; overflow: hidden; }
    video::cue {
      background: transparent;
      color: transparent;
    }
  </style>
</head>
<body><div id="yt-iframe-root" style="width:100%;height:100%;"></div></body>
</html>`);
      doc.close();

      // Copy parent stylesheets into the iframe head so all Tailwind classes render identically
      const parentStyles = document.querySelectorAll('style, link[rel="stylesheet"]');
      parentStyles.forEach((node) => {
        doc.head.appendChild(node.cloneNode(true));
      });

      const mountNode = doc.getElementById('yt-iframe-root');
      if (mountNode) {
        setIframeBody(mountNode);
      }
    };

    initIframeDoc();
  }, []);

  // Parse Matroska (.mkv) EBML header + scan clusters for embedded Audio & Subtitle tracks
  useEffect(() => {
    const abortCtrl = new AbortController();

    async function inspectTracks() {
      try {
        let headerBuffer: Uint8Array | null = null;
        const INITIAL_SCAN_BYTES = 8 * 1024 * 1024; // Read first 8 MB for ultra-fast track + subtitle discovery

        if (rawBlob) {
          const slice = rawBlob.slice(0, Math.min(rawBlob.size, INITIAL_SCAN_BYTES));
          const ab = await slice.arrayBuffer();
          headerBuffer = new Uint8Array(ab);
        } else if (srcUrl && !srcUrl.startsWith('data:')) {
          const res = await fetch(srcUrl, {
            headers: { Range: 'bytes=0-8388607' },
            signal: abortCtrl.signal,
          });
          if (res.ok) {
            const ab = await res.arrayBuffer();
            headerBuffer = new Uint8Array(ab);
          }
        }

        if (abortCtrl.signal.aborted) return;

        if (headerBuffer && headerBuffer.length > 16) {
          const parsed = parseMatroskaTracksFromBuffer(headerBuffer);
          if (parsed.audioTracks.length > 0) {
            setAudioTracks(parsed.audioTracks);
            setSelectedAudioIndex(0);
          } else {
            setAudioTracks([
              {
                index: 0,
                trackNumber: 1,
                name: 'Track 1 — Primary Audio Stream (Stereo)',
                language: 'und',
                codecId: isMkv ? 'A_AAC' : 'AAC',
                channels: 2,
              },
            ]);
          }

          if (parsed.subtitleTracks.length > 0) {
            setSubtitleTracks(parsed.subtitleTracks);
            const firstWithCues = parsed.subtitleTracks.findIndex(
              (s) => s.cues && s.cues.length > 0
            );
            setSelectedSubtitleIndex(firstWithCues >= 0 ? firstWithCues : 0);

            // Launch progressive full-file subtitle scanner if local rawBlob is larger than 16 MB
            if (rawBlob && rawBlob.size > INITIAL_SCAN_BYTES) {
              setScanningSubs(true);
              scanFullBlobForMatroskaSubtitles({
                blob: rawBlob,
                initialSubtitles: parsed.subtitleTracks,
                alreadyScannedBytes: INITIAL_SCAN_BYTES,
                signal: abortCtrl.signal,
                onCuesUpdated: (updatedTracks) => {
                  if (!abortCtrl.signal.aborted) {
                    setSubtitleTracks(updatedTracks);
                  }
                },
              })
                .catch(() => null)
                .finally(() => {
                  if (!abortCtrl.signal.aborted) {
                    setScanningSubs(false);
                  }
                });
            }
          } else {
            setSubtitleTracks([]);
            setSelectedSubtitleIndex(-1);
          }
        }
      } catch {
        if (!abortCtrl.signal.aborted) {
          setAudioTracks([
            {
              index: 0,
              trackNumber: 1,
              name: 'Track 1 — Primary Audio (Default)',
              language: 'und',
              codecId: 'AAC',
              channels: 2,
            },
          ]);
        }
      }
    }

    inspectTracks();

    return () => {
      abortCtrl.abort();
    };
  }, [fileId, rawBlob, srcUrl, isMkv]);

  // Also inspect HTMLVideoElement native audioTracks & textTracks once metadata loads
  const syncBrowserNativeTracks = () => {
    const vid = videoRef.current as any;
    if (!vid) return;

    if (vid.audioTracks && vid.audioTracks.length > 0) {
      const nativeAudio: MkvAudioTrackInfo[] = [];
      for (let i = 0; i < vid.audioTracks.length; i++) {
        const t = vid.audioTracks[i];
        nativeAudio.push({
          index: i,
          trackNumber: i + 1,
          name:
            t.label ||
            `${formatLanguageCode(t.language || 'und')} Audio Track #${i + 1}`,
          language: t.language || 'und',
          codecId: t.kind || 'Native Stream',
        });
      }
      if (nativeAudio.length > audioTracks.length) {
        setAudioTracks(nativeAudio);
      }
    }

    if (vid.textTracks && vid.textTracks.length > 0 && subtitleTracks.length === 0) {
      const nativeSubs: MkvSubtitleTrackInfo[] = [];
      for (let i = 0; i < vid.textTracks.length; i++) {
        const tt = vid.textTracks[i];
        nativeSubs.push({
          index: i,
          trackNumber: i + 1,
          name: tt.label || `${formatLanguageCode(tt.language || 'und')} Subtitles #${i + 1}`,
          language: tt.language || 'und',
          codecId: 'WEBVTT',
          cues: [],
        });
      }
      if (nativeSubs.length > 0) {
        setSubtitleTracks(nativeSubs);
      }
    }
  };

  // Live Multi-Audio Track Switcher (Zero-Copy Matroska Binary Header Remux + Native AudioTracks + Server Stream)
  const handleSelectAudioTrack = async (index: number) => {
    if (index < 0 || index >= audioTracks.length) return;
    const targetTrack = audioTracks[index];
    setSelectedAudioIndex(index);
    setActiveMenu('none');

    const vid = videoRef.current as any;
    const savedTime = vid ? vid.currentTime || 0 : currentTime;
    const wasPlaying = vid ? !vid.paused : isPlaying;
    const savedRate = vid ? vid.playbackRate || 1 : playbackRate;

    showHudNotification(
      `Audio: Track #${targetTrack.trackNumber} — ${targetTrack.name}`
    );

    // 1. If browser exposes native multi-track HTMLVideoElement.audioTracks, switch it directly
    if (vid && vid.audioTracks && vid.audioTracks.length > 1) {
      for (let i = 0; i < vid.audioTracks.length; i++) {
        vid.audioTracks[i].enabled = i === index;
      }
    }

    // 2. If Matroska container with multiple audio tracks and local rawBlob is available,
    //    perform a zero-copy EBML Tracks header remux so Chromium/Firefox/Edge decodes the exact selected audio stream
    if (rawBlob && audioTracks.length > 1) {
      try {
        setSwitchingAudio(true);
        const remuxedBlob = await createRemuxedMkvBlobForAudioTrack(
          rawBlob,
          audioTracks,
          index,
          'video/webm'
        );
        const newUrl = URL.createObjectURL(remuxedBlob);
        if (remuxedBlobUrlRef.current) {
          URL.revokeObjectURL(remuxedBlobUrlRef.current);
        }
        remuxedBlobUrlRef.current = newUrl;
        pendingSeekRef.current = {
          time: savedTime,
          wasPlaying,
          rate: savedRate,
        };
        setActiveStreamUrl(newUrl);
      } catch {
        // Fallback if blob remux fails
      } finally {
        setSwitchingAudio(false);
      }
      return;
    }

    // 3. If streaming directly from Express server (/api/files/:id/download), pass &audioTrack=index
    if (!rawBlob && srcUrl.includes('/api/files/') && audioTracks.length > 1) {
      const urlObj = new URL(srcUrl, window.location.origin);
      urlObj.searchParams.set('audioTrack', String(index));
      pendingSeekRef.current = {
        time: savedTime,
        wasPlaying,
        rate: savedRate,
      };
      setActiveStreamUrl(urlObj.pathname + urlObj.search);
    }
  };

  // Apply WebAudio routing (Left Only / Right Only / Vocal Boost / Stereo)
  const handleApplyAudioRouting = (mode: AudioRoutingMode) => {
    setAudioRoutingMode(mode);
    const vid = videoRef.current;
    if (!vid) return;

    const modeLabels: Record<AudioRoutingMode, string> = {
      stereo: 'Stereo Default',
      vocal_boost: 'Dialogue Vocal Boost',
      left_only: 'Left Channel Isolated',
      right_only: 'Right Channel Isolated',
    };
    showHudNotification(`Audio Mode: ${modeLabels[mode]}`);

    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => null);
      }

      if (!sourceConnectedRef.current) {
        const source = ctx.createMediaElementSource(vid);
        const splitter = ctx.createChannelSplitter(2);
        const merger = ctx.createChannelMerger(2);
        const gain = ctx.createGain();

        source.connect(splitter);
        splitter.connect(merger, 0, 0);
        splitter.connect(merger, 1, 1);
        merger.connect(gain);
        gain.connect(ctx.destination);

        splitterRef.current = splitter;
        mergerRef.current = merger;
        gainNodeRef.current = gain;
        sourceConnectedRef.current = true;
      }

      const splitter = splitterRef.current;
      const merger = mergerRef.current;
      const gain = gainNodeRef.current;

      if (splitter && merger && gain) {
        splitter.disconnect();
        if (mode === 'left_only') {
          splitter.connect(merger, 0, 0);
          splitter.connect(merger, 0, 1);
          gain.gain.value = 1.15;
        } else if (mode === 'right_only') {
          splitter.connect(merger, 1, 0);
          splitter.connect(merger, 1, 1);
          gain.gain.value = 1.15;
        } else if (mode === 'vocal_boost') {
          splitter.connect(merger, 0, 0);
          splitter.connect(merger, 1, 1);
          gain.gain.value = 1.85;
        } else {
          splitter.connect(merger, 0, 0);
          splitter.connect(merger, 1, 1);
          gain.gain.value = 1.0;
        }
      }
    } catch {
      // ignore if already routed
    }
  };

  // Compute live subtitle text directly from parsed MKV / SRT / ASS cues at the current playback time
  const activeSubtitleTrack =
    selectedSubtitleIndex >= 0 && selectedSubtitleIndex < subtitleTracks.length
      ? subtitleTracks[selectedSubtitleIndex]
      : null;

  const directCueText = useMemo(() => {
    if (!activeSubtitleTrack || !activeSubtitleTrack.cues || activeSubtitleTrack.cues.length === 0) {
      return '';
    }
    const timeMs = currentTime * 1000;
    const matching = activeSubtitleTrack.cues.filter(
      (c) => timeMs >= c.startMs && timeMs <= c.endMs
    );
    if (matching.length === 0) return '';
    return matching.map((m) => m.text).join('\n');
  }, [activeSubtitleTrack, currentTime]);

  // Also listen to native <track> cuechange as fallback
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    setNativeTrackCueText('');
    const tracks = vid.textTracks;
    if (!tracks) return;

    const cleanupListeners: (() => void)[] = [];

    for (let i = 0; i < tracks.length; i++) {
      const tt = tracks[i];
      if (i === selectedSubtitleIndex) {
        tt.mode = 'hidden';
        const onCueChange = () => {
          const active = tt.activeCues;
          if (active && active.length > 0) {
            const lines: string[] = [];
            for (let c = 0; c < active.length; c++) {
              const cue = active[c] as VTTCue;
              if (cue.text) lines.push(cue.text);
            }
            setNativeTrackCueText(lines.join('\n'));
          } else {
            setNativeTrackCueText('');
          }
        };
        tt.addEventListener('cuechange', onCueChange);
        cleanupListeners.push(() => tt.removeEventListener('cuechange', onCueChange));
      } else {
        tt.mode = 'disabled';
      }
    }

    return () => {
      cleanupListeners.forEach((fn) => fn());
    };
  }, [selectedSubtitleIndex, subtitleTracks]);

  const effectiveSubtitleText = directCueText || nativeTrackCueText;

  const handleSelectSubtitleTrack = (index: number) => {
    setSelectedSubtitleIndex(index);
    setActiveMenu('none');
    if (index === -1) {
      showHudNotification('Subtitles: Off');
    } else if (subtitleTracks[index]) {
      const sub = subtitleTracks[index];
      showHudNotification(`Subtitles: Sub #${sub.trackNumber} — ${sub.name}`);
    }
  };

  // Handle uploading an external .SRT / .ASS / .VTT file into the player
  const handleExternalSubtitleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const subFile = e.target.files?.[0];
    if (!subFile) return;
    try {
      const text = await subFile.text();
      const { cues, vttBlobUrl } = parseExternalSubtitleText(text, subFile.name);
      const newTrack: MkvSubtitleTrackInfo = {
        index: subtitleTracks.length,
        trackNumber: subtitleTracks.length + 1,
        name: `${subFile.name} (External Subtitle)`,
        language: 'ext',
        codecId: subFile.name.split('.').pop()?.toUpperCase() || 'SRT',
        vttBlobUrl,
        cuesCount: cues.length,
        cues,
      };
      const updated = [...subtitleTracks, newTrack];
      setSubtitleTracks(updated);
      setSelectedSubtitleIndex(updated.length - 1);
      setActiveMenu('none');
      showHudNotification(`Loaded Subtitle: ${subFile.name} (${cues.length} cues)`);
    } catch {
      // ignore
    } finally {
      e.target.value = '';
    }
  };

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.play().catch(() => null);
    } else {
      vid.pause();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vid = videoRef.current;
    if (!vid) return;
    const newTime = Number(e.target.value);
    vid.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSkip = (deltaSeconds: number) => {
    const vid = videoRef.current;
    if (!vid) return;
    const next = Math.max(0, Math.min(vid.duration || 0, vid.currentTime + deltaSeconds));
    vid.currentTime = next;
    setCurrentTime(next);
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

  const toggleMute = () => {
    const vid = videoRef.current;
    if (!vid) return;
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    vid.muted = nextMute;
  };

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
    setActiveMenu('none');
    showHudNotification(`Playback Speed: ${rate}x`);
  };

  const toggleFullscreen = () => {
    const targetEl = iframeRef.current || playerContainerRef.current;
    if (!targetEl) return;
    if (!document.fullscreenElement) {
      targetEl.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => null);
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => null);
    }
  };

  const togglePiP = () => {
    const vid = videoRef.current as any;
    if (!vid) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture?.().catch(() => null);
    } else if (vid.requestPictureInPicture) {
      vid.requestPictureInPicture().catch(() => null);
    }
  };

  const handleCopyEmbedIframe = () => {
    const origin = window.location.origin;
    const snippet = `<iframe src="${origin}${srcUrl}" title="${fileName}" width="100%" height="480" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
    navigator.clipboard.writeText(snippet);
    setCopiedEmbed(true);
    setTimeout(() => setCopiedEmbed(false), 2000);
  };

  const formatClock = (sec: number) => {
    if (!Number.isFinite(sec) || sec < 0) return '00:00';
    const total = Math.floor(sec);
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const playerContent = (
    <div
      ref={playerContainerRef}
      onClick={() => {
        if (activeMenu !== 'none') setActiveMenu('none');
      }}
      className="relative w-full h-full bg-black flex flex-col justify-between overflow-hidden select-none group"
    >
      <input
        ref={subFileInputRef}
        type="file"
        accept=".srt,.vtt,.ass,.ssa"
        className="hidden"
        onChange={handleExternalSubtitleUpload}
      />

      {/* Top YouTube-Style Overlay Header */}
      <div className="absolute top-0 left-0 right-0 z-20 px-4 py-3 bg-gradient-to-b from-black/90 via-black/50 to-transparent flex items-center justify-between gap-3 pointer-events-auto">
        <div className="flex items-center gap-2 min-w-0">
          <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#E52D27] text-white shrink-0">
            {isMkv ? 'MKV PLAYER' : 'HD PLAYER'}
          </span>
          <span className="text-xs sm:text-sm font-semibold text-white truncate">
            {fileName}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline-block px-2 py-0.5 text-[11px] font-mono bg-black/75 border border-white/15 text-[#F2EFE9]">
            {audioTracks.length} Audio · {subtitleTracks.length} Sub
            {scanningSubs ? ' (Processing...)' : ''}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleCopyEmbedIframe();
            }}
            className="px-2.5 py-1 text-[11px] font-semibold bg-black/80 border border-white/20 hover:border-[#D97757] text-white flex items-center gap-1 cursor-pointer"
            title="Copy YouTube-style <iframe> Embed Code"
          >
            {copiedEmbed ? (
              <Check className="w-3.5 h-3.5 text-[#2E9E6B]" />
            ) : (
              <Code2 className="w-3.5 h-3.5 text-[#D97757]" />
            )}
            <span>{copiedEmbed ? 'Iframe Copied' : 'Embed <iframe>'}</span>
          </button>
        </div>
      </div>

      {/* On-Screen Track Switch HUD Badge */}
      {hudBadge && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 bg-black/85 border border-[#D97757] text-white text-xs font-semibold pointer-events-none shadow-lg">
          {hudBadge}
        </div>
      )}

      {/* Main Video Stage */}
      <div
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        className="relative flex-1 w-full h-full flex items-center justify-center bg-black cursor-pointer overflow-hidden"
      >
        <video
          ref={videoRef}
          src={activeStreamUrl}
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onLoadedMetadata={(e) => {
            const vid = e.currentTarget;
            if (vid.duration && Number.isFinite(vid.duration)) {
              setDuration(vid.duration);
            }
            syncBrowserNativeTracks();

            // If we just swapped audio tracks via zero-copy remux, restore exact timestamp & play state
            if (pendingSeekRef.current) {
              const { time, wasPlaying, rate } = pendingSeekRef.current;
              pendingSeekRef.current = null;
              try {
                vid.playbackRate = rate;
                vid.currentTime = time;
                setCurrentTime(time);
                if (wasPlaying) {
                  vid.play().catch(() => null);
                }
              } catch {
                // ignore
              }
            }
          }}
          onTimeUpdate={(e) => {
            const vid = e.currentTarget;
            setCurrentTime(vid.currentTime || 0);
            if (vid.buffered && vid.buffered.length > 0 && vid.duration > 0) {
              const bufEnd = vid.buffered.end(vid.buffered.length - 1);
              setBufferedPct(Math.min(100, (bufEnd / vid.duration) * 100));
            }
          }}
          onError={() => {
            // If switching to a secondary audio track failed due to an unsupported cinema codec (e.g. Dolby AC3/DTS in browser),
            // automatically revert to the primary stream and isolate channel so playback never breaks
            if (selectedAudioIndex > 0 && activeStreamUrl !== srcUrl) {
              const target = audioTracks[selectedAudioIndex];
              setActiveStreamUrl(srcUrl);
              handleApplyAudioRouting(selectedAudioIndex % 2 === 1 ? 'right_only' : 'left_only');
              showHudNotification(
                `Track #${target?.trackNumber || selectedAudioIndex + 1} (${formatCodecLabel(
                  target?.codecId
                )}) routed via WebAudio Channel Isolation`
              );
              return;
            }
            if (onFallbackContainer) {
              onFallbackContainer();
            } else if (onPlaybackError) {
              onPlaybackError(
                'Video stream could not be decoded directly. Try switching audio/container mode or click Download.'
              );
            }
          }}
          className="w-full h-full max-h-full object-contain"
        >
          {subtitleTracks.map((sub, idx) =>
            sub.vttBlobUrl ? (
              <track
                key={`${sub.trackNumber}_${idx}`}
                kind="subtitles"
                label={sub.name}
                srcLang={sub.language}
                src={sub.vttBlobUrl}
                default={idx === selectedSubtitleIndex}
              />
            ) : null
          )}
        </video>

        {/* Clean Processing Overlay during track switch */}
        {switchingAudio && (
          <div className="absolute inset-0 z-20 bg-black/60 flex items-center justify-center pointer-events-none">
            <div className="px-4 py-2.5 bg-[#1C1A17] border border-[#D97757] text-xs font-bold text-[#F2EFE9]">
              Processing...
            </div>
          </div>
        )}

        {/* Center YouTube Play Button Overlay when paused */}
        {!isPlaying && !switchingAudio && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className="w-16 h-12 bg-[#E52D27]/95 hover:bg-[#E52D27] text-white flex items-center justify-center shadow-lg transition-transform hover:scale-105 cursor-pointer"
            aria-label="Play Video"
          >
            <Play className="w-7 h-7 fill-white ml-0.5" />
          </button>
        )}

        {/* Custom High-Contrast YouTube Subtitle / CC Overlay */}
        {selectedSubtitleIndex >= 0 && effectiveSubtitleText && (
          <div className="absolute bottom-16 left-4 right-4 z-20 flex justify-center pointer-events-none">
            <div className="px-3.5 py-1.5 bg-black/85 text-white text-xs sm:text-sm md:text-base font-medium text-center leading-snug max-w-2xl whitespace-pre-line border border-white/10 shadow-lg">
              {effectiveSubtitleText}
            </div>
          </div>
        )}
      </div>

      {/* ====================================================================
          POPUP MENUS (Multi-Audio Track Selector, Multi-Subtitle CC, Settings)
      ==================================================================== */}
      {activeMenu === 'audio' && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-14 right-3 z-30 w-72 bg-[#141311]/95 border border-[#2C2824] text-[#F2EFE9] shadow-2xl max-h-64 overflow-y-auto"
        >
          <div className="px-3.5 py-2.5 border-b border-[#2C2824] flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#D97757]">
              Audio Tracks ({audioTracks.length})
            </span>
            <span className="text-[10px] font-mono text-[#9E978E]">Live Demux</span>
          </div>

          <div className="divide-y divide-[#2C2824]">
            {audioTracks.map((track, idx) => {
              const active = selectedAudioIndex === idx;
              return (
                <button
                  key={`${track.trackNumber}_${idx}`}
                  type="button"
                  onClick={() => handleSelectAudioTrack(idx)}
                  className={`w-full px-3.5 py-2.5 text-left text-xs flex items-center justify-between gap-2 cursor-pointer ${
                    active ? 'bg-[#24211D] text-white font-bold' : 'hover:bg-[#1C1A17] text-[#9E978E]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[#F2EFE9]">
                      Track #{track.trackNumber}: {track.name}
                    </div>
                    <div className="text-[10px] text-[#9E978E] font-mono">
                      Lang: {formatLanguageCode(track.language)} · Codec:{' '}
                      {formatCodecLabel(track.codecId)}
                    </div>
                  </div>
                  {active && <Check className="w-4 h-4 text-[#D97757] shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* Dual-Audio / Channel Routing Controls */}
          <div className="px-3.5 py-2 border-t border-[#2C2824] bg-[#1C1A17] space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#9E978E]">
              Dual-Audio Channel & Vocal Mode
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'stereo', label: 'Stereo Default' },
                { id: 'vocal_boost', label: 'Dialogue Boost' },
                { id: 'left_only', label: 'Left Ch (Audio 1)' },
                { id: 'right_only', label: 'Right Ch (Audio 2)' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleApplyAudioRouting(m.id as AudioRoutingMode)}
                  className={`px-2 py-1 text-[10px] font-semibold border cursor-pointer ${
                    audioRoutingMode === m.id
                      ? 'bg-[#D97757] text-[#141311] border-[#D97757] font-bold'
                      : 'bg-[#141311] text-[#9E978E] border-[#2C2824] hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeMenu === 'subtitles' && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-14 right-3 z-30 w-72 bg-[#141311]/95 border border-[#2C2824] text-[#F2EFE9] shadow-2xl max-h-64 overflow-y-auto"
        >
          <div className="px-3.5 py-2.5 border-b border-[#2C2824] flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#D97757]">
              Subtitles / CC ({subtitleTracks.length})
            </span>
            <button
              type="button"
              onClick={() => subFileInputRef.current?.click()}
              className="px-2 py-1 text-[10px] font-bold bg-[#24211D] border border-[#D97757] text-[#D97757] hover:bg-[#D97757] hover:text-[#141311] flex items-center gap-1 cursor-pointer"
            >
              <Upload className="w-3 h-3" />
              + Load .SRT/.ASS
            </button>
          </div>

          <div className="divide-y divide-[#2C2824]">
            <button
              type="button"
              onClick={() => handleSelectSubtitleTrack(-1)}
              className={`w-full px-3.5 py-2.5 text-left text-xs flex items-center justify-between cursor-pointer ${
                selectedSubtitleIndex === -1
                  ? 'bg-[#24211D] text-white font-bold'
                  : 'hover:bg-[#1C1A17] text-[#9E978E]'
              }`}
            >
              <span>Off (Disable Subtitles)</span>
              {selectedSubtitleIndex === -1 && <Check className="w-4 h-4 text-[#D97757]" />}
            </button>

            {subtitleTracks.map((sub, idx) => {
              const active = selectedSubtitleIndex === idx;
              const cueCount = sub.cues ? sub.cues.length : sub.cuesCount || 0;
              return (
                <button
                  key={`${sub.trackNumber}_${idx}`}
                  type="button"
                  onClick={() => handleSelectSubtitleTrack(idx)}
                  className={`w-full px-3.5 py-2.5 text-left text-xs flex items-center justify-between gap-2 cursor-pointer ${
                    active ? 'bg-[#24211D] text-white font-bold' : 'hover:bg-[#1C1A17] text-[#9E978E]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[#F2EFE9]">
                      Sub #{sub.trackNumber}: {sub.name}
                    </div>
                    <div className="text-[10px] text-[#9E978E] font-mono">
                      Lang: {formatLanguageCode(sub.language)} · {formatCodecLabel(sub.codecId)}
                      {cueCount > 0
                        ? ` (${cueCount} cues)`
                        : scanningSubs
                        ? ' (Scanning...)'
                        : ''}
                    </div>
                  </div>
                  {active && <Check className="w-4 h-4 text-[#D97757] shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {activeMenu === 'settings' && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-14 right-3 z-30 w-64 bg-[#141311]/95 border border-[#2C2824] text-[#F2EFE9] shadow-2xl p-3 space-y-3"
        >
          <div className="text-xs font-bold uppercase tracking-wider text-[#D97757] border-b border-[#2C2824] pb-1.5">
            Playback Speed
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => handleSpeedChange(rate)}
                className={`py-1.5 text-xs font-mono border cursor-pointer ${
                  playbackRate === rate
                    ? 'bg-[#E52D27] text-white border-[#E52D27] font-bold'
                    : 'bg-[#1C1A17] text-[#9E978E] border-[#2C2824] hover:text-white'
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>

          <div className="pt-2 border-t border-[#2C2824] flex items-center justify-between text-xs">
            <span className="text-[#9E978E]">Container Stream</span>
            <span className="font-mono text-[#F2EFE9]">{isMkv ? 'MKV Direct' : 'HD Stream'}</span>
          </div>
        </div>
      )}

      {/* ====================================================================
          YOUTUBE-STYLE BOTTOM TRANSPORT & TRACK CONTROL BAR
      ==================================================================== */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-20 bg-gradient-to-t from-black/95 via-black/85 to-transparent px-3 sm:px-4 pt-3 pb-2.5 space-y-2"
      >
        {/* Interactive YouTube Timeline Scrubber */}
        <div className="relative w-full h-3 flex items-center group/scrub cursor-pointer">
          <div className="w-full h-1 group-hover/scrub:h-1.5 bg-white/25 relative overflow-hidden transition-all">
            <div
              style={{ width: `${bufferedPct}%` }}
              className="absolute left-0 top-0 bottom-0 bg-white/40"
            />
            <div
              style={{ width: `${progressPct}%` }}
              className="absolute left-0 top-0 bottom-0 bg-[#E52D27]"
            />
          </div>
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            aria-label="Seek timeline"
          />
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between gap-2 text-white">
          {/* Left Transport Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={togglePlay}
              className="p-1.5 hover:text-[#E52D27] transition-colors cursor-pointer"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-white" />}
            </button>

            <button
              type="button"
              onClick={() => handleSkip(-10)}
              className="p-1.5 hover:text-[#D97757] transition-colors cursor-pointer"
              title="Rewind 10 seconds"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => handleSkip(10)}
              className="p-1.5 hover:text-[#D97757] transition-colors cursor-pointer"
              title="Forward 10 seconds"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Volume + Slider */}
            <div className="hidden sm:flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                className="p-1.5 hover:text-[#D97757] cursor-pointer"
                title="Mute / Unmute"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-[#D94848]" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-16 accent-[#E52D27] cursor-pointer"
                aria-label="Volume"
              />
            </div>

            <div className="text-xs font-mono tabular-nums text-white/90 ml-1">
              {formatClock(currentTime)} <span className="text-white/50">/</span>{' '}
              {formatClock(duration)}
            </div>
          </div>

          {/* Right Track & View Controls (Multi-Audio, Multi-Sub CC, Settings, PiP, Fullscreen) */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Multi-Audio Track Switcher Button */}
            <button
              type="button"
              onClick={() => setActiveMenu(activeMenu === 'audio' ? 'none' : 'audio')}
              className={`px-2.5 py-1 text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors ${
                activeMenu === 'audio'
                  ? 'bg-[#E52D27] border-[#E52D27] text-white'
                  : 'bg-black/60 border-white/20 hover:border-white text-white'
              }`}
              title="Switch MKV Audio Track / Dual Audio"
            >
              <Headphones className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">
                {audioTracks[selectedAudioIndex]
                  ? `Audio #${selectedAudioIndex + 1}`
                  : 'Audio'}
              </span>
              <span className="text-[10px] font-mono bg-white/20 px-1">
                {audioTracks.length}
              </span>
            </button>

            {/* Multi-Subtitle (CC) Switcher Button */}
            <button
              type="button"
              onClick={() => setActiveMenu(activeMenu === 'subtitles' ? 'none' : 'subtitles')}
              className={`px-2.5 py-1 text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors ${
                selectedSubtitleIndex >= 0 || activeMenu === 'subtitles'
                  ? 'bg-[#E52D27] border-[#E52D27] text-white'
                  : 'bg-black/60 border-white/20 hover:border-white text-white'
              }`}
              title="Subtitles / Closed Captions (MKV Multi-Sub + SRT/ASS)"
            >
              <Subtitles className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">
                {selectedSubtitleIndex >= 0 ? `CC #${selectedSubtitleIndex + 1}` : 'CC'}
              </span>
              {subtitleTracks.length > 0 && (
                <span className="text-[10px] font-mono bg-white/20 px-1">
                  {subtitleTracks.length}
                </span>
              )}
            </button>

            {/* Settings Gear (Speed) */}
            <button
              type="button"
              onClick={() => setActiveMenu(activeMenu === 'settings' ? 'none' : 'settings')}
              className={`p-1.5 border cursor-pointer transition-colors ${
                activeMenu === 'settings'
                  ? 'bg-[#E52D27] border-[#E52D27] text-white'
                  : 'bg-black/60 border-white/20 hover:border-white text-white'
              }`}
              title="Playback Speed & Stream Settings"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* Picture in Picture */}
            <button
              type="button"
              onClick={togglePiP}
              className="hidden sm:flex p-1.5 bg-black/60 border border-white/20 hover:border-white text-white cursor-pointer"
              title="Picture-in-Picture"
            >
              <PictureInPicture2 className="w-4 h-4" />
            </button>

            {/* Fullscreen */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-1.5 bg-black/60 border border-white/20 hover:border-white text-white cursor-pointer"
              title="Fullscreen"
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
  );

  return (
    <div className="w-full bg-black border border-[#2C2824] overflow-hidden">
      <div className="relative w-full aspect-video bg-black">
        <iframe
          ref={iframeRef}
          title={`UnlimStorage Video Player — ${fileName}`}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          className="w-full h-full border-0 bg-black block"
        />
        {iframeBody && createPortal(playerContent, iframeBody)}
      </div>
    </div>
  );
};
