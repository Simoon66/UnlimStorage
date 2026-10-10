import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  Check,
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

const SPEED_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export const YouTubeIframePlayer: React.FC<YouTubeIframePlayerProps> = ({
  fileName,
  srcUrl,
  fullViewport = false,
  onFallbackContainer,
  onPlaybackError,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeBody, setIframeBody] = useState<HTMLElement | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  // Initialize the clean <iframe> document and sync Tailwind / fonts into it
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
    html, body { width: 100%; height: 100%; background: #000; color: #F2EFE9; font-family: 'DM Sans', 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif; overflow: hidden; }
  </style>
</head>
<body><div id="jw-iframe-root" style="width:100%;height:100%;"></div></body>
</html>`);
      doc.close();

      const parentStyles = document.querySelectorAll('style, link[rel="stylesheet"]');
      parentStyles.forEach((node) => {
        doc.head.appendChild(node.cloneNode(true));
      });

      const mountNode = doc.getElementById('jw-iframe-root');
      if (mountNode) {
        setIframeBody(mountNode);
      }
    };

    initIframeDoc();
  }, []);

  const scheduleHideControls = () => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    if (isPlaying && !showSpeedMenu) {
      hideControlsTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 2500);
    }
  };

  useEffect(() => {
    if (!isPlaying || showSpeedMenu) {
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
  }, [isPlaying, showSpeedMenu]);

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
    setShowSpeedMenu(false);
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
      onMouseMove={scheduleHideControls}
      onTouchStart={scheduleHideControls}
      onClick={() => {
        if (showSpeedMenu) setShowSpeedMenu(false);
      }}
      className="relative w-full h-full bg-black flex flex-col justify-between overflow-hidden select-none"
    >
      {/* Main Clean Video Stage */}
      <div
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        className="relative flex-1 w-full h-full flex items-center justify-center bg-black cursor-pointer overflow-hidden"
      >
        <video
          ref={videoRef}
          src={srcUrl}
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
            if (onFallbackContainer) {
              onFallbackContainer();
            } else if (onPlaybackError) {
              onPlaybackError(
                'Video stream could not be decoded directly in the browser. Click Download below to watch locally.'
              );
            }
          }}
          className="w-full h-full max-h-full object-contain"
        />

        {/* Minimal JW Player Center Play Button when paused */}
        {!isPlaying && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className="w-16 h-16 bg-[#141311]/90 hover:bg-[#D97757] text-[#F2EFE9] hover:text-[#141311] border border-white/20 hover:border-[#D97757] flex items-center justify-center transition-colors duration-150 cursor-pointer"
            aria-label="Play Video"
          >
            <Play className="w-7 h-7 fill-current ml-0.5" />
          </button>
        )}
      </div>

      {/* JW Player Playback Speed Menu Popover */}
      {showSpeedMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-14 right-3 z-30 w-36 bg-[#141311]/95 border border-[#2C2824] text-[#F2EFE9] shadow-2xl py-1"
        >
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#9E978E] border-b border-[#2C2824]">
            Speed
          </div>
          {SPEED_RATES.map((rate) => {
            const active = playbackRate === rate;
            return (
              <button
                key={rate}
                type="button"
                onClick={() => handleSpeedChange(rate)}
                className={`w-full px-3 py-1.5 text-xs font-mono tabular-nums flex items-center justify-between cursor-pointer ${
                  active
                    ? 'bg-[#24211D] text-[#D97757] font-bold'
                    : 'text-[#F2EFE9] hover:bg-[#1C1A17]'
                }`}
              >
                <span>{rate === 1 ? '1x (Normal)' : `${rate}x`}</span>
                {active && <Check className="w-3.5 h-3.5 text-[#D97757]" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Minimal JW Player Bottom Control Bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-3 sm:px-4 pt-4 pb-2.5 space-y-2 transition-opacity duration-150 ${
          controlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Smooth JW Player Timeline Scrubber */}
        <div className="relative w-full h-3 flex items-center group/scrub cursor-pointer">
          <div className="w-full h-1 group-hover/scrub:h-1.5 bg-white/20 relative overflow-hidden transition-all">
            <div
              style={{ width: `${bufferedPct}%` }}
              className="absolute left-0 top-0 bottom-0 bg-white/35"
            />
            <div
              style={{ width: `${progressPct}%` }}
              className="absolute left-0 top-0 bottom-0 bg-[#D97757]"
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

        {/* Bottom Transport Row */}
        <div className="flex items-center justify-between gap-2 text-[#F2EFE9]">
          {/* Left: Play/Pause, 10s Skip, Volume, Time */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={togglePlay}
              className="p-1.5 hover:text-[#D97757] transition-colors cursor-pointer"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 fill-current" />
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSkip(-10)}
              className="p-1.5 hover:text-[#D97757] transition-colors cursor-pointer"
              title="Rewind 10s"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => handleSkip(10)}
              className="p-1.5 hover:text-[#D97757] transition-colors cursor-pointer"
              title="Forward 10s"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            <div className="hidden sm:flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                className="p-1.5 hover:text-[#D97757] cursor-pointer"
                title="Mute / Unmute"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-[#DC2626]" />
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
                className="w-16 accent-[#D97757] cursor-pointer"
                aria-label="Volume"
              />
            </div>

            <div className="text-xs font-mono tabular-nums text-[#F2EFE9]/90 ml-1">
              {formatClock(currentTime)} <span className="text-white/40">/</span>{' '}
              {formatClock(duration)}
            </div>
          </div>

          {/* Right: Speed Selector & Fullscreen */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSpeedMenu((prev) => !prev)}
              className={`px-2.5 py-1 text-xs font-mono tabular-nums border cursor-pointer transition-colors ${
                showSpeedMenu || playbackRate !== 1
                  ? 'bg-[#D97757] border-[#D97757] text-[#141311] font-bold'
                  : 'bg-black/60 border-white/20 hover:border-[#D97757] text-[#F2EFE9]'
              }`}
              title="Playback Speed"
            >
              {playbackRate}x
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-1.5 bg-black/60 border border-white/20 hover:border-[#D97757] text-[#F2EFE9] cursor-pointer transition-colors"
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
    <div
      className={`w-full bg-black overflow-hidden ${
        fullViewport ? 'h-screen border-0' : 'border border-[#2C2824]'
      }`}
    >
      <div className={`relative w-full bg-black ${fullViewport ? 'h-full' : 'aspect-video'}`}>
        <iframe
          ref={iframeRef}
          title={fileName || 'Video Player'}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          className="w-full h-full border-0 bg-black block"
        />
        {iframeBody && createPortal(playerContent, iframeBody)}
      </div>
    </div>
  );
};

