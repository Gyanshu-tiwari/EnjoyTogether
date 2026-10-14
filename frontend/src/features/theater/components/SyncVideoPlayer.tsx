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
 *   - Shows "Streaming from host device" overlay
 *   - No independent seeking (host owns the timeline)
 *
 * LEGACY HLS MODE:
 *   - If currentStreamUrl is set and no localFile/viewerStream, falls back
 *   - Preserves backward compatibility with existing HLS-based rooms
 *
 * Security: the local File object never leaves this component.
 * The objectUrl is revoked when the component unmounts.
 */

import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { useTheater } from '../context/useTheater';
import { useSocketSync } from '../hooks/useSocketSync';
import { Spinner } from '@/shared/components/feedback/Spinner';
import { Button } from '@/shared/components/ui/Button';
import { Eye, AlertTriangle, RefreshCw, Zap, Loader2 } from 'lucide-react';

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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRetryCount(0);
      setPlaybackError(null);
      setIsLoading(true);
    }
  }, [currentStreamUrl, mode]);

  // ── HOST MODE: Local file playback & WebRTC capture ────────────────────────
  useEffect(() => {
    if (mode !== 'local_host' || !videoRef.current || !mediaSource) return;

    const video = videoRef.current;
    const objectUrl = mediaSource.getObjectUrl();
    objectUrlRef.current = objectUrl;

    video.src = objectUrl;
    video.load();
    setPlaybackError(null);
    captureStartedRef.current = false;

    const onCanPlay = () => {
      setIsBuffering(false);
    };

    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);

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

    // Begin captureStream as soon as the video element can produce frames
    const onLoadedMetadata = () => {
      if (!captureStartedRef.current && videoRef.current) {
        captureStartedRef.current = true;
        console.log('[SyncVideoPlayer] Host video metadata loaded, starting capture stream.');
        startHostCapture(videoRef.current);
      }
    };

    const onPlay = () => {
      if (!captureStartedRef.current && videoRef.current) {
        captureStartedRef.current = true;
        console.log('[SyncVideoPlayer] Host video play started, starting capture stream.');
        startHostCapture(videoRef.current);
      }
    };

    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('play', onPlay);

    return () => {
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('play', onPlay);
      // Do NOT revoke objectUrl here — mediaSource.destroy() handles it
    };
  }, [mode, mediaSource, localFile, startHostCapture]);

  // ── VIEWER MODE: WebRTC stream ─────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'webrtc_viewer' || !videoRef.current) return;
    const video = videoRef.current;

    if (viewerStream) {
      // Clean up any HLS instance
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.srcObject = viewerStream;
      video.play().catch((err) => {
        console.warn('[SyncVideoPlayer] Viewer autoplay blocked:', err);
      });
    } else {
      video.srcObject = null;
    }

    return () => {
      if (video.srcObject) {
        video.srcObject = null;
      }
    };
  }, [mode, viewerStream]);

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
    <div className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/10 group">
      <video
        ref={videoRef}
        controls={isHost || mode === 'hls_legacy'} // Viewers don't get native controls
        className="w-full h-full object-contain"
        playsInline
        preload="metadata"
      />

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

      {/* Viewer mode overlay badges */}
      {mode === 'webrtc_viewer' && webrtcStatus === 'connected' && (
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm px-2.5 py-1.5 rounded-full border border-white/10 pointer-events-none select-none">
          <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-[10px] text-cyan-300 font-bold tracking-widest uppercase">Streaming from host device</span>
        </div>
      )}

      {isViewer && mode === 'hls_legacy' && !isLoading && (
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-2.5 py-1.5 rounded-full border border-white/10 pointer-events-none select-none text-indigo-400">
          <Eye className="w-3.5 h-3.5" />
          <span className="text-[10px] font-bold tracking-wider uppercase">View Only</span>
        </div>
      )}

      {/* Idle: no video selected yet */}
      {mode === 'idle' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-neutral-600 select-none">
          <span className="text-5xl opacity-20">🎬</span>
          <p className="text-sm font-semibold text-neutral-500">
            {isHost ? 'Select a video file to start streaming' : 'Waiting for host to start streaming...'}
          </p>
          {!isHost && (
            <div className="flex items-center gap-2 text-xs text-neutral-600 font-mono">
              <Spinner size="sm" />
              <span>Waiting for host...</span>
            </div>
          )}
        </div>
      )}

      {/* Viewer: connecting to host */}
      {mode === 'webrtc_viewer' && webrtcStatus === 'connecting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-neutral-950/80 backdrop-blur-sm animate-fade-in">
          <Spinner size="md" />
          <p className="text-sm font-semibold text-neutral-300">Connecting to host stream...</p>
          <p className="text-xs text-neutral-500 font-mono">WebRTC negotiating...</p>
        </div>
      )}

      {/* Viewer: host disconnected */}
      {mode === 'webrtc_viewer' && webrtcStatus === 'host_disconnected' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-neutral-950/90 backdrop-blur-md animate-fade-in">
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-neutral-950/90 backdrop-blur-md animate-fade-in">
          <span className="text-4xl">⚠️</span>
          <p className="text-sm font-bold text-red-400">Connection Failed</p>
          <p className="text-xs text-neutral-400 text-center max-w-[280px]">
            Could not establish WebRTC connection to the host. This may be a network issue (NAT, firewall, or missing TURN server).
          </p>
          <Button
            onClick={() => setWebRTCStatus('connecting')}
            variant="primary"
            className="px-6 py-2 text-xs"
          >
            🔄 Retry Connection
          </Button>
        </div>
      )}

      {/* Buffering overlay */}
      {isBuffering && mode !== 'idle' && (
        <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-sm px-3 py-1.5 rounded-full flex items-center gap-2 pointer-events-none animate-fade-in">
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
          <p className="text-sm font-bold text-red-400 mb-2">Stream Offline or Unreachable</p>
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
            <span>Retry Loading Stream</span>
          </Button>
        </div>
      )}

      {/* Autoplay blocked overlay (non-viewer) */}
      {isBlocked && mode !== 'idle' && !isViewer && (
        <div className="absolute inset-0 bg-neutral-950/80 backdrop-blur-md flex flex-col items-center justify-center p-4 transition-all z-50 animate-fade-in">
          <div className="bg-bg-card border border-white/5 p-6 rounded-2xl max-w-sm text-center shadow-xl">
            <p className="text-sm text-text-secondary mb-4 font-medium font-sans">
              Your browser has paused the synchronized stream track to protect connection overhead. Click to sync and play.
            </p>
            <Button
              onClick={handleManualUnlock}
              variant="brand"
              className="w-full py-2.5 flex items-center justify-center gap-1.5 font-bold"
            >
              <Zap className="w-4 h-4" />
              <span>Sync &amp; Play Stream</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SyncVideoPlayer;
