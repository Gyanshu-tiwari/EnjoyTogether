import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  Play,
  Pause,
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  Sun,
  RotateCcw,
  RotateCw,
  Sliders,
  Check,
} from 'lucide-react';

/* =========================================================================
   1. TYPESCRIPT INTERFACES & CONFIGURATIONS
   ========================================================================= */

/**
 * Public Ref Handle exposed to parent components for programmatic control.
 */
export interface CustomVlcPlayerHandle {
  videoElement: HTMLVideoElement | null;
  containerElement: HTMLDivElement | null;
  play: () => Promise<void>;
  pause: () => void;
  seek: (seconds: number) => void;
  setVolume: (level: number) => void;
  toggleFullscreen: () => void;
}

/**
 * Props for the CustomVlcPlayer component.
 */
export interface CustomVlcPlayerProps {
  /** Optional external ref to sync with parent controllers (e.g. WebRTC captureStream) */
  externalVideoRef?: React.RefObject<HTMLVideoElement | null>;
  /** Video source URL (supports range-request streaming endpoints from Express) */
  src?: string;
  /** Live MediaStream for WebRTC peer streams */
  srcObject?: MediaStream | null;
  /** Optional poster image URL displayed before playback begins */
  poster?: string;
  /** Automatically begin playback when media is loaded */
  autoPlay?: boolean;
  /** Loop playback */
  loop?: boolean;
  /** Whether the user has permission to control media (e.g. Host vs View-Only) */
  canControl?: boolean;
  /** Preload attribute for the HTML5 video element */
  preload?: 'none' | 'metadata' | 'auto';
  /** Cross-origin attribute for CORS-enabled video streaming */
  crossOrigin?: 'anonymous' | 'use-credentials';
  /** Callback fired when playback starts */
  onPlay?: () => void;
  /** Callback fired when playback pauses */
  onPause?: () => void;
  /** Callback fired on user seeking */
  onSeek?: (newTime: number) => void;
  /** Callback fired on time update (rate-limited) */
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  /** Callback fired on video error */
  onError?: (error: Event) => void;
  /** Custom CSS classes for the outer wrapper container */
  className?: string;
  /** Additional React children to overlay inside the player viewport (e.g., room watermarks) */
  children?: React.ReactNode;
  /** Authoritative media duration from host/room state for WebRTC MediaStreams where video.duration is infinite or unknown */
  externalDuration?: number | null;
}

/**
 * VLC-Style On-Screen Display (OSD) Notification State.
 */
export interface VlcOsdNotification {
  type:
    | 'volume'
    | 'brightness'
    | 'seek-forward'
    | 'seek-backward'
    | 'speed'
    | 'play'
    | 'pause'
    | 'mute'
    | 'fullscreen';
  title: string;
  value: string;
  delta?: string;
  currentTimeFormatted?: string;
  percentage?: number; // 0-100 for gauge bar
  visible: boolean;
}

/**
 * Mobile Double-Tap Ripple Overlay State.
 */
interface DoubleTapRippleState {
  side: 'left' | 'right';
  seconds: number;
  visible: boolean;
}

/**
 * Mobile Horizontal Swipe Scrub State.
 */
interface HorizontalSwipeState {
  deltaSeconds: number;
  previewTime: number;
  active: boolean;
}

/**
 * Active mobile gesture tracking state.
 */
interface TouchGestureSession {
  startX: number;
  startY: number;
  startTime: number;
  initialValue: number;
  side: 'left' | 'right' | null;
  isVerticalSwiping: boolean;
  isHorizontalSwiping: boolean;
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as const;
type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/* =========================================================================
   2. UTILITY FUNCTIONS
   ========================================================================= */

function formatTime(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '00:00';
  const totalSeconds = Math.floor(seconds);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const paddedMins = String(mins).padStart(2, '0');
  const paddedSecs = String(secs).padStart(2, '0');

  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${paddedMins}:${paddedSecs}`;
  }
  return `${paddedMins}:${paddedSecs}`;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/* =========================================================================
   3. COMPONENT IMPLEMENTATION
   ========================================================================= */

export const CustomVlcPlayer = forwardRef<CustomVlcPlayerHandle, CustomVlcPlayerProps>(
  (
    {
      externalVideoRef,
      src,
      srcObject,
      poster,
      autoPlay = false,
      loop = false,
      canControl = true,
      preload = 'metadata',
      crossOrigin = 'anonymous',
      onPlay,
      onPause,
      onSeek,
      onTimeUpdate,
      onError,
      className = '',
      children,
      externalDuration,
    },
    ref
  ) => {
    // ── DOM References ────────────────────────────────────────────────────────
    const containerRef = useRef<HTMLDivElement | null>(null);
    const internalVideoRef = useRef<HTMLVideoElement | null>(null);
    const scrubBarRef = useRef<HTMLDivElement | null>(null);
    const autoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const osdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const doubleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const doubleTapRippleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clickDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Active video ref helper (uses external if supplied)
    const getVideo = useCallback((): HTMLVideoElement | null => {
      return (externalVideoRef?.current || internalVideoRef.current);
    }, [externalVideoRef]);

    // ── Playback State ────────────────────────────────────────────────────────
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [currentTime, setCurrentTime] = useState<number>(0);
    const [duration, setDuration] = useState<number>(0);
    const effectiveDuration =
      externalDuration && isFinite(externalDuration) && externalDuration > 0
        ? externalDuration
        : isFinite(duration) && duration > 0
        ? duration
        : 0;
    const [bufferedEnd, setBufferedEnd] = useState<number>(0);
    const [volume, setVolumeState] = useState<number>(1);
    const [isMuted, setIsMuted] = useState<boolean>(false);
    const [playbackRate, setPlaybackRate] = useState<PlaybackSpeed>(1.0);
    const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
    const [isBuffering, setIsBuffering] = useState<boolean>(false);

    // ── UI Visibility State ───────────────────────────────────────────────────
    const [showControls, setShowControls] = useState<boolean>(true);
    const [speedMenuOpen, setSpeedMenuOpen] = useState<boolean>(false);
    const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [hoverX, setHoverX] = useState<number>(0);

    // ── Mobile Gesture & Simulated Hardware State ─────────────────────────────
    const [brightness, setBrightness] = useState<number>(1.0);

    // VLC On-Screen Display (OSD) Notification State
    const [osd, setOsd] = useState<VlcOsdNotification>({
      type: 'volume',
      title: 'Volume',
      value: '100%',
      visible: false,
    });

    // Mobile double-tap ripple state
    const [doubleTapRipple, setDoubleTapRipple] = useState<DoubleTapRippleState>({
      side: 'right',
      seconds: 10,
      visible: false,
    });

    // Mobile horizontal swipe scrub state
    const [horizontalSeek, setHorizontalSeek] = useState<HorizontalSwipeState>({
      deltaSeconds: 0,
      previewTime: 0,
      active: false,
    });

    const gestureSessionRef = useRef<TouchGestureSession | null>(null);
    const lastTapRef = useRef<{ time: number; x: number; count: number } | null>(null);

    // ── Trigger VLC On-Screen Display (OSD) Banner ────────────────────────────
    const showVlcOsd = useCallback((notification: Omit<VlcOsdNotification, 'visible'>) => {
      setOsd({ ...notification, visible: true });
      if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
      osdTimerRef.current = setTimeout(() => {
        setOsd((prev) => ({ ...prev, visible: false }));
      }, 1500);
    }, []);

    // ── Fullscreen Management (Standard + Vendor Fallbacks) ───────────────────
    const handleToggleFullscreen = useCallback(() => {
      const container = containerRef.current as
        | (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void })
        | null;
      if (!container) return;

      if (!document.fullscreenElement) {
        if (container.requestFullscreen) {
          container.requestFullscreen().catch(() => {});
        } else if (container.webkitRequestFullscreen) {
          container.webkitRequestFullscreen();
        }
        showVlcOsd({
          type: 'fullscreen',
          title: 'Fullscreen',
          value: 'Enabled',
        });
      } else {
        const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
        if (doc.exitFullscreen) {
          doc.exitFullscreen().catch(() => {});
        } else if (doc.webkitExitFullscreen) {
          doc.webkitExitFullscreen();
        }
        showVlcOsd({
          type: 'fullscreen',
          title: 'Fullscreen',
          value: 'Disabled',
        });
      }
    }, [showVlcOsd]);

    // ── Expose Imperative Handle ──────────────────────────────────────────────
    useImperativeHandle(
      ref,
      () => ({
        videoElement: getVideo(),
        containerElement: containerRef.current,
        play: async () => {
          const video = getVideo();
          if (video) await video.play();
        },
        pause: () => {
          const video = getVideo();
          if (video) video.pause();
        },
        seek: (seconds: number) => {
          const video = getVideo();
          if (video) {
            video.currentTime = clamp(seconds, 0, effectiveDuration || duration || 0);
          }
        },
        setVolume: (level: number) => {
          const clamped = clamp(level, 0, 1);
          const video = getVideo();
          if (video) {
            video.volume = clamped;
            video.muted = clamped === 0;
          }
          setVolumeState(clamped);
          setIsMuted(clamped === 0);
        },
        toggleFullscreen: () => {
          handleToggleFullscreen();
        },
      }),
      [duration, effectiveDuration, getVideo, handleToggleFullscreen]
    );

    // ── MediaStream vs URL Binding ───────────────────────────────────────────
    useEffect(() => {
      const video = getVideo();
      if (!video) return;

      if (srcObject !== undefined) {
        video.srcObject = srcObject;
      }
    }, [srcObject, getVideo]);

    // ── Controls Inactivity Auto-Hide (2000ms) ────────────────────────────────
    const resetAutoHideTimer = useCallback(() => {
      setShowControls(true);
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);

      if (!isPlaying || isScrubbing || speedMenuOpen) return;

      autoHideTimerRef.current = setTimeout(() => {
        setShowControls(false);
        setSpeedMenuOpen(false);
      }, 2000);
    }, [isPlaying, isScrubbing, speedMenuOpen]);

    useEffect(() => {
      resetAutoHideTimer();
      return () => {
        if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current);
      };
    }, [isPlaying, isScrubbing, speedMenuOpen, resetAutoHideTimer]);

    useEffect(() => {
      const onFullscreenChange = () => {
        setIsFullscreen(!!document.fullscreenElement);
      };
      document.addEventListener('fullscreenchange', onFullscreenChange);
      document.addEventListener('webkitfullscreenchange', onFullscreenChange);
      return () => {
        document.removeEventListener('fullscreenchange', onFullscreenChange);
        document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      };
    }, []);

    // ── Play / Pause Toggle ───────────────────────────────────────────────────
    const togglePlay = useCallback(() => {
      if (!canControl) return;
      const video = getVideo();
      if (!video) return;

      if (video.paused || video.ended) {
        video.play().catch((err) => console.warn('[CustomVlcPlayer] Playback failed:', err));
        showVlcOsd({
          type: 'play',
          title: 'Playback',
          value: 'Play',
        });
      } else {
        video.pause();
        showVlcOsd({
          type: 'pause',
          title: 'Playback',
          value: 'Pause',
        });
      }
    }, [canControl, getVideo, showVlcOsd]);

    // ── Volume & Mute Adjustments ─────────────────────────────────────────────
    const adjustVolume = useCallback(
      (newVolume: number, deltaLabel?: string) => {
        const video = getVideo();
        if (!video) return;
        const clamped = clamp(newVolume, 0, 1);
        video.volume = clamped;
        video.muted = clamped === 0;
        setVolumeState(clamped);
        setIsMuted(clamped === 0);

        showVlcOsd({
          type: 'volume',
          title: 'Volume',
          value: `${Math.round(clamped * 100)}%`,
          delta: deltaLabel,
          percentage: Math.round(clamped * 100),
        });
      },
      [getVideo, showVlcOsd]
    );

    const toggleMute = useCallback(() => {
      const video = getVideo();
      if (!video) return;
      if (video.muted || volume === 0) {
        video.muted = false;
        const restored = volume === 0 ? 0.5 : volume;
        video.volume = restored;
        setVolumeState(restored);
        setIsMuted(false);
        showVlcOsd({
          type: 'volume',
          title: 'Volume',
          value: `${Math.round(restored * 100)}%`,
          delta: 'Unmuted',
          percentage: Math.round(restored * 100),
        });
      } else {
        video.muted = true;
        setIsMuted(true);
        showVlcOsd({
          type: 'mute',
          title: 'Volume',
          value: 'Muted (0%)',
          delta: 'Muted',
          percentage: 0,
        });
      }
    }, [getVideo, volume, showVlcOsd]);

    // ── Seek Relative Management ──────────────────────────────────────────────
    const seekRelative = useCallback(
      (secondsDelta: number) => {
        if (!canControl) return;
        const video = getVideo();
        if (!video) return;
        const target = clamp(video.currentTime + secondsDelta, 0, effectiveDuration || video.duration || 0);
        video.currentTime = target;
        setCurrentTime(target);
        onSeek?.(target);

        showVlcOsd({
          type: secondsDelta >= 0 ? 'seek-forward' : 'seek-backward',
          title: 'Seek',
          value: secondsDelta >= 0 ? `+${secondsDelta}s` : `${secondsDelta}s`,
          delta: secondsDelta >= 0 ? `+${secondsDelta}s` : `${secondsDelta}s`,
          currentTimeFormatted: formatTime(target),
          percentage: video.duration > 0 ? Math.round((target / video.duration) * 100) : 0,
        });
      },
      [canControl, getVideo, onSeek, showVlcOsd]
    );

    // ── Global Keyboard Shortcuts ─────────────────────────────────────────────
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        const activeEl = document.activeElement as HTMLElement | null;
        const isTyping =
          activeEl?.tagName === 'INPUT' ||
          activeEl?.tagName === 'TEXTAREA' ||
          activeEl?.isContentEditable;
        if (isTyping) return;

        const isContainerFocused =
          containerRef.current?.contains(activeEl) || activeEl === document.body;
        if (!isContainerFocused) return;

        switch (e.code) {
          case 'Space':
            e.preventDefault();
            togglePlay();
            resetAutoHideTimer();
            break;

          case 'ArrowRight':
            e.preventDefault();
            seekRelative(5);
            resetAutoHideTimer();
            break;

          case 'ArrowLeft':
            e.preventDefault();
            seekRelative(-5);
            resetAutoHideTimer();
            break;

          case 'ArrowUp':
            e.preventDefault();
            adjustVolume(volume + 0.05, '+5%');
            resetAutoHideTimer();
            break;

          case 'ArrowDown':
            e.preventDefault();
            adjustVolume(volume - 0.05, '-5%');
            resetAutoHideTimer();
            break;

          case 'KeyF':
            e.preventDefault();
            handleToggleFullscreen();
            break;

          case 'KeyM':
            e.preventDefault();
            toggleMute();
            break;

          default:
            break;
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }, [
      togglePlay,
      seekRelative,
      adjustVolume,
      volume,
      handleToggleFullscreen,
      toggleMute,
      resetAutoHideTimer,
    ]);

    // ── Desktop Mouse Wheel on Video (VLC Style Volume Adjust) ────────────────
    const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      adjustVolume(volume + delta, delta > 0 ? '+5%' : '-5%');
      resetAutoHideTimer();
    };

    // ── Desktop Video Click vs Double Click Disambiguation ────────────────────
    const handleVideoClick = () => {
      if (clickDebounceTimerRef.current) {
        clearTimeout(clickDebounceTimerRef.current);
        clickDebounceTimerRef.current = null;
        // Double click: toggle fullscreen
        handleToggleFullscreen();
      } else {
        clickDebounceTimerRef.current = setTimeout(() => {
          // Single click: toggle play
          togglePlay();
          clickDebounceTimerRef.current = null;
        }, 250);
      }
    };

    // ── Scrub Bar Pointer Events ──────────────────────────────────────────────
    const handleScrubMove = useCallback(
      (e: PointerEvent) => {
        const scrubBar = scrubBarRef.current;
        const video = getVideo();
        const activeDuration = effectiveDuration || duration;
        if (!scrubBar || !video || !activeDuration) return;

        const rect = scrubBar.getBoundingClientRect();
        const offsetX = clamp(e.clientX - rect.left, 0, rect.width);
        const percentage = offsetX / rect.width;
        const targetTime = percentage * activeDuration;

        video.currentTime = targetTime;
        setCurrentTime(targetTime);

        showVlcOsd({
          type: 'seek-forward',
          title: 'Position',
          value: formatTime(targetTime),
          percentage: Math.round(percentage * 100),
          currentTimeFormatted: `${formatTime(targetTime)} / ${formatTime(activeDuration)}`,
        });
      },
      [effectiveDuration, duration, getVideo, showVlcOsd]
    );

    const handleScrubPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      const activeDuration = effectiveDuration || duration;
      if (!canControl || !activeDuration) return;
      setIsScrubbing(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      handleScrubMove(e.nativeEvent);

      const onPointerMove = (moveEvent: PointerEvent) => {
        handleScrubMove(moveEvent);
      };

      const onPointerUp = () => {
        setIsScrubbing(false);
        const video = getVideo();
        if (video) onSeek?.(video.currentTime);

        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        resetAutoHideTimer();
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };

    const handleScrubHover = (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 0, rect.width);
      setHoverX(x);
      const activeDuration = effectiveDuration || duration;
      if (activeDuration > 0) {
        setHoverTime((x / rect.width) * activeDuration);
      }
    };

    /* =========================================================================
       4. MOBILE TOUCH GESTURE MATHEMATICS & LOGIC
       =========================================================================
       * Vertical Differentials:
         deltaY = startY - currentY
         sensitivity = rect.height * 0.6 (60% height swipe = 100% change)
         deltaFraction = deltaY / sensitivity

       * Horizontal Differentials (Seek):
         deltaX = currentX - startX
         deltaSeconds = Math.round((deltaX / rect.width) * 90) (Full width = 90s)
       ========================================================================= */

    const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
      resetAutoHideTimer();
      if (e.touches.length !== 1) {
        gestureSessionRef.current = null;
        return;
      }

      const touch = e.touches[0];
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const relativeX = touch.clientX - rect.left;
      const isLeftSide = relativeX < rect.width / 2;

      gestureSessionRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        side: isLeftSide ? 'left' : 'right',
        initialValue: isLeftSide ? brightness : volume,
        isVerticalSwiping: false,
        isHorizontalSwiping: false,
      };
    };

    const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
      const session = gestureSessionRef.current;
      const container = containerRef.current;
      const video = getVideo();
      if (!session || !container || e.touches.length !== 1) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - session.startX;
      const deltaY = session.startY - touch.clientY;

      const rect = container.getBoundingClientRect();

      // Deadzone threshold (12px)
      if (!session.isVerticalSwiping && !session.isHorizontalSwiping) {
        if (Math.abs(deltaY) > 12 && Math.abs(deltaY) > Math.abs(deltaX)) {
          session.isVerticalSwiping = true;
        } else if (Math.abs(deltaX) > 15 && Math.abs(deltaX) > Math.abs(deltaY)) {
          session.isHorizontalSwiping = true;
        } else {
          return;
        }
      }

      // Vertical Swipe (Brightness on Left, Volume on Right)
      if (session.isVerticalSwiping) {
        const sensitivityHeight = rect.height * 0.6;
        const deltaFraction = deltaY / sensitivityHeight;

        if (session.side === 'right') {
          const newVolume = clamp(session.initialValue + deltaFraction, 0, 1);
          if (video) {
            video.volume = newVolume;
            video.muted = newVolume === 0;
          }
          setVolumeState(newVolume);
          setIsMuted(newVolume === 0);
          showVlcOsd({
            type: 'volume',
            title: 'Volume',
            value: `${Math.round(newVolume * 100)}%`,
            percentage: Math.round(newVolume * 100),
          });
        } else if (session.side === 'left') {
          const newBrightness = clamp(session.initialValue + deltaFraction, 0.15, 1.0);
          setBrightness(newBrightness);
          showVlcOsd({
            type: 'brightness',
            title: 'Brightness',
            value: `${Math.round(newBrightness * 100)}%`,
            percentage: Math.round(newBrightness * 100),
          });
        }
      }

      // Horizontal Swipe (Live Scrub Preview)
      if (session.isHorizontalSwiping && canControl && duration > 0) {
        const scrubSensitivityRange = 90; // 90 seconds max across full width
        const deltaSec = Math.round((deltaX / rect.width) * scrubSensitivityRange);
        const target = clamp(currentTime + deltaSec, 0, duration);

        setHorizontalSeek({
          deltaSeconds: deltaSec,
          previewTime: target,
          active: true,
        });

        showVlcOsd({
          type: deltaSec >= 0 ? 'seek-forward' : 'seek-backward',
          title: 'Seek',
          value: deltaSec >= 0 ? `+${deltaSec}s` : `${deltaSec}s`,
          currentTimeFormatted: formatTime(target),
          percentage: Math.round((target / duration) * 100),
        });
      }
    };

    const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
      const session = gestureSessionRef.current;
      const container = containerRef.current;
      const video = getVideo();
      gestureSessionRef.current = null;

      if (!session || !container) return;

      // Complete horizontal scrub
      if (session.isHorizontalSwiping) {
        if (horizontalSeek.active && video && canControl && duration > 0) {
          video.currentTime = horizontalSeek.previewTime;
          setCurrentTime(horizontalSeek.previewTime);
          onSeek?.(horizontalSeek.previewTime);
        }
        setHorizontalSeek({ deltaSeconds: 0, previewTime: 0, active: false });
        return;
      }

      if (session.isVerticalSwiping) return;

      const now = Date.now();
      const touch = e.changedTouches[0];
      const rect = container.getBoundingClientRect();
      const relativeX = touch.clientX - rect.left;
      const isRightSide = relativeX >= rect.width / 2;

      // ── Double-Tap Detection (< 350ms between successive taps on the same side) ──
      if (
        lastTapRef.current &&
        now - lastTapRef.current.time < 350 &&
        Math.abs(touch.clientX - lastTapRef.current.x) < 50
      ) {
        if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
        const newCount = (lastTapRef.current.count || 1) + 1;
        const deltaSeconds = newCount * 10;
        lastTapRef.current = { time: now, x: touch.clientX, count: newCount };

        // Seek and trigger ripple
        if (isRightSide) {
          seekRelative(10);
          setDoubleTapRipple({ side: 'right', seconds: deltaSeconds, visible: true });
        } else {
          seekRelative(-10);
          setDoubleTapRipple({ side: 'left', seconds: deltaSeconds, visible: true });
        }

        if (doubleTapRippleTimerRef.current) clearTimeout(doubleTapRippleTimerRef.current);
        doubleTapRippleTimerRef.current = setTimeout(() => {
          setDoubleTapRipple((prev) => ({ ...prev, visible: false }));
          lastTapRef.current = null;
        }, 750);
        return;
      }

      lastTapRef.current = { time: now, x: touch.clientX, count: 1 };
      doubleTapTimerRef.current = setTimeout(() => {
        setShowControls((prev) => !prev);
        lastTapRef.current = null;
      }, 350);
    };

    const darknessOpacity = clamp((1.0 - brightness) * 0.85, 0, 0.85);

    return (
      <div
        ref={containerRef}
        tabIndex={0}
        onMouseMove={resetAutoHideTimer}
        onMouseEnter={resetAutoHideTimer}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`relative w-full h-full max-w-full max-h-full flex items-center justify-center bg-black rounded-2xl overflow-hidden select-none outline-none group ${className}`}
      >
        {/* ===================================================================
            HTML5 VIDEO ELEMENT (Custom VLC Controlled)
            =================================================================== */}
        <video
          ref={(el) => {
            internalVideoRef.current = el;
            if (externalVideoRef) {
              (externalVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
            }
          }}
          src={src}
          poster={poster}
          autoPlay={autoPlay}
          loop={loop}
          preload={preload}
          crossOrigin={crossOrigin}
          playsInline
          controls={false}
          onPlay={() => {
            setIsPlaying(true);
            onPlay?.();
          }}
          onPause={() => {
            setIsPlaying(false);
            onPause?.();
          }}
          onTimeUpdate={() => {
            const video = getVideo();
            if (!video || isScrubbing) return;
            setCurrentTime(video.currentTime);
            onTimeUpdate?.(video.currentTime, video.duration || 0);

            if (video.buffered.length > 0) {
              setBufferedEnd(video.buffered.end(video.buffered.length - 1));
            }
          }}
          onLoadedMetadata={() => {
            const video = getVideo();
            if (video) {
              setDuration(video.duration || 0);
              setVolumeState(video.volume);
              setIsMuted(video.muted);
            }
          }}
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => setIsBuffering(false)}
          onError={(e) => {
            setIsBuffering(false);
            onError?.(e.nativeEvent);
          }}
          className="w-full h-full max-w-full max-h-full object-contain mx-auto cursor-pointer"
          onClick={handleVideoClick}
        />

        {/* ===================================================================
            SIMULATED HARDWARE BRIGHTNESS OVERLAY
            =================================================================== */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-black pointer-events-none transition-opacity duration-100 z-10"
          style={{ opacity: darknessOpacity }}
        />

        {/* ===================================================================
            BUFFERING SPINNER
            =================================================================== */}
        {isBuffering && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div className="w-14 h-14 rounded-full border-4 border-orange-500/20 border-t-[#ff8800] animate-spin shadow-2xl" />
          </div>
        )}

        {/* ===================================================================
            VLC-STYLE ON-SCREEN DISPLAY (OSD) NOTIFICATION (TOP RIGHT CORNER)
            =================================================================== */}
        {osd.visible && (
          <div className="absolute top-4 right-4 z-40 flex flex-col gap-1.5 bg-black/85 backdrop-blur-md border border-white/15 px-4 py-2.5 rounded-2xl shadow-2xl animate-fade-in pointer-events-none select-none min-w-[170px]">
            <div className="flex items-center justify-between gap-3 text-white">
              <div className="flex items-center gap-2">
                {osd.type === 'volume' &&
                  (osd.percentage === 0 ? (
                    <VolumeX className="w-4 h-4 text-red-400" />
                  ) : (osd.percentage || 0) < 50 ? (
                    <Volume1 className="w-4 h-4 text-[#ff8800]" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-[#ff8800]" />
                  ))}
                {osd.type === 'brightness' && <Sun className="w-4 h-4 text-amber-300" />}
                {osd.type === 'seek-forward' && <RotateCw className="w-4 h-4 text-[#ff8800]" />}
                {osd.type === 'seek-backward' && <RotateCcw className="w-4 h-4 text-[#ff8800]" />}
                {osd.type === 'speed' && <Sliders className="w-4 h-4 text-cyan-400" />}
                {osd.type === 'play' && <Play className="w-4 h-4 text-emerald-400 fill-current" />}
                {osd.type === 'pause' && <Pause className="w-4 h-4 text-amber-400 fill-current" />}
                {osd.type === 'mute' && <VolumeX className="w-4 h-4 text-red-400" />}
                {osd.type === 'fullscreen' && <Maximize className="w-4 h-4 text-purple-400" />}

                <span className="text-xs font-bold font-mono tracking-tight text-neutral-300">
                  {osd.title}:
                </span>
                <span className="text-xs font-black font-mono text-white">{osd.value}</span>
              </div>

              {osd.delta && (
                <span
                  className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    osd.delta.startsWith('+')
                      ? 'bg-orange-500/20 text-[#ff8800]'
                      : 'bg-blue-500/20 text-blue-400'
                  }`}
                >
                  {osd.delta}
                </span>
              )}
            </div>

            {/* Sub-label timestamp if available */}
            {osd.currentTimeFormatted && (
              <span className="text-[10px] font-mono text-neutral-400">
                {osd.currentTimeFormatted}
              </span>
            )}

            {/* Precision gauge bar (VLC Signature Orange) */}
            {osd.percentage !== undefined && (
              <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden mt-0.5">
                <div
                  className={`h-full transition-all duration-75 ${
                    osd.type === 'brightness' ? 'bg-amber-400' : 'bg-[#ff8800]'
                  }`}
                  style={{ width: `${clamp(osd.percentage, 0, 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* ===================================================================
            MOBILE DOUBLE-TAP RIPPLE SEEK FEEDBACK (LEFT / RIGHT)
            =================================================================== */}
        {doubleTapRipple.visible && (
          <div
            className={`absolute top-0 bottom-0 w-2/5 flex flex-col items-center justify-center bg-black/40 backdrop-blur-xs pointer-events-none z-30 animate-fade-in ${
              doubleTapRipple.side === 'right' ? 'right-0 rounded-l-full' : 'left-0 rounded-r-full'
            }`}
          >
            {doubleTapRipple.side === 'right' ? (
              <>
                <RotateCw className="w-10 h-10 text-[#ff8800] animate-spin" />
                <span className="text-lg font-black font-mono text-white mt-2">
                  +{doubleTapRipple.seconds}s
                </span>
                <span className="text-[10px] font-mono text-neutral-300">Fast Forward</span>
              </>
            ) : (
              <>
                <RotateCcw className="w-10 h-10 text-[#ff8800] animate-spin" />
                <span className="text-lg font-black font-mono text-white mt-2">
                  -{doubleTapRipple.seconds}s
                </span>
                <span className="text-[10px] font-mono text-neutral-300">Rewind</span>
              </>
            )}
          </div>
        )}

        {/* ===================================================================
            MOBILE HORIZONTAL SWIPE LIVE SCRUB OVERLAY
            =================================================================== */}
        {horizontalSeek.active && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-35 animate-fade-in">
            <div className="flex flex-col items-center gap-2 bg-[#18181b]/95 backdrop-blur-xl border border-white/15 px-6 py-4 rounded-3xl shadow-2xl text-white">
              <div className="flex items-center gap-2 text-[#ff8800]">
                {horizontalSeek.deltaSeconds >= 0 ? (
                  <RotateCw className="w-7 h-7" />
                ) : (
                  <RotateCcw className="w-7 h-7" />
                )}
                <span className="text-2xl font-black font-mono">
                  {horizontalSeek.deltaSeconds >= 0
                    ? `+${horizontalSeek.deltaSeconds}s`
                    : `${horizontalSeek.deltaSeconds}s`}
                </span>
              </div>
              <span className="text-xs font-mono text-neutral-300">
                Target: {formatTime(horizontalSeek.previewTime)} / {formatTime(effectiveDuration || duration)}
              </span>
            </div>
          </div>
        )}

        {children}

        {/* ===================================================================
            VLC CUSTOM OVERLAY CONTROL BAR
            =================================================================== */}
        <div
          className={`absolute inset-x-0 bottom-0 flex flex-col justify-end bg-gradient-to-t from-black/95 via-black/60 to-transparent pt-12 pb-3 px-4 transition-all duration-300 z-20 pointer-events-auto ${
            showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Fluid Progress Scrub Bar */}
          <div
            ref={scrubBarRef}
            onPointerDown={handleScrubPointerDown}
            onMouseMove={handleScrubHover}
            onMouseLeave={() => setHoverTime(null)}
            className="relative w-full h-3 flex items-center cursor-pointer group/scrub py-2"
          >
            <div className="w-full h-1 bg-white/20 group-hover/scrub:h-2 rounded-full overflow-hidden relative transition-all">
              <div
                className="absolute top-0 bottom-0 left-0 bg-white/30 transition-all duration-200"
                style={{
                  width: `${effectiveDuration > 0 ? (bufferedEnd / effectiveDuration) * 100 : duration > 0 ? (bufferedEnd / duration) * 100 : 0}%`,
                }}
              />
              <div
                className="absolute top-0 bottom-0 left-0 bg-[#ff8800] transition-all duration-75"
                style={{
                  width: `${effectiveDuration > 0 ? (currentTime / effectiveDuration) * 100 : duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                }}
              />
            </div>

            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-lg border-2 border-[#ff8800] scale-0 group-hover/scrub:scale-100 transition-transform pointer-events-none"
              style={{
                left: `${effectiveDuration > 0 ? (currentTime / effectiveDuration) * 100 : duration > 0 ? (currentTime / duration) * 100 : 0}%`,
              }}
            />

            {hoverTime !== null && (
              <div
                className="absolute -top-7 -translate-x-1/2 bg-[#18181b]/95 border border-white/10 px-2 py-0.5 rounded text-[11px] font-mono text-white shadow-xl pointer-events-none"
                style={{ left: `${hoverX}px` }}
              >
                {formatTime(hoverTime)}
              </div>
            )}
          </div>

          {/* Controls Row */}
          <div className="flex items-center justify-between mt-1 text-white text-sm">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={togglePlay}
                disabled={!canControl}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/15 active:scale-95 transition-all text-white cursor-pointer disabled:opacity-40"
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                )}
              </button>

              <div className="flex items-center gap-1.5 group/volume">
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/15 transition-all text-white cursor-pointer"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-red-400" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>

                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.02"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => adjustVolume(parseFloat(e.target.value))}
                  aria-label="Volume slider"
                  className="w-16 md:w-20 h-1 bg-white/20 accent-[#ff8800] rounded-lg appearance-none cursor-pointer transition-all"
                />
              </div>

              <div className="text-xs font-mono text-neutral-300 select-none ml-1">
                <span className="text-white font-semibold">{formatTime(currentTime)}</span>
                <span className="text-neutral-500 mx-1">/</span>
                <span>
                  {effectiveDuration > 0
                    ? formatTime(effectiveDuration)
                    : (srcObject || externalVideoRef?.current?.srcObject ? '00:00' : formatTime(duration))}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Playback Speed Menu Selector */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSpeedMenuOpen((prev) => !prev)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-white/15 text-xs font-mono font-semibold transition-all cursor-pointer text-neutral-200 hover:text-white"
                  title="Playback Speed"
                >
                  <Sliders className="w-3.5 h-3.5 mr-0.5" />
                  <span>{playbackRate}x</span>
                </button>

                {speedMenuOpen && (
                  <div className="absolute bottom-10 right-0 bg-[#18181b]/95 border border-white/10 rounded-2xl p-1.5 shadow-2xl backdrop-blur-xl flex flex-col gap-1 min-w-[90px] animate-slide-up z-40">
                    <span className="text-[10px] uppercase font-bold text-neutral-400 px-2 py-1">
                      Speed
                    </span>
                    {PLAYBACK_SPEEDS.map((speed) => (
                      <button
                        key={speed}
                        type="button"
                        onClick={() => {
                          const video = getVideo();
                          if (video) {
                            video.playbackRate = speed;
                          }
                          setPlaybackRate(speed);
                          setSpeedMenuOpen(false);
                          showVlcOsd({
                            type: 'speed',
                            title: 'Speed',
                            value: `${speed}x`,
                          });
                          resetAutoHideTimer();
                        }}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                          playbackRate === speed
                            ? 'bg-[#ff8800]/20 text-[#ff8800] font-bold'
                            : 'hover:bg-white/10 text-neutral-300'
                        }`}
                      >
                        <span>{speed}x</span>
                        {playbackRate === speed && <Check className="w-3 h-3" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Fullscreen Toggle Button */}
              <button
                type="button"
                onClick={handleToggleFullscreen}
                aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/15 active:scale-95 transition-all text-white cursor-pointer"
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
  }
);

CustomVlcPlayer.displayName = 'CustomVlcPlayer';
export default CustomVlcPlayer;
