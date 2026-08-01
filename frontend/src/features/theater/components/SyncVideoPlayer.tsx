import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { useTheater } from '../context/useTheater';
import { useSocketSync } from '../hooks/useSocketSync';

import { Button } from '@/shared/components/ui/Button';
import { Eye, AlertTriangle, RefreshCw, Zap, Loader2 } from 'lucide-react';

export const SyncVideoPlayer: React.FC = () => {
  const { currentStreamUrl, socket, roomId, userRole } = useTheater();
  const isViewer = userRole === 'viewer';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const { isBlocked, handleManualUnlock } = useSocketSync({
    videoRef,
    socket,
    roomId,
  });

  const [prevStreamUrl, setPrevStreamUrl] = useState(currentStreamUrl);
  const [prevRetryCount, setPrevRetryCount] = useState(retryCount);

  if (currentStreamUrl !== prevStreamUrl) {
    setPrevStreamUrl(currentStreamUrl);
    setRetryCount(0);
    setPlaybackError(null);
    setIsLoading(true);
  } else if (retryCount !== prevRetryCount) {
    setPrevRetryCount(retryCount);
    setIsLoading(true);
  }

  // HLS stream decoding lifecycle
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentStreamUrl || playbackError) return;

    if (retryCount > 8) {
      Promise.resolve().then(() => {
        setPlaybackError("Failed to connect to the stream. Verify that your backend server finished transcoding and the stream exists.");
        setIsLoading(false);
      });
      return;
    }

    let hls: Hls | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    let targetUrl = currentStreamUrl;
    if (targetUrl.startsWith('/')) {
      let backendUrl = import.meta.env.VITE_BACKEND_URL || '';
      if (backendUrl && !backendUrl.startsWith('http')) {
        backendUrl = `https://${backendUrl}`;
      }
      targetUrl = `${backendUrl}${targetUrl}`;
    } else if (!targetUrl.startsWith('http')) {
      targetUrl = `https://${targetUrl}`;
    }

    console.log("🎬 Loading stream asset source target:", targetUrl);

    if (Hls.isSupported() && targetUrl.includes('.m3u8')) {
      hls = new Hls({
        // Buffer management — prevents stalls without using excessive memory
        maxBufferLength: 20,              // buffer up to 20s ahead (not 30 default)
        maxMaxBufferLength: 60,           // hard cap at 60s
        maxBufferSize: 60 * 1000 * 1000, // 60 MB cap
        maxBufferHole: 0.5,              // auto-fill buffer holes up to 0.5s

        // Manifest & segment retry — handles transient network blips
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 1000,
        manifestLoadingMaxRetryTimeout: 32_000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,

        // Performance
        enableWorker: true,              // parse on a separate thread
        lowLatencyMode: false,           // VOD mode, not live
        startLevel: -1,                  // auto quality selection
      });
      hls.loadSource(targetUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log("✅ HLS Manifest loaded and parsed successfully via hls.js!");
        setIsLoading(false);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn("⚠️ HLS Network error encountered:", data);
              if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
                // Exponential backoff: 3s, 5s, 8s, 13s...
                const delay = Math.min(3000 + retryCount * 2500, 15000);
                console.log(`🔄 Retrying HLS manifest in ${delay / 1000}s... (attempt ${retryCount + 1})`);
                hls?.destroy();
                hls = null;
                retryTimeout = setTimeout(() => {
                  setRetryCount((prev) => prev + 1);
                }, delay);
              } else {
                hls?.startLoad();
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error("❌ HLS Media error, trying to recover...", data);
              hls?.recoverMediaError();
              break;
            default:
              console.error("❌ Fatal HLS error:", data);
              hls?.destroy();
              hls = null;
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
      if (hls) hls.destroy();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [currentStreamUrl, videoRef, retryCount, playbackError]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/10 group">
      <video
        ref={videoRef}
        controls={!isViewer}
        className="w-full h-full object-contain"
        playsInline
      />

      {/* Loading overlay: shown while HLS manifest is being fetched */}
      {isLoading && !playbackError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-3 z-10">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          {retryCount > 0 && (
            <p className="text-xs text-text-secondary font-mono">
              Retrying connection... ({retryCount}/8)
            </p>
          )}
        </div>
      )}

      {/* Viewer-only overlay: no controls exposed */}
      {isViewer && !isLoading && (
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-2.5 py-1.5 rounded-full border border-white/10 pointer-events-none select-none text-indigo-400">
          <Eye className="w-3.5 h-3.5" />
          <span className="text-[10px] font-bold tracking-wider uppercase">View Only</span>
        </div>
      )}

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

      {isBlocked && !isViewer && (
        <div className="absolute inset-0 bg-neutral-950/80 backdrop-blur-md flex flex-col items-center justify-center p-4 transition-all z-50 animate-fade-in">
          <div className="bg-bg-card border border-white/5 p-6 rounded-2xl max-w-sm text-center shadow-xl">
            <p className="text-sm text-text-secondary mb-4 font-medium font-sans">
              Your browser has paused the synchronized stream track to protect connection overhead.
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

