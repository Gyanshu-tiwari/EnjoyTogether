import { useEffect, useRef, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import { supabase } from '@/shared/lib/supabase';
import { getAnonymousUserId } from '@/shared/utils/anonymousUser';
import type { Comment, KnockRequest, FloatingEmoji, ActiveUser } from '../context/useTheater';

type SessionState = 'idle_host' | 'idle_guest' | 'knocking' | 'rejected' | 'active_session';

interface UseSocketConnectionParams {
  roomId: string;
  sessionState: SessionState;
  isHost: boolean;
  setSessionState: (s: SessionState) => void;
  setCurrentStreamUrl: (url: string) => void;
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
}

interface UseSocketConnectionResult {
  socket: Socket | null;
  knocks: KnockRequest[];
  floatingEmojis: FloatingEmoji[];
  approveGuest: (socketId: string) => void;
  rejectGuest: (socketId: string) => void;
  sendEmoji: (emoji: string) => void;
  sendMessage: (roomId: string, text: string) => void;
  activeUsers: ActiveUser[];
  changeRole: (userId: string, newRole: string) => void;
  kickUser: (userId: string) => void;
  currentUserId: string | null;
  kickedReason: string | null;
}

const ACTIVE_STATES: SessionState[] = ['active_session', 'idle_host', 'knocking'];

export function useSocketConnection({
  roomId,
  sessionState,
  isHost,
  setSessionState,
  setCurrentStreamUrl,
  setComments,
}: UseSocketConnectionParams): UseSocketConnectionResult {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [knocks, setKnocks] = useState<KnockRequest[]>([]);
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [kickedReason, setKickedReason] = useState<string | null>(null);

  // Fix #3: Store sessionState in a ref so the connect callback is never stale
  const sessionStateRef = useRef(sessionState);
  const isHostRef = useRef(isHost);
  useEffect(() => { sessionStateRef.current = sessionState; }, [sessionState]);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);

  const hasLobbyAccess = ACTIVE_STATES.includes(sessionState);

  useEffect(() => {
    if (!hasLobbyAccess) return;

    let socketInstance: Socket | null = null;

    const connectSocket = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const userId = session?.user?.id || getAnonymousUserId();
      setCurrentUserId(userId);
      const username = session?.user?.email || `Guest_${userId.slice(0, 5)}`;
      const backendUrl = import.meta.env.VITE_BACKEND_URL || '';

      socketInstance = io(backendUrl, {
        // Allow polling fallback for restricted corporate/mobile networks
        transports: ['websocket', 'polling'],
        auth: { token },
        // Exponential backoff reconnection — prevents thundering herd on server restart
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,       // start at 1s
        reconnectionDelayMax: 30_000,  // cap at 30s
        randomizationFactor: 0.5,      // ±50% jitter
        timeout: 10_000,
      });

      socketInstance.on('connect', () => {
        setSocket(socketInstance);
        console.log('🔌 Socket connected.');

        const state = sessionStateRef.current;
        if (state === 'active_session' || state === 'idle_host') {
          socketInstance?.emit('room:join', { roomId, userId });
        } else if (state === 'knocking') {
          // Fix #3: Only emit knock if not host (double-check via ref)
          if (!isHostRef.current) {
            socketInstance?.emit('room:knock', { roomId, username });
          } else {
            socketInstance?.emit('room:join', { roomId, userId });
          }
        }
      });

      socketInstance.on('disconnect', () => {
        setSocket(null);
        console.log('🔌 Socket disconnected.');
      });

      socketInstance.on('room:entry-approved', () => {
        console.log('🎉 Approved by host!');
        setSessionState('active_session');
        socketInstance?.emit('room:join', { roomId, userId });
      });

      socketInstance.on('room:entry-rejected', () => {
        console.log('❌ Rejected by host.');
        setSessionState('rejected');
      });

      socketInstance.on('room:knock-alert', (data: { socketId: string; username: string }) => {
        setKnocks((prev) => {
          if (prev.some((k) => k.socketId === data.socketId)) return prev;
          return [...prev, { socketId: data.socketId, username: data.username }];
        });
      });

      socketInstance.on('room:receive-emoji', (data: { emoji: string }) => {
        const emojiId = Math.random().toString(36).substring(2, 9);
        setFloatingEmojis((prev) => [...prev, { id: emojiId, emoji: data.emoji }]);
        setTimeout(() => {
          setFloatingEmojis((prev) => prev.filter((item) => item.id !== emojiId));
        }, 3000);
      });

      socketInstance.on('update-video-src', (newUrl: string) => {
        setCurrentStreamUrl(newUrl);
      });

      socketInstance.on('update-room-chat', (newComment: Comment) => {
        setComments((prev) => [...prev, newComment]);
      });

      socketInstance.on('room:active-users', (users: ActiveUser[]) => {
        setActiveUsers(users);
      });

      socketInstance.on('room:kicked', () => {
        // Replace blocking window.alert with a state-driven overlay rendered in Room.tsx
        setKickedReason('You have been removed from the watch party by the host.');
      });

      socketInstance.on('sync-state', (roomState: { streamUrl?: string }) => {
        if (roomState?.streamUrl) setCurrentStreamUrl(roomState.streamUrl);
      });

      socketInstance.on('room:host_disconnected_fallback', () => {
        console.warn('⚠️ Host disconnected. Reverting to idle state.');
        setSessionState('idle_guest');
        setSocket(null);
      });
    };

    connectSocket().catch((err) => {
      console.error('Failed to establish Socket.io connection:', err);
    });

    return () => {
      if (socketInstance) {
        socketInstance.disconnect();
      }
      setSocket(null);
    };
  }, [hasLobbyAccess, roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fix #5: Guard the change-video-src emission so it does NOT fire on initial mount.
  // We only emit if the URL changes AFTER the component has been active for one render cycle.
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return; // Skip the very first render
    }
    // This effect intentionally left empty — actual emission is done in TheaterContext
    // when socket && sessionState === 'active_session'
  }, []);

  const approveGuest = useCallback((guestSocketId: string) => {
    if (socket) {
      socket.emit('room:approve-entry', { guestSocketId });
      setKnocks((prev) => prev.filter((k) => k.socketId !== guestSocketId));
    }
  }, [socket]);

  const rejectGuest = useCallback((guestSocketId: string) => {
    if (socket) {
      socket.emit('room:reject-entry', { guestSocketId });
      setKnocks((prev) => prev.filter((k) => k.socketId !== guestSocketId));
    }
  }, [socket]);

  const sendEmoji = useCallback((emoji: string) => {
    if (socket) {
      socket.emit('room:send-emoji', { roomId, emoji });
    }
  }, [socket, roomId]);

  const sendMessage = useCallback((targetRoomId: string, text: string) => {
    if (socket) {
      socket.emit('room-chat-msg', { roomId: targetRoomId, message: text });
    }
  }, [socket]);

  const changeRole = useCallback((targetUserId: string, newRole: string) => {
    if (socket) {
      socket.emit('room:change-role', { targetUserId, newRole });
    }
  }, [socket]);

  const kickUser = useCallback((targetUserId: string) => {
    if (socket) {
      socket.emit('room:kick-user', { targetUserId });
    }
  }, [socket]);

  // Implement Page Visibility API lifecycle handling
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log("👀 Tab became visible. Checking socket synchronization...");
        if (socket) {
          if (!socket.connected) {
            console.log("🔄 Socket disconnected during background throttling. Reconnecting manually...");
            socket.connect();
          } else {
            console.log("📡 Socket connected. Requesting lightweight state sync...");
            socket.emit('room:request-sync', { roomId });
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [socket, roomId]);

  return { socket, knocks, floatingEmojis, approveGuest, rejectGuest, sendEmoji, sendMessage, activeUsers, changeRole, kickUser, currentUserId, kickedReason };
}
