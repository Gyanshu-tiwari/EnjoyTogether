import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { useTheater } from '../context/useTheater';
import { useSocketSync } from '../hooks/useSocketSync';
import { getTranscodeStatus } from '../api/theaterApi';
import { Spinner } from '@/shared/components/feedback/Spinner';
import { Button } from '@/shared/components/ui/Button';

export const SyncVideoPlayer: React.FC = () => {
  const { currentStreamUrl, socket, roomId, userRole } = useTheater();
  const isViewer = userRole === 'viewer';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [transcodeProgress, setTranscodeProgress] = useState<number>(0);
  const [transcodeEta, setTranscodeEta] = useState<string>('');
  const [transcodeStatus, setTranscodeStatus] = useState<string>('');
  const [transcodeSpeed, setTranscodeSpeed] = useState<string>('');

  const { isBlocked, handleManualUnlock } = useSocketSync({
    videoRef,
    socket,
    roomId,
  });

  // Unified transcode status polling — starts immediately, then polls every 2s.
  // Runs only while isProcessing is true. Merges the old "initial check" + "interval" pattern
  // into one effect to eliminate the double-fetch on mount.
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const fetchStatus = async () => {
      try {
        const data = await getTranscodeStatus();
        if (cancelled) return;
        if (data.status && data.status !== 'idle') {
          setIsProcessing(data.status !== 'complete');
          setTranscodeStatus(data.status);
          setTranscodeProgress(data.progress);
          setTranscodeEta(data.eta);
          setTranscodeSpeed(data.speed);
        }
      } catch (err) {
        if (!cancelled) console.error('Failed to fetch transcode status:', err);
      }
    };

    // Fire immediately on mount, then every 2s
    fetchStatus();
    interval = setInterval(fetchStatus, 2000);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, []);

  // HLS stream decoding lifecycle
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentStreamUrl || playbackError) return;

    if (retryCount > 6) {
      Promise.resolve().then(() => {
        setPlaybackError("Failed to connect to the stream. Verify that your backend server finished transcoding and the stream exists.");
        setIsProcessing(false);
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
        setIsProcessing(false);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn("⚠️ HLS Network error encountered:", data);
              if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
                setIsProcessing(true);
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

      {isProcessing && (
        <div className="absolute inset-0 bg-neutral-950/90 backdrop-blur-md flex flex-col items-center justify-center p-4 transition-all z-40 animate-fade-in">
          <div className="flex flex-col items-center gap-4 text-center">
            <Spinner size="md" />
            <p className="text-sm font-semibold text-neutral-200">
              {transcodeStatus === 'uploading' 
                ? 'Uploading Video File to Server...' 
                : transcodeStatus === 'uploading_segments' 
                ? 'Uploading Video Segments...' 
                : 'Transcoding Video Stream...'}
            </p>
            {transcodeStatus === 'encoding' && (
              <div className="w-64">
                <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden border border-white/5 mt-1">
                  <div
                    className="h-full bg-linear-to-r from-cyan-400 to-blue-500 rounded-full transition-all duration-300"
                    style={{ width: `${transcodeProgress}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-neutral-400 mt-2 font-mono">
                  <span>{transcodeProgress}% ({transcodeSpeed})</span>
                  <span>ETA: {transcodeEta}</span>
                </div>
              </div>
            )}
            <p className="text-xs text-neutral-400 max-w-[280px] leading-relaxed">
              The high-fidelity video processing pipeline is running in the background. It will start playing automatically once ready.
            </p>
          </div>
        </div>
      )}

      {isBlocked && !isProcessing && !isViewer && (
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
