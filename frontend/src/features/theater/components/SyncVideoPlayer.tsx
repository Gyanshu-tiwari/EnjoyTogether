import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { useTheater } from '../context/useTheater';
import { useSocketSync } from '../hooks/useSocketSync';

import { Button } from '@/shared/components/ui/Button';

export const SyncVideoPlayer: React.FC = () => {
  const { currentStreamUrl, socket, roomId, userRole } = useTheater();
  const isViewer = userRole === 'viewer';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const { isBlocked, handleManualUnlock } = useSocketSync({
    videoRef,
    socket,
    roomId,
  });



  // HLS stream decoding lifecycle
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentStreamUrl || playbackError) return;

    if (retryCount > 6) {
      Promise.resolve().then(() => {
        setPlaybackError("Failed to connect to the stream. Verify that your backend server finished transcoding and the stream exists.");
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
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn("⚠️ HLS Network error encountered:", data);
              if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
                console.log("🔄 Retrying to load HLS manifest in 3 seconds...");
                hls?.destroy();
                hls = null;
                retryTimeout = setTimeout(() => {
                  setRetryCount((prev) => prev + 1);
                }, 3000);
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

      {/* Viewer-only overlay: no controls exposed */}
      {isViewer && (
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/10 pointer-events-none select-none">
          <span className="text-[10px] text-purple-300 font-semibold tracking-widest uppercase">👁 View Only</span>
        </div>
      )}

      {playbackError && (
        <div className="absolute inset-0 bg-neutral-950/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-50 animate-fade-in">
          <span className="text-3xl mb-3">⚠️</span>
          <p className="text-sm font-bold text-red-400 mb-2">Stream Offline or Unreachable</p>
          <p className="text-xs text-neutral-300 max-w-[320px] leading-relaxed mb-4">
            {playbackError}
          </p>
          <Button
            onClick={() => {
              setPlaybackError(null);
              setRetryCount(0);
            }}
            variant="primary"
            className="px-6 py-2"
          >
            🔄 Retry Loading Stream
          </Button>
        </div>
      )}



      {isBlocked && !isViewer && (
        <div className="absolute inset-0 bg-neutral-950/80 backdrop-blur-md flex flex-col items-center justify-center p-4 transition-all z-50">
          <div className="bg-white/5 border border-white/10 p-6 rounded-2xl max-w-sm text-center shadow-xl">
            <p className="text-sm text-neutral-300 mb-4 font-medium">
              Your browser has paused the synchronized stream track to protect connection overhead.
            </p>
            <Button
              onClick={handleManualUnlock}
              variant="primary"
              className="w-full py-2.5"
            >
              ⚡ Sync & Play Stream
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
