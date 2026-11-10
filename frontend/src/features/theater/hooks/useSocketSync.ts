/**
 * useSocketSync.ts
 * ────────────────
 * Listens for authoritative sync-state events from the server and
 * applies them to the local <video> element.
 *
 * Also emits video:play / video:pause / video:seek from the local
 * <video> element's events (for the Host side).
 *
 * State version guard:
 * - Every sync-state now carries a stateVersion counter.
 * - We reject any incoming state whose version is ≤ our current version
 *   to prevent stale/delayed messages from overwriting newer state.
 *
 * Latency compensation:
 * - Backend stamps serverTimestamp on every sync-state emit.
 * - We add the one-way network latency to the position so viewers
 *   start playback from where the host *actually is* right now.
 */

import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';

interface UseSocketSyncParams {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  socket: Socket | null;
  roomId: string;
  canControl?: boolean;
  isLiveStream?: boolean;
}

interface SyncState {
  isPlaying: boolean;
  position: number;
  serverTimestamp?: number; // Injected by backend for latency compensation
  stateVersion?: number;    // Monotonic counter — reject if ≤ current
}

export function useSocketSync({
  videoRef,
  socket,
  roomId,
  canControl = true,
  isLiveStream = false,
}: UseSocketSyncParams) {
  // isSyncingRef: true during programmatic play/pause so our own video events don't echo back
  const isSyncingRef = useRef<boolean>(false);
  const isSeekingProgrammaticallyRef = useRef<boolean>(false);
  const lastSyncedRef = useRef<SyncState | null>(null);
  // Track the highest received stateVersion to reject stale messages
  const lastStateVersionRef = useRef<number>(-1);
  const [isBlocked, setIsBlocked] = useState<boolean>(false);

  // Authoritative room timeline position for live WebRTC stream playback
  const [moviePosition, setMoviePosition] = useState<number>(0);
  const [roomIsPlaying, setRoomIsPlaying] = useState<boolean>(false);
  const moviePosRef = useRef<number>(0);
  const roomIsPlayingRef = useRef<boolean>(false);
  const lastSyncTimeRef = useRef<number>(Date.now());

  const playbackRateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live stream timeline ticker: advances moviePosition forward when room is actively playing
  useEffect(() => {
    if (!isLiveStream) return;
    const interval = setInterval(() => {
      if (roomIsPlayingRef.current) {
        const elapsed = (Date.now() - lastSyncTimeRef.current) / 1000;
        setMoviePosition(moviePosRef.current + elapsed);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [isLiveStream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !socket) return;

    const handleSyncState = (state: SyncState) => {
      // ── stateVersion guard ───────────────────────────────────────────────
      const incomingVersion = state.stateVersion ?? 0;
      if (incomingVersion <= lastStateVersionRef.current) {
        console.warn(
          `[useSocketSync] Discarding stale sync-state v${incomingVersion} ` +
          `(current: v${lastStateVersionRef.current}).`
        );
        return;
      }
      lastStateVersionRef.current = incomingVersion;
      lastSyncedRef.current = state;
      isSyncingRef.current = true;

      // Update live stream playback clock
      moviePosRef.current = state.position;
      roomIsPlayingRef.current = state.isPlaying;
      lastSyncTimeRef.current = Date.now();
      setMoviePosition(state.position);
      setRoomIsPlaying(state.isPlaying);

      // DO NOT seek or nudge rate on live WebRTC stream!
      // In WebRTC mode, frames stream in real-time from the Host's playhead.
      if (!isLiveStream) {
        const networkLatencyMs = state.serverTimestamp
          ? Math.max(0, Date.now() - state.serverTimestamp)
          : 0;
        const latencyCompensatedPosition = state.position + networkLatencyMs / 1000;

        const timeDiff = Math.abs(video.currentTime - latencyCompensatedPosition);

        if ((state as any).isSeek || timeDiff > 1.0 || (!state.isPlaying && timeDiff > 0.1)) {
          // Hard sync: snap immediately — seek triggered or notable drift
          isSeekingProgrammaticallyRef.current = true;
          video.currentTime = latencyCompensatedPosition;
          const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            setTimeout(() => {
              isSeekingProgrammaticallyRef.current = false;
              isSyncingRef.current = false;
            }, 100);
          };
          video.addEventListener('seeked', onSeeked, { once: true });
          setTimeout(() => {
            isSeekingProgrammaticallyRef.current = false;
            isSyncingRef.current = false;
          }, 2500);
        } else if (timeDiff > 0.3) {
          // Soft sync: nudge playback rate to converge smoothly over ~3s
          const nudge = video.currentTime < latencyCompensatedPosition ? 1.05 : 0.95;
          video.playbackRate = nudge;
          if (playbackRateTimeoutRef.current) clearTimeout(playbackRateTimeoutRef.current);
          playbackRateTimeoutRef.current = setTimeout(() => {
            if (videoRef.current) videoRef.current.playbackRate = 1.0;
          }, 3000);
        }
      }

      if (state.isPlaying && video.paused) {
        video
          .play()
          .then(() => setIsBlocked(false))
          .catch(() => setIsBlocked(true))
          .finally(() => {
            if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
            syncTimeoutRef.current = setTimeout(() => {
              if (!isSeekingProgrammaticallyRef.current) {
                isSyncingRef.current = false;
              }
            }, 300);
          });
      } else if (!state.isPlaying && !video.paused) {
        video.pause();
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = setTimeout(() => {
          if (!isSeekingProgrammaticallyRef.current) {
            isSyncingRef.current = false;
          }
        }, 300);
      } else {
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = setTimeout(() => {
          if (!isSeekingProgrammaticallyRef.current) {
            isSyncingRef.current = false;
          }
        }, 300);
      }
    };

    socket.on('sync-state', handleSyncState);

    const emitMediaAction = (e: Event) => {
      // Viewers must never broadcast play/pause/seek events to the room
      if (!canControl) return;

      // Skip: we're processing an incoming sync or seek event ourselves
      if (isSyncingRef.current || isSeekingProgrammaticallyRef.current) return;

      const isPlaying = !video.paused;
      const position  = video.currentTime;

      // Skip: state hasn't meaningfully changed since last emit
      if (lastSyncedRef.current) {
        const timeDiff = Math.abs(position - lastSyncedRef.current.position);
        const playStateMatches = isPlaying === lastSyncedRef.current.isPlaying;

        if (e.type === 'seeked' && timeDiff < 1.5) return;
        if ((e.type === 'play' || e.type === 'pause') && playStateMatches) return;
      }

      console.log(`[useSocketSync] Emitting: type=${e.type} pos=${position.toFixed(2)}s playing=${isPlaying}`);

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

    // Only host/legacy media attaches native DOM video event listeners
    // For live WebRTC viewers, playback events are controlled via CustomVlcPlayer callbacks
    if (canControl && !isLiveStream) {
      video.addEventListener('play', emitMediaAction);
      video.addEventListener('pause', emitMediaAction);
      video.addEventListener('seeked', emitMediaAction);
    }

    return () => {
      if (canControl && !isLiveStream) {
        video.removeEventListener('play', emitMediaAction);
        video.removeEventListener('pause', emitMediaAction);
        video.removeEventListener('seeked', emitMediaAction);
      }
      socket.off('sync-state', handleSyncState);
      if (playbackRateTimeoutRef.current) clearTimeout(playbackRateTimeoutRef.current);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [socket, roomId, videoRef, canControl, isLiveStream]);

  const handleManualUnlock = () => {
    const video = videoRef.current;
    if (!video || !socket) return;

    video
      .play()
      .then(() => {
        setIsBlocked(false);
        const position = isLiveStream ? moviePosition : video.currentTime;
        lastSyncedRef.current = { isPlaying: true, position };
        socket.emit('video:play', { roomId, position });
      })
      .catch((err) => console.error('[useSocketSync] Manual unlock failed:', err));
  };

  return { isBlocked, handleManualUnlock, moviePosition, roomIsPlaying, setMoviePosition };
}
