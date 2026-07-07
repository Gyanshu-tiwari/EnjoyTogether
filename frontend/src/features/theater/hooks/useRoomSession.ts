import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { getRoomMetadata, toggleRoomActive } from '../api/theaterApi';
import axios from 'axios';


type SessionState = 'idle_host' | 'idle_guest' | 'knocking' | 'rejected' | 'active_session';

interface RoomSessionResult {
  sessionState: SessionState;
  setSessionState: React.Dispatch<React.SetStateAction<SessionState>>;
  isHost: boolean;
  loading: boolean;
  dbError: string | null;
  currentStreamUrl: string;
  setCurrentStreamUrl: (url: string) => void;
  startSession: () => Promise<void>;
  endSession: () => Promise<void>;
}

const getAnonymousUserId = () => {
  let anonId = localStorage.getItem('et_anon_user_id');
  if (!anonId) {
    anonId = 'anon_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('et_anon_user_id', anonId);
  }
  return anonId;
};


export function useRoomSession(roomId: string, isHostProp?: boolean, initialStreamUrl?: string): RoomSessionResult {

  const [sessionState, setSessionState] = useState<SessionState>('idle_guest');
  const [isHost, setIsHost] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [currentStreamUrl, setCurrentStreamUrl] = useState(initialStreamUrl || '');
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync stream URL and roomId from prop changes using derived state pattern
  const [prevRoomId, setPrevRoomId] = useState(roomId);
  const [prevInitialStreamUrl, setPrevInitialStreamUrl] = useState(initialStreamUrl);
  if (roomId !== prevRoomId || initialStreamUrl !== prevInitialStreamUrl) {
    setPrevRoomId(roomId);
    setPrevInitialStreamUrl(initialStreamUrl);
    if (initialStreamUrl) {
      setCurrentStreamUrl(initialStreamUrl);
    }
  }

  // 1. Initial mount: check room status and determine host identity
  useEffect(() => {
    let cancelled = false;
    const checkRoomStatus = async () => {
      try {
        setLoading(true);
        setDbError(null);
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id || getAnonymousUserId();

        const response = await getRoomMetadata(roomId);
        const room = response.metadata;

        if (cancelled) return;

        if (room) {
          const matchedHost = isHostProp !== undefined ? isHostProp : room.host_id === userId;
          setIsHost(matchedHost);

          if (room.movie_url) setCurrentStreamUrl(room.movie_url);

          if (room.is_active) {
            setSessionState(matchedHost ? 'active_session' : 'knocking');
          } else {
            setSessionState(matchedHost ? 'idle_host' : 'idle_guest');
          }
        }
      } catch (err) {
        if (!cancelled) console.error('❌ Failed to look up room lifecycle status:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    checkRoomStatus();
    return () => { cancelled = true; };
  }, [roomId, isHostProp]);

  // 2. Polling for idle guests — increased to 3s to reduce server load
  useEffect(() => {
    if (sessionState !== 'idle_guest' || dbError) return;

    // Fix #4: Capture interval in ref to avoid race between async callback and cleanup
    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await getRoomMetadata(roomId);
        const room = response.metadata;
        if (room?.is_active) {
          console.log('📡 Guest detected active session! Transitioning to knocking...');
          if (room.movie_url) setCurrentStreamUrl(room.movie_url);
          setSessionState('knocking');
        }
      } catch (err) {
        if (axios.isAxiosError(err)) {
          if (err.response?.status === 404) {
            setDbError('Room session not found.');
            clearInterval(pollIntervalRef.current!);
            pollIntervalRef.current = null;
            return;
          }
        }
        console.error('Error polling room status:', err);
      }
    }, 3000); // Fix #14: 3s instead of 2s

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [sessionState, roomId, dbError]);

  const startSession = useCallback(async () => {
    try {
      setLoading(true);
      await toggleRoomActive(roomId, true);
      setSessionState('active_session');
    } catch (err) {
      console.error('❌ Failed to start room session:', err);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  const endSession = useCallback(async () => {
    try {
      setLoading(true);
      await toggleRoomActive(roomId, false);
      setSessionState('idle_host');
    } catch (err) {
      console.error('❌ Failed to end room session:', err);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  return { sessionState, setSessionState, isHost, loading, dbError, currentStreamUrl, setCurrentStreamUrl, startSession, endSession };
}

export { getAnonymousUserId };
