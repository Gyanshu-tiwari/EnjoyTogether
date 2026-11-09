/**
 * useSocketConnection.ts
 * ──────────────────────
 * Manages the Socket.IO connection lifecycle and all room socket events.
 * Now also handles WebRTC signaling relay (offers, answers, ICE candidates)
 * without ever passing video bytes through the socket.
 */

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
  /** Called when WebRTC offer arrives (viewer only) */
  onWebRTCOffer?: (data: { senderId: string; sdp: RTCSessionDescriptionInit; connectionId: string }) => void;
  /** Called when WebRTC answer arrives (host only) */
  onWebRTCAnswer?: (data: { senderId: string; sdp: RTCSessionDescriptionInit; connectionId: string }) => void;
  /** Called when ICE candidate arrives */
  onWebRTCIceCandidate?: (data: { senderId: string; candidate: RTCIceCandidateInit; connectionId: string }) => void;
  /** Called when viewer signals ready (host only) */
  onViewerReady?: (data: { viewerId: string; connectionId: string }) => void;
  /** Called when a new viewer joins the room (host only) */
  onViewerJoined?: (data: { viewerId: string; roomId: string }) => void;
  /** Called when host stream starts (viewer only) */
  onHostStreamReady?: (data: { mediaName: string; mediaDuration: number | null }) => void;
  /** Called when host stream ends (viewer only) */
  onHostStreamEnded?: () => void;
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
  /** Send WebRTC offer to a specific viewer */
  sendWebRTCOffer: (targetId: string, sdp: RTCSessionDescriptionInit, connectionId: string) => void;
  /** Send WebRTC answer back to host */
  sendWebRTCAnswer: (sdp: RTCSessionDescriptionInit, connectionId: string) => void;
  /** Send ICE candidate to a specific target ('host' or viewerId) */
  sendWebRTCIce: (targetId: string, candidate: RTCIceCandidateInit, connectionId: string) => void;
  /** Viewer: signal to host that we are ready for a peer connection */
  signalViewerReady: (connectionId: string) => void;
  /** Host: notify all viewers that stream is starting */
  notifyHostStreamReady: (mediaName: string, mediaDuration: number | null) => void;
  /** Host: notify all viewers that stream has ended */
  notifyHostStreamEnded: () => void;
}

const ACTIVE_STATES: SessionState[] = ['active_session', 'idle_host', 'knocking'];

export function useSocketConnection({
  roomId,
  sessionState,
  isHost,
  setSessionState,
  setCurrentStreamUrl,
  setComments,
  onWebRTCOffer,
  onWebRTCAnswer,
  onWebRTCIceCandidate,
  onViewerReady,
  onViewerJoined,
  onHostStreamReady,
  onHostStreamEnded,
}: UseSocketConnectionParams): UseSocketConnectionResult {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [knocks, setKnocks] = useState<KnockRequest[]>([]);
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  // Synchronous initialization prevents 'unknown' viewerId race condition
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('et_anon_user_id') || getAnonymousUserId();
    }
    return null;
  });
  const [kickedReason, setKickedReason] = useState<string | null>(null);

  // Store sessionState in a ref so the connect callback is never stale
  const sessionStateRef = useRef(sessionState);
  const isHostRef = useRef(isHost);
  useEffect(() => { sessionStateRef.current = sessionState; }, [sessionState]);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);

  // Keep WebRTC callbacks in refs so socket listeners are never stale
  const onWebRTCOfferRef = useRef(onWebRTCOffer);
  const onWebRTCAnswerRef = useRef(onWebRTCAnswer);
  const onWebRTCIceCandidateRef = useRef(onWebRTCIceCandidate);
  const onViewerReadyRef = useRef(onViewerReady);
  const onViewerJoinedRef = useRef(onViewerJoined);
  const onHostStreamReadyRef = useRef(onHostStreamReady);
  const onHostStreamEndedRef = useRef(onHostStreamEnded);
  useEffect(() => { onWebRTCOfferRef.current = onWebRTCOffer; }, [onWebRTCOffer]);
  useEffect(() => { onWebRTCAnswerRef.current = onWebRTCAnswer; }, [onWebRTCAnswer]);
  useEffect(() => { onWebRTCIceCandidateRef.current = onWebRTCIceCandidate; }, [onWebRTCIceCandidate]);
  useEffect(() => { onViewerReadyRef.current = onViewerReady; }, [onViewerReady]);
  useEffect(() => { onViewerJoinedRef.current = onViewerJoined; }, [onViewerJoined]);
  useEffect(() => { onHostStreamReadyRef.current = onHostStreamReady; }, [onHostStreamReady]);
  useEffect(() => { onHostStreamEndedRef.current = onHostStreamEnded; }, [onHostStreamEnded]);

  // Store socket in a ref for use in callbacks
  const socketRef = useRef<Socket | null>(null);

  const hasLobbyAccess = ACTIVE_STATES.includes(sessionState);

  const emojiTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!hasLobbyAccess) return;

    let socketInstance: Socket | null = null;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log("👀 Tab became visible. Checking socket synchronization...");
        if (socketInstance) {
          if (!socketInstance.connected) {
            console.log("🔄 Socket disconnected during background throttling. Reconnecting manually...");
            socketInstance.connect();
          } else {
            console.log("📡 Socket connected. Requesting lightweight state sync...");
            socketInstance.emit('room:request-sync', { roomId });
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const connectSocket = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const userId = session?.user?.id || getAnonymousUserId();
      setCurrentUserId(userId);
      const rawUsername = session?.user?.user_metadata?.username ||
                          session?.user?.user_metadata?.full_name ||
                          session?.user?.user_metadata?.name;
      let username = rawUsername;
      if (!username && session?.user?.email) {
        username = session.user.email.split('@')[0];
      }
      if (!username) {
        username = `Guest_${userId.slice(0, 5)}`;
      }
      const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
      const sessionSecret = !session?.user?.id && typeof window !== 'undefined' ? (localStorage.getItem('et_anon_session_secret') || undefined) : undefined;

      socketInstance = io(backendUrl, {
        transports: ['websocket', 'polling'],
        auth: { token, sessionSecret },
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30_000,
        randomizationFactor: 0.5,
        timeout: 10_000,
      });

      socketInstance.on('connect', () => {
        setSocket(socketInstance);
        socketRef.current = socketInstance;
        console.log('🔌 Socket connected.');

        const state = sessionStateRef.current;
        if (state === 'active_session' || state === 'idle_host') {
          socketInstance?.emit('room:join', { roomId, userId, sessionSecret });
        } else if (state === 'knocking') {
          if (!isHostRef.current) {
            socketInstance?.emit('room:knock', { roomId, username });
          } else {
            socketInstance?.emit('room:join', { roomId, userId, sessionSecret });
          }
        }
      });

      socketInstance.on('disconnect', () => {
        setSocket(null);
        socketRef.current = null;
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
        const timer = setTimeout(() => {
          setFloatingEmojis((prev) => prev.filter((item) => item.id !== emojiId));
          emojiTimeoutsRef.current = emojiTimeoutsRef.current.filter((t) => t !== timer);
        }, 3000);
        emojiTimeoutsRef.current.push(timer);
      });

      socketInstance.on('update-video-src', (newUrl: string) => {
        setCurrentStreamUrl(newUrl);
      });

      socketInstance.on('update-room-chat', (newComment: Comment) => {
        setComments((prev) => [...prev, newComment]);
      });

      socketInstance.on('room:active-users', (users: ActiveUser[]) => {
        const userMap = new Map<string, ActiveUser>();
        for (const u of users) {
          const key = (u.userId && u.userId !== 'guest') ? u.userId : (u.name || u.socketId);
          const existing = userMap.get(key);
          if (!existing || u.isHost || u.role === 'host') {
            userMap.set(key, u);
          }
        }
        setActiveUsers(Array.from(userMap.values()));
      });

      socketInstance.on('room:kicked', () => {
        // Replace blocking window.alert with a state-driven overlay rendered in Room.tsx
        setKickedReason('You have been removed from the watch party by the host.');
      });

      socketInstance.on('sync-state', (roomState: { streamUrl?: string; mediaSourceType?: string; mediaName?: string; mediaDuration?: number | null }) => {
        if (roomState?.streamUrl) setCurrentStreamUrl(roomState.streamUrl);
        if (roomState?.mediaSourceType === 'local') {
          console.log('[Socket] sync-state indicates host is streaming local media:', roomState.mediaName);
          onHostStreamReadyRef.current?.({
            mediaName: roomState.mediaName || 'Host Stream',
            mediaDuration: roomState.mediaDuration ?? null,
          });
        }
      });

      socketInstance.on('room:host_disconnected_fallback', () => {
        if (isHostRef.current) {
          console.log('🛡️ Host ignoring host_disconnected_fallback event');
          return;
        }
        console.warn('⚠️ Host disconnected. Reverting to idle state.');
        setSessionState('idle_guest');
        setSocket(null);
        socketRef.current = null;
      });

      // ── WebRTC Signaling Events ────────────────────────────────────────────
      // These relay SDP/ICE between host and viewers. NEVER contain video bytes.

      socketInstance.on('webrtc:offer', (data: { senderId: string; sdp: RTCSessionDescriptionInit; connectionId: string }) => {
        console.log(`[Socket] webrtc:offer received from ${data.senderId}`);
        onWebRTCOfferRef.current?.(data);
      });

      socketInstance.on('webrtc:answer', (data: { senderId: string; sdp: RTCSessionDescriptionInit; connectionId: string }) => {
        console.log(`[Socket] webrtc:answer received from ${data.senderId}`);
        onWebRTCAnswerRef.current?.(data);
      });

      socketInstance.on('webrtc:ice-candidate', (data: { senderId: string; candidate: RTCIceCandidateInit; connectionId: string }) => {
        onWebRTCIceCandidateRef.current?.(data);
      });

      socketInstance.on('webrtc:viewer-ready', (data: { viewerId: string; connectionId: string }) => {
        console.log(`[Socket] webrtc:viewer-ready from viewer ${data.viewerId}`);
        onViewerReadyRef.current?.(data);
      });

      socketInstance.on('webrtc:viewer-joined', (data: { viewerId: string; roomId: string }) => {
        console.log(`[Socket] webrtc:viewer-joined for viewer ${data.viewerId}`);
        onViewerJoinedRef.current?.(data);
      });

      socketInstance.on('webrtc:host-stream-ready', (data: { mediaName: string; mediaDuration: number | null }) => {
        console.log(`[Socket] Host stream starting: "${data.mediaName}"`);
        onHostStreamReadyRef.current?.(data);
      });

      socketInstance.on('webrtc:host-stream-ended', () => {
        console.log('[Socket] Host stream ended.');
        onHostStreamEndedRef.current?.();
      });
    };

    connectSocket().catch((err) => {
      console.error('Failed to establish Socket.io connection:', err);
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (socketInstance) {
        socketInstance.disconnect();
      }
      setSocket(null);
      emojiTimeoutsRef.current.forEach((t) => clearTimeout(t));
      emojiTimeoutsRef.current = [];
      socketRef.current = null;
    };
  }, [hasLobbyAccess, roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Action callbacks ───────────────────────────────────────────────────────

  const approveGuest = useCallback((guestSocketId: string) => {
    socketRef.current?.emit('room:approve-entry', { guestSocketId });
    setKnocks((prev) => prev.filter((k) => k.socketId !== guestSocketId));
  }, []);

  const rejectGuest = useCallback((guestSocketId: string) => {
    socketRef.current?.emit('room:reject-entry', { guestSocketId });
    setKnocks((prev) => prev.filter((k) => k.socketId !== guestSocketId));
  }, []);

  const sendEmoji = useCallback((emoji: string) => {
    socketRef.current?.emit('room:send-emoji', { roomId, emoji });
  }, [roomId]);

  const sendMessage = useCallback((targetRoomId: string, text: string) => {
    socketRef.current?.emit('room-chat-msg', { roomId: targetRoomId, message: text });
  }, []);

  const changeRole = useCallback((targetUserId: string, newRole: string) => {
    socketRef.current?.emit('room:change-role', { targetUserId, newRole });
  }, []);

  const kickUser = useCallback((targetUserId: string) => {
    socketRef.current?.emit('room:kick-user', { targetUserId });
  }, []);

  // ── WebRTC signaling actions ───────────────────────────────────────────────

  const sendWebRTCOffer = useCallback((targetId: string, sdp: RTCSessionDescriptionInit, connectionId: string) => {
    socketRef.current?.emit('webrtc:offer', { roomId, targetId, sdp, connectionId });
  }, [roomId]);

  const resolveEffectiveUserId = useCallback(() => {
    return currentUserId || (typeof window !== 'undefined' ? (localStorage.getItem('et_anon_user_id') || getAnonymousUserId()) : 'guest');
  }, [currentUserId]);

  const sendWebRTCAnswer = useCallback((sdp: RTCSessionDescriptionInit, connectionId: string) => {
    const userId = resolveEffectiveUserId();
    socketRef.current?.emit('webrtc:answer', {
      roomId,
      targetId: 'host',
      sdp,
      connectionId,
      senderId: userId,
    });
  }, [roomId, resolveEffectiveUserId]);

  const sendWebRTCIce = useCallback((targetId: string, candidate: RTCIceCandidateInit, connectionId: string) => {
    const userId = resolveEffectiveUserId();
    socketRef.current?.emit('webrtc:ice-candidate', {
      roomId,
      targetId,
      candidate,
      connectionId,
      senderId: userId,
    });
  }, [roomId, resolveEffectiveUserId]);

  const signalViewerReady = useCallback((connectionId: string) => {
    const userId = resolveEffectiveUserId();
    if (!userId) return;
    socketRef.current?.emit('webrtc:viewer-ready', { roomId, viewerId: userId, connectionId });
  }, [roomId, resolveEffectiveUserId]);

  const notifyHostStreamReady = useCallback((mediaName: string, mediaDuration: number | null) => {
    socketRef.current?.emit('webrtc:host-stream-ready', { roomId, mediaName, mediaDuration });
  }, [roomId]);

  const notifyHostStreamEnded = useCallback(() => {
    socketRef.current?.emit('webrtc:host-stream-ended', { roomId });
  }, [roomId]);

  return {
    socket,
    knocks,
    floatingEmojis,
    approveGuest,
    rejectGuest,
    sendEmoji,
    sendMessage,
    activeUsers,
    changeRole,
    kickUser,
    currentUserId,
    kickedReason,
    sendWebRTCOffer,
    sendWebRTCAnswer,
    sendWebRTCIce,
    signalViewerReady,
    notifyHostStreamReady,
    notifyHostStreamEnded,
  };
}
