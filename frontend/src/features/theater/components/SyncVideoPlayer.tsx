/**
 * SyncVideoPlayer.tsx
 * ───────────────────
 * Dual-mode synchronized video player:
 *
 * HOST MODE:
 *   - Plays the local file via objectUrl
 *   - Calls captureStream() and passes the stream to WebRTCHostManager
 *   - Emits play/pause/seek events via useSocketSync → backend → viewers
 *   - Shows full playback controls
 *
 * VIEWER MODE:
 *   - Receives a WebRTC MediaStream (from WebRTCViewerManager)
 *   - Attaches via video.srcObject
 *   - Receives sync-state from backend → useSocketSync applies them
 *   - Displays clear diagnostic states (A through F)
 *   - Handles browser autoplay policy (muted playback fallback + unmute prompt)
 *   - Provides connection timeouts and recovery retry action
 *
 * LEGACY HLS MODE:
 *   - If currentStreamUrl is set and no localFile/viewerStream, falls back
 *   - Preserves backward compatibility with existing HLS-based rooms
 */

import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { useTheater } from '../context/useTheater';
import { useSocketSync } from '../hooks/useSocketSync';
import { Spinner } from '@/shared/components/feedback/Spinner';
import { Button } from '@/shared/components/ui/Button';
import { Eye, AlertTriangle, RefreshCw, Zap, Loader2, Volume2 } from 'lucide-react';
import { CustomVlcPlayer } from './CustomVlcPlayer';

type PlayerMode = 'idle' | 'local_host' | 'webrtc_viewer' | 'hls_legacy';

export const SyncVideoPlayer: React.FC = () => {
  const {
    currentStreamUrl,
    socket,
    roomId,
    userRole,
    isHost,
    localFile,
    mediaSource,
    viewerStream,
    webrtcStatus,
    setWebRTCStatus,
    streamDuration,
    streamMediaName,
    retryViewerConnection,
    startHostCapture,
  } = useTheater();

  const isViewer = userRole === 'viewer';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const captureStartedRef = useRef(false);

  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasVideoFrames, setHasVideoFrames] = useState<boolean>(false);
  const [isMutedAutoplay, setIsMutedAutoplay] = useState<boolean>(false);
  const [connectingElapsed, setConnectingElapsed] = useState<number>(0);

  // Determine player mode — local WebRTC viewer is prioritized over legacy HLS for guests
  const mode: PlayerMode = (() => {
    if (isHost && localFile && mediaSource) return 'local_host';
    if (!isHost && (viewerStream || webrtcStatus !== 'idle')) return 'webrtc_viewer';
    if (currentStreamUrl && !viewerStream) return 'hls_legacy';
    return 'idle';
  })();

  const canControl = isHost || userRole === 'co-host';
  const isLiveStream = mode === 'webrtc_viewer';

  // Socket sync (play/pause/seek) — control guarded for host/co-host; rate/seek bypass for live stream
  const { isBlocked, handleManualUnlock } = useSocketSync({
    videoRef,
    socket,
    roomId,
    canControl,
    isLiveStream,
  });

  // Reset retry/loading state when HLS stream changes
  useEffect(() => {
    if (currentStreamUrl && mode === 'hls_legacy') {
      setRetryCount(0);
      setPlaybackError(null);
      setIsLoading(true);
    }
  }, [currentStreamUrl, mode]);

  // Track elapsed seconds in 'connecting' status to offer retry
  useEffect(() => {
    if (mode === 'webrtc_viewer' && webrtcStatus === 'connecting') {
      setConnectingElapsed(0);
      const interval = setInterval(() => {
        setConnectingElapsed((s) => s + 1);
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setConnectingElapsed(0);
    }
  }, [mode, webrtcStatus]);

  // ── HOST MODE: Local file playback & WebRTC capture ────────────────────────
  useEffect(() => {
    if (mode !== 'local_host' || !videoRef.current || !mediaSource) return;

    const video = videoRef.current;
    let objectUrl: string;
    try {
      if (mediaSource.status === 'destroyed') {
        mediaSource.revive();
      }
      objectUrl = mediaSource.getObjectUrl();
    } catch (err) {
      console.error('[SyncVideoPlayer] Failed to get object URL:', err);
      setPlaybackError(
        `Cannot load video "${localFile?.name || 'selected file'}": ` +
        (err instanceof Error ? err.message : 'Media source unavailable.')
      );
      return;
    }

    objectUrlRef.current = objectUrl;
    video.src = objectUrl;
    video.load();
    setPlaybackError(null);
    captureStartedRef.current = false;

    // Begin captureStream only when the video element has loaded valid metadata
    const tryStartCapture = (forceRefresh: boolean = false) => {
      if (!videoRef.current) return;
      if (captureStartedRef.current && !forceRefresh) return;
      if (
        videoRef.current.readyState >= HTMLMediaElement.HAVE_METADATA &&
        (videoRef.current.videoWidth > 0 || videoRef.current.duration > 0)
      ) {
        captureStartedRef.current = true;
        console.log(`[SyncVideoPlayer] Host video metadata verified (forceRefresh=${forceRefresh}), updating WebRTC capture stream.`);
        startHostCapture(videoRef.current);
      }
    };

    const onCanPlay = () => {
      setIsBuffering(false);
      tryStartCapture();
    };

    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => {
      setIsBuffering(false);
      tryStartCapture(true); // Ensure audio tracks are refreshed on active playback
    };

    const onError = () => {
      const err = video.error;
      const msg = err
        ? `Media error (code ${err.code}): ${err.message || 'Unknown error'}.`
        : 'Unknown playback error.';
      setPlaybackError(
        `Cannot play "${localFile?.name}". ${msg} ` +
        `Check that the format is supported by your browser (try MP4 H.264).`
      );
    };

    const onLoadedMetadata = () => {
      tryStartCapture();
    };

    const onPlay = () => {
      tryStartCapture(true);
    };

    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('play', onPlay);

    // Initial check in case metadata was already loaded or cached
    tryStartCapture();

    return () => {
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('play', onPlay);
    };
  }, [mode, mediaSource, localFile, startHostCapture]);

  // ── VIEWER MODE: WebRTC stream attachment and autoplay policy handling ─────
  useEffect(() => {
    if (mode !== 'webrtc_viewer' || !videoRef.current) return;
    const video = videoRef.current;

    setHasVideoFrames(false);
    setIsMutedAutoplay(false);

    if (viewerStream) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.srcObject = viewerStream;

      const markFramesActive = () => {
        setIsBuffering(false);
        setHasVideoFrames(true);
        if (webrtcStatus !== 'connected') {
          console.log('[SyncVideoPlayer] Video frames verified playing. Ensuring webrtcStatus is connected.');
          setWebRTCStatus('connected');
        }
      };

      const onCanPlay = () => {
        setIsBuffering(false);
        if (video.videoWidth > 0 || video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          markFramesActive();
        }
      };

      const onPlaying = () => {
        markFramesActive();
      };

      const onLoadedData = () => {
        if (video.videoWidth > 0 || video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          markFramesActive();
        }
      };

      const onTimeUpdate = () => {
        if (video.currentTime > 0) {
          markFramesActive();
        }
      };

      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('playing', onPlaying);
      video.addEventListener('loadeddata', onLoadedData);
      video.addEventListener('timeupdate', onTimeUpdate);

      // Attempt playback; handle browser autoplay restriction gracefully
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('[SyncVideoPlayer] Unmuted viewer playback blocked by browser:', err);
          // Fall back to muted playback so video frames render immediately without user lockup
          video.muted = true;
          video.play().then(() => {
            console.log('[SyncVideoPlayer] Playing remote video stream in muted fallback mode.');
            setIsMutedAutoplay(true);
            markFramesActive();
          }).catch((fallbackErr) => {
            console.error('[SyncVideoPlayer] Muted playback also blocked:', fallbackErr);
          });
        });
      }

      return () => {
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('loadeddata', onLoadedData);
        video.removeEventListener('timeupdate', onTimeUpdate);
      };
    } else {
      video.srcObject = null;
    }

    return () => {
      if (video.srcObject) {
        video.srcObject = null;
      }
    };
  }, [mode, viewerStream]);

  // ── VIEWER MODE: Auto-unmute immediately upon first user interaction ────────
  useEffect(() => {
    if (!isMutedAutoplay || mode !== 'webrtc_viewer') return;

    const unmuteOnInteraction = () => {
      if (videoRef.current) {
        videoRef.current.muted = false;
        videoRef.current.volume = 1.0;
        setIsMutedAutoplay(false);
        console.log('[SyncVideoPlayer] Viewer audio automatically unmuted via user interaction.');
      }
    };

    window.addEventListener('click', unmuteOnInteraction, { capture: true, once: true });
    window.addEventListener('keydown', unmuteOnInteraction, { capture: true, once: true });
    window.addEventListener('touchstart', unmuteOnInteraction, { capture: true, once: true });

    return () => {
      window.removeEventListener('click', unmuteOnInteraction, { capture: true });
      window.removeEventListener('keydown', unmuteOnInteraction, { capture: true });
      window.removeEventListener('touchstart', unmuteOnInteraction, { capture: true });
    };
  }, [isMutedAutoplay, mode]);

  // ── LEGACY HLS MODE ────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'hls_legacy' || !videoRef.current || !currentStreamUrl) return;
    const video = videoRef.current;

    if (retryCount > 6) {
      queueMicrotask(() => {
        setPlaybackError('Failed to connect to the HLS stream. Verify that the backend server finished transcoding.');
        setIsLoading(false);
      });
      return;
    }

    let hls: Hls | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    let targetUrl = currentStreamUrl;
    if (targetUrl.startsWith('/')) {
      let backendUrl = import.meta.env.VITE_BACKEND_URL || '';
      if (backendUrl && !backendUrl.startsWith('http')) backendUrl = `https://${backendUrl}`;
      targetUrl = `${backendUrl}${targetUrl}`;
    } else if (!targetUrl.startsWith('http')) {
      targetUrl = `https://${targetUrl}`;
    }

    if (Hls.isSupported() && targetUrl.includes('.m3u8')) {
      hls = new Hls({
        maxBufferLength: 20,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 1000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        enableWorker: true,
        lowLatencyMode: false,
        startLevel: -1,
      });
      hlsRef.current = hls;
      hls.loadSource(targetUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('[SyncVideoPlayer] HLS manifest parsed.');
        setIsLoading(false);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('⚠️ HLS Network error encountered:', data);
              if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
                const delay = Math.min(3000 + retryCount * 2000, 15000);
                console.log(`🔄 Retrying HLS manifest in ${delay / 1000}s... (attempt ${retryCount + 1})`);
                hls?.destroy();
                hls = null;
                hlsRef.current = null;
                retryTimeout = setTimeout(() => {
                  setRetryCount((prev) => prev + 1);
                }, delay);
              } else {
                hls?.startLoad();
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error('❌ HLS Media error, trying to recover...', data);
              hls?.recoverMediaError();
              break;
            default:
              console.error('❌ Fatal HLS error:', data);
              hls?.destroy();
              hls = null;
              hlsRef.current = null;
              break;
          }
        }
      });
    } else {
      video.src = targetUrl;
      video.load();
      video.onloadedmetadata = () => setIsLoading(false);
      video.onerror = () => setIsLoading(false);
    }

    return () => {
      hls?.destroy();
      hlsRef.current = null;
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [mode, currentStreamUrl, retryCount]);

  // ── Buffering detection (all modes) ───────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    return () => {
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
    };
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <CustomVlcPlayer
      externalVideoRef={videoRef}
      canControl={canControl && mode !== 'webrtc_viewer'}
      className="shadow-2xl border border-white/10"
      externalDuration={isHost ? (mediaSource?.descriptor?.durationSeconds ?? videoRef.current?.duration ?? null) : streamDuration}
    >
      {/* Loading overlay: shown while HLS manifest is being fetched */}
      {mode === 'hls_legacy' && isLoading && !playbackError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-3 z-10">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          {retryCount > 0 && (
            <p className="text-xs text-text-secondary font-mono">
              Retrying connection... ({retryCount}/6)
            </p>
          )}
        </div>
      )}

      {/* State F: Video playing successfully badge */}
      {mode === 'webrtc_viewer' && webrtcStatus === 'connected' && hasVideoFrames && (
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm px-2.5 py-1.5 rounded-full border border-white/10 pointer-events-none select-none z-10">
          <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-[10px] text-cyan-300 font-bold tracking-widest uppercase">
            {streamMediaName ? `Streaming "${streamMediaName}" from host` : 'Streaming from host device'}
          </span>
        </div>
      )}

      {/* Muted Autoplay Recovery Pill */}
      {isMutedAutoplay && mode === 'webrtc_viewer' && (
        <div className="absolute top-3 left-3 z-30 animate-fade-in">
          <button
            onClick={() => {
              if (videoRef.current) {
                videoRef.current.muted = false;
                setIsMutedAutoplay(false);
              }
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-600/90 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg backdrop-blur-sm transition-all cursor-pointer"
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>Click to unmute video audio</span>
          </button>
        </div>
      )}

      {isViewer && mode === 'hls_legacy' && !isLoading && (
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-2.5 py-1.5 rounded-full border border-white/10 pointer-events-none select-none text-indigo-400">
          <Eye className="w-3.5 h-3.5" />
          <span className="text-[10px] font-bold tracking-wider uppercase">View Only</span>
        </div>
      )}

      {/* State A: Waiting for host media source */}
      {mode === 'idle' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-neutral-600 select-none">
          <span className="text-5xl opacity-20">🎬</span>
          <p className="text-sm font-semibold text-neutral-500">
            {isHost ? 'Select a video file to start streaming' : 'Host has not started a video yet'}
          </p>
          {!isHost && (
            <div className="flex items-center gap-2 text-xs text-neutral-600 font-mono">
              <Spinner size="sm" />
              <span>Waiting for host to select a file...</span>
            </div>
          )}
        </div>
      )}

      {/* State B: Waiting for WebRTC connection */}
      {mode === 'webrtc_viewer' && webrtcStatus === 'connecting' && !hasVideoFrames && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-neutral-950/80 backdrop-blur-sm animate-fade-in z-20">
          <Spinner size="md" />
          <p className="text-sm font-semibold text-neutral-300">Connecting to host stream...</p>
          <p className="text-xs text-neutral-500 font-mono">WebRTC negotiating... ({connectingElapsed}s)</p>
          {connectingElapsed >= 6 && (
            <Button
              onClick={retryViewerConnection}
              variant="secondary"
              className="mt-1 px-4 py-1.5 text-xs font-semibold"
            >
              🔄 Retry Connection
            </Button>
          )}
        </div>
      )}

      {/* State C: WebRTC connected but awaiting remote video track */}
      {mode === 'webrtc_viewer' && webrtcStatus === 'connected' && (!viewerStream || viewerStream.getVideoTracks().length === 0) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/80 backdrop-blur-sm animate-fade-in z-20">
          <Spinner size="md" />
          <p className="text-sm font-semibold text-cyan-300">Connected to host</p>
          <p className="text-xs text-neutral-400 font-mono">Awaiting remote video track from host...</p>
        </div>
      )}

      {/* State D: Remote track received but media not yet playable */}
      {mode === 'webrtc_viewer' && webrtcStatus === 'connected' && viewerStream && viewerStream.getVideoTracks().length > 0 && !hasVideoFrames && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950/70 backdrop-blur-sm animate-fade-in z-20">
          <Spinner size="md" />
          <p className="text-sm font-semibold text-neutral-200">Receiving video track...</p>
          <p className="text-xs text-neutral-400 font-mono">Decoding initial video frames...</p>
        </div>
      )}

      {/* Viewer: host disconnected */}
      {mode === 'webrtc_viewer' && webrtcStatus === 'host_disconnected' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-neutral-950/90 backdrop-blur-md animate-fade-in z-20">
          <span className="text-4xl">📡</span>
          <p className="text-sm font-bold text-amber-400">Host Disconnected</p>
          <p className="text-xs text-neutral-400 text-center max-w-[280px]">
            The host's video stream was interrupted. Waiting for them to reconnect...
          </p>
          <div className="flex items-center gap-2 text-xs text-neutral-500 font-mono">
            <Spinner size="sm" />
            <span>Reconnecting...</span>
          </div>
        </div>
      )}

      {/* Viewer: WebRTC failed */}
      {mode === 'webrtc_viewer' && webrtcStatus === 'failed' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-neutral-950/90 backdrop-blur-md animate-fade-in z-20">
          <span className="text-4xl">⚠️</span>
          <p className="text-sm font-bold text-red-400">Connection Failed</p>
          <p className="text-xs text-neutral-400 text-center max-w-[280px]">
            Could not establish WebRTC connection to the host. This may be a network issue (NAT, firewall, or missing TURN server).
          </p>
          <Button
            onClick={retryViewerConnection}
            variant="primary"
            className="px-6 py-2 text-xs"
          >
            🔄 Retry Connection
          </Button>
        </div>
      )}

      {/* State E: Video playback actively buffering */}
      {isBuffering && mode !== 'idle' && hasVideoFrames && (
        <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-sm px-3 py-1.5 rounded-full flex items-center gap-2 pointer-events-none animate-fade-in z-20">
          <Spinner size="sm" />
          <span className="text-[10px] text-neutral-300 font-mono">Buffering...</span>
        </div>
      )}

      {/* Playback error overlay */}
      {playbackError && (
        <div className="absolute inset-0 bg-bg-card border border-white/5 rounded-2xl flex flex-col items-center justify-center p-6 text-center z-50 animate-fade-in">
          <div className="h-14 w-14 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center mb-4 text-red-400">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <p className="text-sm font-bold text-red-400 mb-2">
            {mode === 'local_host' ? 'Playback Error' : 'Stream Offline or Unreachable'}
          </p>
          <p className="text-xs text-text-secondary max-w-[320px] leading-relaxed mb-5 font-medium font-sans">
            {playbackError}
          </p>
          <Button
            onClick={() => {
              setPlaybackError(null);
              setRetryCount(0);
            }}
            variant="brand"
            className="px-6 py-2 flex items-center justify-center gap-1.5 font-bold"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{mode === 'local_host' ? 'Retry Playback' : 'Retry Loading Stream'}</span>
          </Button>
        </div>
      )}

      {/* Autoplay blocked overlay (both host and viewers) */}
      {isBlocked && mode !== 'idle' && (
        <div className="absolute inset-0 bg-neutral-950/80 backdrop-blur-md flex flex-col items-center justify-center p-4 transition-all z-50 animate-fade-in">
          <div className="bg-bg-card border border-white/5 p-6 rounded-2xl max-w-sm text-center shadow-xl">
            <p className="text-sm text-text-secondary mb-4 font-medium font-sans">
              Your browser has paused the stream audio/video track due to autoplay policy. Click to play.
            </p>
            <Button
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.muted = false;
                  videoRef.current.play().catch(() => {});
                }
                handleManualUnlock();
              }}
              variant="brand"
              className="w-full py-2.5 flex items-center justify-center gap-1.5 font-bold"
            >
              <Zap className="w-4 h-4" />
              <span>Sync &amp; Play Stream</span>
            </Button>
          </div>
        </div>
      )}
    </CustomVlcPlayer>
  );
};

export default SyncVideoPlayer;
