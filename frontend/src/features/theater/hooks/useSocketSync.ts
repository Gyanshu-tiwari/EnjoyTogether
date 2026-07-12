import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';

interface UseSocketSyncParams {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  socket: Socket | null;
  roomId: string;
}

interface SyncState {
  isPlaying: boolean;
  position: number;
  serverTimestamp?: number; // Injected by backend for latency compensation
}

export function useSocketSync({ videoRef, socket, roomId }: UseSocketSyncParams) {
  // isSyncingRef: true during programmatic play/pause so our own video events don't echo back
  const isSyncingRef = useRef<boolean>(false);
  const lastSyncedRef = useRef<SyncState | null>(null);
  const [isBlocked, setIsBlocked] = useState<boolean>(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !socket) return;

    const handleSyncState = (state: SyncState) => {
      lastSyncedRef.current = state;
      isSyncingRef.current = true;

      // ── Latency Compensation ────────────────────────────────────────────────
      // The backend stamps serverTimestamp on every sync-state emit.
      // We add the one-way network latency to the position so viewers
      // start playback from where the host *actually is* right now.
      const networkLatencyMs = state.serverTimestamp
        ? Math.max(0, Date.now() - state.serverTimestamp)
        : 0;
      const latencyCompensatedPosition = state.position + networkLatencyMs / 1000;

      const timeDiff = Math.abs(video.currentTime - latencyCompensatedPosition);

      if (timeDiff > 2.0) {
        // Hard sync: snap immediately — viewer is more than 2s off
        video.currentTime = latencyCompensatedPosition;
      } else if (timeDiff > 0.3) {
        // Soft sync: nudge playback rate to converge smoothly over ~3s
        const nudge = video.currentTime < latencyCompensatedPosition ? 1.05 : 0.95;
        video.playbackRate = nudge;
        setTimeout(() => {
          if (video) video.playbackRate = 1.0;
        }, 3000);
      }
      // < 0.3s: within acceptable tolerance, no correction needed

      if (state.isPlaying && video.paused) {
        video
          .play()
          .then(() => setIsBlocked(false))
          .catch(() => setIsBlocked(true))
          .finally(() => {
            setTimeout(() => { isSyncingRef.current = false; }, 200);
          });
      } else {
        if (!state.isPlaying && !video.paused) {
          video.pause();
        }
        setTimeout(() => { isSyncingRef.current = false; }, 200);
      }
    };

    socket.on('sync-state', handleSyncState);

    const emitMediaAction = (e: Event) => {
      // Skip: we're processing an incoming sync event ourselves
      if (isSyncingRef.current) return;

      const isPlaying = !video.paused;
      const position  = video.currentTime;

      // Skip: state hasn't meaningfully changed since last emit
      if (lastSyncedRef.current) {
        const timeDiff = Math.abs(position - lastSyncedRef.current.position);
        const playStateMatches = isPlaying === lastSyncedRef.current.isPlaying;

        if (e.type === 'seeked' && timeDiff < 1.5) return;
        if ((e.type === 'play' || e.type === 'pause') && playStateMatches) return;
      }

      console.log(`📡 Emitting media action: type=${e.type} pos=${position.toFixed(2)}s playing=${isPlaying}`);

      lastSyncedRef.current = { isPlaying, position };

      // Use the specific new events — backend routes these through RBAC assertCanControl
      if (e.type === 'play') {
        socket.emit('video:play', { roomId, position });
      } else if (e.type === 'pause') {
        socket.emit('video:pause', { roomId, position });
      } else if (e.type === 'seeked') {
        socket.emit('video:seek', { roomId, position });
      } else {
        // Legacy fallback
        socket.emit('media-action', { roomId, isPlaying, position });
      }
    };

    video.addEventListener('play', emitMediaAction);
    video.addEventListener('pause', emitMediaAction);
    video.addEventListener('seeked', emitMediaAction);

    return () => {
      video.removeEventListener('play', emitMediaAction);
      video.removeEventListener('pause', emitMediaAction);
      video.removeEventListener('seeked', emitMediaAction);
      socket.off('sync-state', handleSyncState);
    };
  }, [socket, roomId, videoRef]);

  const handleManualUnlock = () => {
    const video = videoRef.current;
    if (!video || !socket) return;

    video
      .play()
      .then(() => {
        setIsBlocked(false);
        const position = video.currentTime;
        lastSyncedRef.current = { isPlaying: true, position };
        socket.emit('video:play', { roomId, position });
      })
      .catch((err) => console.error('Media activation loop faulted:', err));
  };

  return { isBlocked, handleManualUnlock };
}
