import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';

interface UseSocketSyncParams {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  socket: Socket | null;
  roomId: string;
}

export function useSocketSync({ videoRef, socket, roomId }: UseSocketSyncParams) {
  const isSyncingRef = useRef<boolean>(false);
  const lastSyncedRef = useRef<{ isPlaying: boolean; position: number } | null>(null);
  const [isBlocked, setIsBlocked] = useState<boolean>(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !socket) return;

    const handleSyncState = (state: { isPlaying: boolean; position: number }) => {
      lastSyncedRef.current = state;
      isSyncingRef.current = true;

      const timeDiff = Math.abs(video.currentTime - state.position);
      if (timeDiff > 1.5) {
        video.currentTime = state.position;
      }

      if (state.isPlaying && video.paused) {
        video.play()
          .then(() => {
            setIsBlocked(false);
          })
          .catch((err) => {
            console.log('Browser autoplay restrictions caught:', err);
            setIsBlocked(true);
          })
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
      if (isSyncingRef.current) return;

      const isPlaying = !video.paused;
      const position = video.currentTime;

      if (lastSyncedRef.current) {
        const timeDiff = Math.abs(position - lastSyncedRef.current.position);
        const playStateMatches = isPlaying === lastSyncedRef.current.isPlaying;
        
        if (e.type === 'seeked' && timeDiff < 1.5) {
          return;
        }
        if ((e.type === 'play' || e.type === 'pause') && playStateMatches) {
          return;
        }
      }

      console.log(`📡 Shipping verified state: Type -> ${e.type}, Timestamp -> ${position}s`);

      lastSyncedRef.current = { isPlaying, position };

      socket.emit('media-action', {
        roomId,
        isPlaying,
        position,
      });
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
    
    video.play()
      .then(() => {
        setIsBlocked(false);
        const isPlaying = true;
        const position = video.currentTime;
        
        lastSyncedRef.current = { isPlaying, position };
        
        socket.emit('media-action', { 
          roomId, 
          isPlaying, 
          position 
        });
      })
      .catch(err => console.error("Media activation loop faulted:", err));
  };

  return { isBlocked, handleManualUnlock };
}
