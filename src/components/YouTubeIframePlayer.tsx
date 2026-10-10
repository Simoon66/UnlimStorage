import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Check,
  Repeat,
  Camera,
  PictureInPicture2,
  Loader2,
  Sparkles,
  Keyboard,
  X,
  RefreshCw,
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

const SPEED_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

interface TransientIndicator {
  id: number;
  label: string;
  type: 'play' | 'pause' | 'rewind' | 'forward' | 'volume' | 'loop' | 'snapshot';
}

export const YouTubeIframePlayer: React.FC<YouTubeIframePlayerProps> = ({
  fileName,
  srcUrl,
  isMkv,
  fullViewport = false,
  onFallbackContainer,
  onPlaybackError,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isLooping, setIsLooping] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [showRemainingTime, setShowRemainingTime] = useState(false);
  const [videoResolution, setVideoResolution] = useState<string>('');

  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  // Scrubber hover preview state
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  // Center transient feedback badge
  const [indicator, setIndicator] = useState<TransientIndicator | null>(null);

  const triggerIndicator = useCallback(
    (label: string, type: TransientIndicator['type']) => {
      if (indicatorTimerRef.current) {
        clearTimeout(indicatorTimerRef.current);
      }
      setIndicator({ id: Date.now(), label, type });
      indicatorTimerRef.current = setTimeout(() => {
        setIndicator(null);
      }, 650);
    },
    []
  );

  const scheduleHideControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    if (isPlaying && !showSpeedMenu && !showShortcutsModal) {
      hideControlsTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 2600);
    }
  }, [isPlaying, showSpeedMenu, showShortcutsModal]);

  useEffect(() => {
    if (!isPlaying || showSpeedMenu || showShortcutsModal) {
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
  }, [isPlaying, showSpeedMenu, showShortcutsModal, scheduleHideControls]);

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
  }, [srcUrl]);

  const togglePlay = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused || vid.ended) {
      if (vid.ended) {
        vid.currentTime = 0;
      }
      vid.play().catch(() => null);
      triggerIndicator('Play', 'play');
    } else {
      vid.pause();
      triggerIndicator('Paused', 'pause');
    }
  }, [triggerIndicator]);

  const handleSkip = useCallback(
    (deltaSeconds: number) => {
      const vid = videoRef.current;
      if (!vid) return;
      const next = Math.max(0, Math.min(vid.duration || 0, vid.currentTime + deltaSeconds));
      vid.currentTime = next;
      setCurrentTime(next);
      triggerIndicator(
        deltaSeconds > 0 ? `+${deltaSeconds}s` : `${deltaSeconds}s`,
        deltaSeconds > 0 ? 'forward' : 'rewind'
      );
      scheduleHideControls();
    },
    [scheduleHideControls, triggerIndicator]
  );

  const handleSeekInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vid = videoRef.current;
    if (!vid) return;
    const newTime = Number(e.target.value);
    vid.currentTime = newTime;
    setCurrentTime(newTime);
    setIsEnded(false);
  };

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const bar = timelineRef.current;
    if (!bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const relX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const pct = (relX / Math.max(1, rect.width)) * 100;
    setHoverPct(pct);
    setHoverTime((pct / 100) * duration);
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

  const adjustVolumeBy = useCallback(
    (delta: number) => {
      const vid = videoRef.current;
      if (!vid) return;
      const nextVol = Math.max(0, Math.min(1, Number((volume + delta).toFixed(2))));
      setVolume(nextVol);
      setIsMuted(nextVol === 0);
      vid.volume = nextVol;
      vid.muted = nextVol === 0;
      triggerIndicator(`${Math.round(nextVol * 100)}%`, 'volume');
    },
    [volume, triggerIndicator]
  );

  const toggleMute = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    vid.muted = nextMute;
    triggerIndicator(nextMute ? 'Muted' : `${Math.round(volume * 100)}%`, 'volume');
  }, [isMuted, volume, triggerIndicator]);

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
    setShowSpeedMenu(false);
    triggerIndicator(`${rate}x Speed`, 'play');
  };

  const toggleLoop = useCallback(() => {
    const vid = videoRef.current;
    const next = !isLooping;
    setIsLooping(next);
    if (vid) {
      vid.loop = next;
    }
    triggerIndicator(next ? 'Loop On' : 'Loop Off', 'loop');
  }, [isLooping, triggerIndicator]);

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
      // PiP not supported on this device/stream
    }
  }, []);

  const captureVideoSnapshot = useCallback(() => {
    const vid = videoRef.current;
    if (!vid || !vid.videoWidth || !vid.videoHeight) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = vid.videoWidth;
      canvas.height = vid.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const cleanBase = (fileName || 'video').replace(/\.[^.]+$/, '');
        const stamp = Math.floor(vid.currentTime || 0);
        a.href = url;
        a.download = `${cleanBase}-frame-${stamp}s.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        triggerIndicator('Frame Saved', 'snapshot');
      }, 'image/png');
    } catch {
      // ignore CORS canvas taint if cross-origin
    }
  }, [fileName, triggerIndicator]);

  // Stage double-click: left 30% rewinds 10s, right 30% forwards 10s, middle 40% toggles fullscreen
  const handleStageDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = clickX / Math.max(1, rect.width);
    if (ratio < 0.3) {
      handleSkip(-10);
    } else if (ratio > 0.7) {
      handleSkip(10);
    } else {
      toggleFullscreen();
    }
  };

  // Keyboard shortcuts when player is focused or hovered
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      e.target instanceof HTMLInputElement &&
      e.target.type !== 'range'
    ) {
      return;
    }
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
    } else if (key === 'arrowup') {
      e.preventDefault();
      adjustVolumeBy(0.05);
    } else if (key === 'arrowdown') {
      e.preventDefault();
      adjustVolumeBy(-0.05);
    } else if (key === 'm') {
      e.preventDefault();
      toggleMute();
    } else if (key === 'f') {
      e.preventDefault();
      toggleFullscreen();
    } else if (key === 'p') {
      e.preventDefault();
      void togglePictureInPicture();
    } else if (key === 'r') {
      e.preventDefault();
      toggleLoop();
    } else if (key === '?') {
      e.preventDefault();
      setShowShortcutsModal((prev) => !prev);
    } else if (/^[0-9]$/.test(key) && duration > 0 && videoRef.current) {
      e.preventDefault();
      const digit = Number(key);
      const targetTime = (digit / 10) * duration;
      videoRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
    }
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
  const extBadge = (fileName.split('.').pop() || (isMkv ? 'MKV' : 'MP4')).toUpperCase().slice(0, 5);

  return (
    <div
      className={`w-full bg-[#0D0C0B] overflow-hidden ${
        fullViewport ? 'h-screen border-0' : 'border border-[#2C2824]'
      }`}
    >
      <div
        ref={playerContainerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onMouseMove={scheduleHideControls}
        onTouchStart={scheduleHideControls}
        onClick={() => {
          if (showSpeedMenu) setShowSpeedMenu(false);
        }}
        className={`relative w-full bg-[#0D0C0B] flex flex-col justify-between overflow-hidden select-none focus:outline-none group/player ${
          fullViewport ? 'h-full' : 'aspect-video'
        }`}
      >
        {/* ====================================================================
            TOP CLAUDE HUD BAR (Title, Format Badge, Resolution & Shortcuts)
        ==================================================================== */}
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/85 via-black/45 to-transparent px-3.5 sm:px-5 pt-3 pb-6 flex items-center justify-between gap-3 transition-opacity duration-200 ${
            controlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-2 h-2 rounded-full bg-[#D97757] shrink-0" />
            <span
              className="text-xs sm:text-sm font-semibold text-[#F2EFE9] truncate"
              title={fileName}
            >
              {fileName || 'Claude Cinema Player'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0 text-[11px] font-mono tabular-nums text-[#9E978E]">
            {videoResolution && (
              <>
                <span className="text-[#D97757] font-semibold">{videoResolution}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>{extBadge}</span>
            {playbackRate !== 1 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[#D97757] font-semibold">{playbackRate}x</span>
              </>
            )}
            <button
              type="button"
              onClick={() => setShowShortcutsModal((prev) => !prev)}
              className="ml-1 p-1.5 text-[#9E978E] hover:text-[#F2EFE9] hover:bg-white/10 transition-colors cursor-pointer"
              title="Keyboard Shortcuts (?)"
            >
              <Keyboard className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ====================================================================
            MAIN VIDEO STAGE
        ==================================================================== */}
        <div
          onClick={togglePlay}
          onDoubleClick={handleStageDoubleClick}
          className="relative flex-1 w-full h-full flex items-center justify-center bg-black cursor-pointer overflow-hidden"
        >
          <video
            ref={videoRef}
            src={srcUrl}
            playsInline
            preload="metadata"
            crossOrigin="anonymous"
            onPlay={() => {
              setIsPlaying(true);
              setIsEnded(false);
            }}
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              setIsPlaying(false);
              setIsEnded(true);
              setControlsVisible(true);
            }}
            onWaiting={() => setIsBuffering(true)}
            onPlaying={() => setIsBuffering(false)}
            onCanPlay={() => setIsBuffering(false)}
            onLoadedMetadata={(e) => {
              const vid = e.currentTarget;
              if (vid.duration && Number.isFinite(vid.duration)) {
                setDuration(vid.duration);
              }
              if (vid.videoHeight) {
                const h = vid.videoHeight;
                if (h >= 2160) setVideoResolution('4K');
                else if (h >= 1440) setVideoResolution('2K');
                else if (h >= 1080) setVideoResolution('1080p');
                else if (h >= 720) setVideoResolution('720p');
                else if (h >= 480) setVideoResolution('480p');
                else setVideoResolution(`${vid.videoWidth}×${vid.videoHeight}`);
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
              setIsBuffering(false);
              if (onFallbackContainer) {
                onFallbackContainer();
              } else if (onPlaybackError) {
                onPlaybackError(
                  'Video stream could not be decoded directly in the browser. Click Download below to watch locally.'
                );
              }
            }}
            className={`w-full h-full max-h-full transition-all duration-200 ${
              fitMode === 'cover' ? 'object-cover' : 'object-contain'
            }`}
          />

          {/* Buffering Spinner */}
          {isBuffering && isPlaying && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
              <div className="w-14 h-14 rounded-full bg-[#141311]/90 border border-[#D97757]/60 flex items-center justify-center shadow-2xl">
                <Loader2 className="w-6 h-6 text-[#D97757] animate-spin" />
              </div>
            </div>
          )}

          {/* Transient Action Feedback Badge (Play/Pause/+10s/-10s/Volume/Snapshot) */}
          {indicator && (
            <div
              key={indicator.id}
              className="pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 bg-[#141311]/95 border border-[#D97757]/70 text-[#F2EFE9] text-xs font-mono tabular-nums flex items-center gap-2 shadow-2xl"
            >
              {indicator.type === 'rewind' && <RotateCcw className="w-3.5 h-3.5 text-[#D97757]" />}
              {indicator.type === 'forward' && <RotateCw className="w-3.5 h-3.5 text-[#D97757]" />}
              {indicator.type === 'volume' && <Volume2 className="w-3.5 h-3.5 text-[#D97757]" />}
              {indicator.type === 'loop' && <Repeat className="w-3.5 h-3.5 text-[#D97757]" />}
              {indicator.type === 'snapshot' && <Camera className="w-3.5 h-3.5 text-[#D97757]" />}
              <span>{indicator.label}</span>
            </div>
          )}

          {/* Claude Signature Center Play / Replay Button when Paused */}
          {!isPlaying && !isBuffering && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="group/playbtn relative w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#141311]/90 hover:bg-[#D97757] text-[#F2EFE9] hover:text-[#141311] border-2 border-[#D97757] flex items-center justify-center shadow-[0_0_40px_rgba(217,119,87,0.35)] transition-all duration-150 hover:scale-105 cursor-pointer"
              aria-label={isEnded ? 'Replay Video' : 'Play Video'}
            >
              {isEnded ? (
                <RefreshCw className="w-7 h-7 sm:w-8 sm:h-8" />
              ) : (
                <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-current ml-1" />
              )}
            </button>
          )}
        </div>

        {/* ====================================================================
            KEYBOARD SHORTCUTS OVERLAY MODAL
        ==================================================================== */}
        {showShortcutsModal && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <div className="w-full max-w-sm bg-[#1C1A17] border border-[#2C2824] p-4 space-y-3 shadow-2xl">
              <div className="flex items-center justify-between border-b border-[#2C2824] pb-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-[#F2EFE9]">
                  <Keyboard className="w-4 h-4 text-[#D97757]" />
                  <span>Player Keyboard Shortcuts</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowShortcutsModal(false)}
                  className="text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div className="flex items-center justify-between text-[#9E978E]">
                  <span>Play / Pause</span>
                  <kbd className="px-1.5 py-0.5 bg-[#141311] border border-[#2C2824] text-[#F2EFE9] font-mono text-[10px]">
                    Space / K
                  </kbd>
                </div>
                <div className="flex items-center justify-between text-[#9E978E]">
                  <span>Fullscreen</span>
                  <kbd className="px-1.5 py-0.5 bg-[#141311] border border-[#2C2824] text-[#F2EFE9] font-mono text-[10px]">
                    F
                  </kbd>
                </div>
                <div className="flex items-center justify-between text-[#9E978E]">
                  <span>Rewind 10s</span>
                  <kbd className="px-1.5 py-0.5 bg-[#141311] border border-[#2C2824] text-[#F2EFE9] font-mono text-[10px]">
                    ← / J
                  </kbd>
                </div>
                <div className="flex items-center justify-between text-[#9E978E]">
                  <span>Forward 10s</span>
                  <kbd className="px-1.5 py-0.5 bg-[#141311] border border-[#2C2824] text-[#F2EFE9] font-mono text-[10px]">
                    → / L
                  </kbd>
                </div>
                <div className="flex items-center justify-between text-[#9E978E]">
                  <span>Volume</span>
                  <kbd className="px-1.5 py-0.5 bg-[#141311] border border-[#2C2824] text-[#F2EFE9] font-mono text-[10px]">
                    ↑ / ↓
                  </kbd>
                </div>
                <div className="flex items-center justify-between text-[#9E978E]">
                  <span>Mute</span>
                  <kbd className="px-1.5 py-0.5 bg-[#141311] border border-[#2C2824] text-[#F2EFE9] font-mono text-[10px]">
                    M
                  </kbd>
                </div>
                <div className="flex items-center justify-between text-[#9E978E]">
                  <span>Mini Player</span>
                  <kbd className="px-1.5 py-0.5 bg-[#141311] border border-[#2C2824] text-[#F2EFE9] font-mono text-[10px]">
                    P
                  </kbd>
                </div>
                <div className="flex items-center justify-between text-[#9E978E]">
                  <span>Loop Video</span>
                  <kbd className="px-1.5 py-0.5 bg-[#141311] border border-[#2C2824] text-[#F2EFE9] font-mono text-[10px]">
                    R
                  </kbd>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            PLAYBACK SPEED POPOVER MENU
        ==================================================================== */}
        {showSpeedMenu && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-16 right-3 sm:right-5 z-30 w-40 bg-[#141311]/95 backdrop-blur-md border border-[#2C2824] text-[#F2EFE9] shadow-2xl py-1"
          >
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#9E978E] border-b border-[#2C2824] flex items-center justify-between">
              <span>Playback Speed</span>
              <Sparkles className="w-3 h-3 text-[#D97757]" />
            </div>
            {SPEED_RATES.map((rate) => {
              const active = playbackRate === rate;
              return (
                <button
                  key={rate}
                  type="button"
                  onClick={() => handleSpeedChange(rate)}
                  className={`w-full px-3 py-1.5 text-xs font-mono tabular-nums flex items-center justify-between cursor-pointer transition-colors ${
                    active
                      ? 'bg-[#24211D] text-[#D97757] font-bold'
                      : 'text-[#F2EFE9] hover:bg-[#1C1A17]'
                  }`}
                >
                  <span>{rate === 1 ? '1.0x (Normal)' : `${rate}x`}</span>
                  {active && <Check className="w-3.5 h-3.5 text-[#D97757]" />}
                </button>
              );
            })}
          </div>
        )}

        {/* ====================================================================
            CLAUDE SIGNATURE BOTTOM CONTROL HUD
        ==================================================================== */}
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/95 via-black/80 to-transparent px-3 sm:px-5 pt-6 pb-3 space-y-2.5 transition-opacity duration-200 ${
            controlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Interactive Timeline Scrubber + Hover Timecode Tooltip */}
          <div
            ref={timelineRef}
            onMouseMove={handleTimelineMouseMove}
            onMouseLeave={handleTimelineMouseLeave}
            className="relative w-full h-4 flex items-center group/scrub cursor-pointer"
          >
            {/* Floating Hover Timecode Tooltip */}
            {hoverPct !== null && hoverTime !== null && duration > 0 && (
              <div
                style={{
                  left: `${Math.max(4, Math.min(96, hoverPct))}%`,
                }}
                className="pointer-events-none absolute -top-7 -translate-x-1/2 px-2 py-0.5 bg-[#141311] border border-[#D97757] text-[#F2EFE9] text-[11px] font-mono tabular-nums shadow-lg whitespace-nowrap"
              >
                {formatClock(hoverTime)}
              </div>
            )}

            {/* Track Background */}
            <div className="w-full h-1.5 group-hover/scrub:h-2 bg-white/20 relative overflow-hidden transition-all">
              {/* Buffered Segment */}
              <div
                style={{ width: `${bufferedPct}%` }}
                className="absolute left-0 top-0 bottom-0 bg-white/35 transition-all duration-150"
              />
              {/* Hover Preview Ghost Bar */}
              {hoverPct !== null && (
                <div
                  style={{ width: `${hoverPct}%` }}
                  className="absolute left-0 top-0 bottom-0 bg-white/25"
                />
              )}
              {/* Played Terracotta Progress Bar */}
              <div
                style={{ width: `${progressPct}%` }}
                className="absolute left-0 top-0 bottom-0 bg-[#D97757]"
              />
            </div>

            {/* Scrubber Thumb Handle */}
            <div
              style={{ left: `${progressPct}%` }}
              className="pointer-events-none absolute -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-[#D97757] border-2 border-[#F2EFE9] shadow-[0_0_10px_rgba(217,119,87,0.9)] scale-90 group-hover/scrub:scale-110 transition-transform"
            />

            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeekInput}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              aria-label="Seek video timeline"
            />
          </div>

          {/* Bottom Controls Transport Row */}
          <div className="flex items-center justify-between gap-2 text-[#F2EFE9]">
            {/* Left Group: Play/Pause, -10s, +10s, Volume Slider, Clickable Timecode */}
            <div className="flex items-center gap-1.5 sm:gap-2.5">
              <button
                type="button"
                onClick={togglePlay}
                className="w-8 h-8 flex items-center justify-center bg-[#1C1A17]/90 border border-[#2C2824] hover:border-[#D97757] hover:text-[#D97757] transition-colors cursor-pointer"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4" />
                ) : isEnded ? (
                  <RefreshCw className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => handleSkip(-10)}
                className="w-8 h-8 flex items-center justify-center hover:text-[#D97757] hover:bg-white/10 transition-colors cursor-pointer"
                title="Rewind 10s (←)"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => handleSkip(10)}
                className="w-8 h-8 flex items-center justify-center hover:text-[#D97757] hover:bg-white/10 transition-colors cursor-pointer"
                title="Forward 10s (→)"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              {/* Volume Control */}
              <div className="hidden sm:flex items-center gap-1.5 px-1.5 py-1 bg-[#141311]/70 border border-white/10">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="p-1 hover:text-[#D97757] cursor-pointer"
                  title="Mute / Unmute (M)"
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
                  className="w-16 accent-[#D97757] cursor-pointer"
                  aria-label="Volume"
                />
              </div>

              {/* Clickable Timecode (Toggles Elapsed vs Remaining Time) */}
              <button
                type="button"
                onClick={() => setShowRemainingTime((prev) => !prev)}
                className="px-2 py-1 text-xs font-mono tabular-nums text-[#F2EFE9] hover:text-[#D97757] transition-colors cursor-pointer"
                title="Click to toggle elapsed / remaining time"
              >
                {showRemainingTime && duration > 0
                  ? `-${formatClock(Math.max(0, duration - currentTime))}`
                  : formatClock(currentTime)}{' '}
                <span className="text-white/35">/</span> {formatClock(duration)}
              </button>
            </div>

            {/* Right Group: Loop, Frame Capture, Fit/Fill, Speed, PiP, Fullscreen */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={toggleLoop}
                className={`w-8 h-8 flex items-center justify-center border transition-colors cursor-pointer ${
                  isLooping
                    ? 'bg-[#D97757] border-[#D97757] text-[#141311]'
                    : 'bg-[#141311]/80 border-white/15 hover:border-[#D97757] text-[#F2EFE9]'
                }`}
                title={isLooping ? 'Loop Enabled (R)' : 'Loop Video (R)'}
              >
                <Repeat className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={captureVideoSnapshot}
                className="hidden sm:flex w-8 h-8 items-center justify-center bg-[#141311]/80 border border-white/15 hover:border-[#D97757] text-[#F2EFE9] hover:text-[#D97757] transition-colors cursor-pointer"
                title="Save Video Frame Screenshot"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() =>
                  setFitMode((prev) => (prev === 'contain' ? 'cover' : 'contain'))
                }
                className={`hidden md:flex px-2 h-8 items-center justify-center text-[11px] font-mono border transition-colors cursor-pointer ${
                  fitMode === 'cover'
                    ? 'bg-[#24211D] border-[#D97757] text-[#D97757] font-bold'
                    : 'bg-[#141311]/80 border-white/15 hover:border-[#D97757] text-[#F2EFE9]'
                }`}
                title="Toggle Fit / Widescreen Crop"
              >
                {fitMode === 'cover' ? 'FILL' : 'FIT'}
              </button>

              <button
                type="button"
                onClick={() => setShowSpeedMenu((prev) => !prev)}
                className={`px-2.5 h-8 text-xs font-mono tabular-nums border cursor-pointer transition-colors ${
                  showSpeedMenu || playbackRate !== 1
                    ? 'bg-[#D97757] border-[#D97757] text-[#141311] font-bold'
                    : 'bg-[#141311]/80 border-white/15 hover:border-[#D97757] text-[#F2EFE9]'
                }`}
                title="Playback Speed"
              >
                {playbackRate}x
              </button>

              <button
                type="button"
                onClick={togglePictureInPicture}
                className={`hidden sm:flex w-8 h-8 items-center justify-center border transition-colors cursor-pointer ${
                  isPip
                    ? 'bg-[#D97757] border-[#D97757] text-[#141311]'
                    : 'bg-[#141311]/80 border-white/15 hover:border-[#D97757] text-[#F2EFE9]'
                }`}
                title="Picture-in-Picture (P)"
              >
                <PictureInPicture2 className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                className="w-8 h-8 flex items-center justify-center bg-[#141311]/80 border border-white/15 hover:border-[#D97757] text-[#F2EFE9] hover:text-[#D97757] cursor-pointer transition-colors"
                title="Fullscreen (F)"
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
