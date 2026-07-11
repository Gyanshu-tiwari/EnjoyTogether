import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { TheaterContext, type Comment } from './useTheater';
import { useRoomSession } from '../hooks/useRoomSession';
import { useSocketConnection } from '../hooks/useSocketConnection';
import type { WatchPartyRole } from '@/features/videocall/hooks/useLiveKitRoom';

export const TheaterProvider: React.FC<{
  roomId?: string;
  initialStreamUrl: string;
  isHost?: boolean;
  children: React.ReactNode;
}> = ({ roomId: propRoomId, initialStreamUrl, isHost: isHostProp, children }) => {
  const { id } = useParams<{ id: string }>();
  const roomId = propRoomId || id || 'enjoy-together-main';

  const [inputMessage, setInputMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'call'>('chat');
  const [comments, setComments] = useState<Comment[]>([]);
  /** RBAC role — populated by TheaterView after LiveKit token is received */
  const [userRole, setUserRole] = useState<WatchPartyRole>('viewer');

  // ─── Room session state machine ───────────────────────────────────────────
  const {
    sessionState,
    setSessionState,
    setCurrentStreamUrl: _setStreamUrl,
    isHost,
    loading,
    dbError,
    currentStreamUrl,
    startSession,
    endSession,
  } = useRoomSession(roomId, isHostProp, initialStreamUrl);

  // ─── Socket connection ─────────────────────────────────────────────────────
  const {
    socket,
    knocks,
    floatingEmojis,
    approveGuest,
    rejectGuest,
    sendEmoji,
    sendMessage: socketSendMessage,
  } = useSocketConnection({
    roomId,
    sessionState,
    isHost,
    setSessionState,
    setCurrentStreamUrl: _setStreamUrl,
    setComments,
  });

  // Emit change-video-src ONLY after mount (not on initial render)
  const hasMountedStreamRef = useRef(false);
  useEffect(() => {
    if (!hasMountedStreamRef.current) {
      hasMountedStreamRef.current = true;
      return;
    }
    if (socket && currentStreamUrl && sessionState === 'active_session') {
      socket.emit('change-video-src', { roomId, streamUrl: currentStreamUrl });
    }
  }, [currentStreamUrl, roomId, socket, sessionState]);

  // ─── Chat ─────────────────────────────────────────────────────────────────
  const sendMessage = () => {
    if (!inputMessage.trim()) return;
    setComments((prev) => [...prev, { user: 'You', text: inputMessage }]);
    socketSendMessage(roomId, inputMessage);
    setInputMessage('');
  };

  return (
    <TheaterContext.Provider
      value={{
        roomId,
        socket,
        currentStreamUrl,
        setCurrentStreamUrl: _setStreamUrl,
        comments,
        setComments,
        inputMessage,
        setInputMessage,
        sendMessage,
        activeTab,
        setActiveTab,
        sessionState,
        isHost,
        startSession,
        endSession,
        loading,
        dbError,
        knocks,
        approveGuest,
        rejectGuest,
        sendEmoji,
        floatingEmojis,
        userRole,
        setUserRole,
      }}
    >
      {children}
    </TheaterContext.Provider>
  );
};
