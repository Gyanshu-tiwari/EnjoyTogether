/**
 * TheaterContext.tsx
 * ──────────────────
 * The main provider that wires together:
 * - Room session lifecycle (useRoomSession)
 * - Socket.IO connection + all room events (useSocketConnection)
 * - Local media source lifecycle (LocalMediaSource)
 * - WebRTC peer connections (WebRTCHostManager / WebRTCViewerManager via socket callbacks)
 * - Chat
 * - Emoji reactions
 *
 * Architecture principle:
 * - Host: picks local file → captureStream → WebRTC to viewers
 * - Viewer: receives WebRTC stream → plays in <video srcObject>
 * - Backend: never receives video bytes, only SDP/ICE/sync events
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { TheaterContext, type Comment, type WebRTCStatus } from './useTheater';
import { useRoomSession } from '../hooks/useRoomSession';
import { useSocketConnection } from '../hooks/useSocketConnection';
import { LocalMediaSource } from '../media/LocalMediaSource';
import { WebRTCHostManager } from '../webrtc/WebRTCHostManager';
import { WebRTCViewerManager } from '../webrtc/WebRTCViewerManager';
import { getIceServers } from '../webrtc/iceServers';
import type { WatchPartyRole } from '@/features/videocall/hooks/useLiveKitRoom';
import type { MediaSourceDescriptor } from '../media/types';

export const TheaterProvider: React.FC<{
  roomId?: string;
  initialStreamUrl: string;
  isHost?: boolean;
  initialActive?: boolean;
  initialIsHost?: boolean;
  /** Pre-selected File from LocalFilePicker (passed via Room.tsx after room creation) */
  pendingFile?: File | null;
  /** Pre-created LocalMediaSource from LocalFilePicker */
  pendingSource?: LocalMediaSource | null;
  children: React.ReactNode;
}> = ({
  roomId: propRoomId,
  initialStreamUrl,
  isHost: isHostProp,
  initialActive,
  initialIsHost,
  pendingFile,
  pendingSource,
  children,
}) => {
  const { id } = useParams<{ id: string }>();
  const roomId = propRoomId || id || 'enjoy-together-main';

  // ── UI state ──────────────────────────────────────────────────────────────
  const [inputMessage, setInputMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'call'>('chat');
  const [comments, setComments] = useState<Comment[]>([]);
  const [userRole, setUserRole] = useState<WatchPartyRole>('viewer');

  // ── Local media state ──────────────────────────────────────────────────────
  // ── Local media state ──────────────────────────────────────────────────────
  const [localFile, setLocalFileState] = useState<File | null>(pendingFile ?? null);
  const mediaSourceRef = useRef<LocalMediaSource | null>(pendingSource ?? null);
  const [mediaSource, setMediaSource] = useState<LocalMediaSource | null>(pendingSource ?? null);
  const [mediaDescriptor, setMediaDescriptor] = useState<MediaSourceDescriptor | null>(() => {
    if (pendingSource && pendingSource.status === 'ready') {
      return pendingSource.descriptor;
    }
    return null;
  });
  const [hostStream, setHostStream] = useState<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null); // Set by SyncVideoPlayer

  // ── WebRTC state ──────────────────────────────────────────────────────────
  const [viewerStream, setViewerStream] = useState<MediaStream | null>(null);
  const [webrtcStatus, setWebRTCStatus] = useState<WebRTCStatus>('idle');
  const hostManagerRef = useRef<WebRTCHostManager | null>(null);
  const viewerManagerRef = useRef<WebRTCViewerManager | null>(null);
  const pendingViewersRef = useRef<Array<{ viewerId: string; connectionId: string }>>([]);

  // ── Room session state machine ─────────────────────────────────────────────
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
  } = useRoomSession(
    roomId,
    isHostProp !== undefined ? isHostProp : initialIsHost,
    initialStreamUrl,
    initialActive
  );

  // ── Socket connection ──────────────────────────────────────────────────────
  const {
    socket,
    knocks,
    floatingEmojis,
    approveGuest,
    rejectGuest,
    sendEmoji,
    sendMessage: socketSendMessage,
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
  } = useSocketConnection({
    roomId,
    sessionState,
    isHost,
    setSessionState,
    setCurrentStreamUrl: _setStreamUrl,
    setComments,

    // ── WebRTC signaling callbacks ──────────────────────────────────────────
    onWebRTCOffer: useCallback((data) => {
      viewerManagerRef.current?.handleOffer(data);
    }, []),

    onWebRTCAnswer: useCallback((data) => {
      hostManagerRef.current?.handleAnswer(data);
    }, []),

    onWebRTCIceCandidate: useCallback((data) => {
      if (isHost && hostManagerRef.current) {
        hostManagerRef.current.handleIceCandidate(data);
      } else if (!isHost && viewerManagerRef.current) {
        viewerManagerRef.current.handleIceCandidate(data);
      }
    }, [isHost]),

    onViewerReady: useCallback((data) => {
      if (hostManagerRef.current) {
        hostManagerRef.current.handleViewerReady(data);
      } else {
        console.log(`[TheaterProvider] Queueing viewer-ready from ${data.viewerId} until host stream starts.`);
        pendingViewersRef.current.push(data);
      }
    }, []),

    onHostStreamReady: useCallback(() => {
      if (!isHost) {
        setWebRTCStatus('connecting');
        viewerManagerRef.current?.signalReady();
      }
    }, [isHost]),

    onHostStreamEnded: useCallback(() => {
      viewerManagerRef.current?.handleHostStreamEnded();
      setViewerStream(null);
      setWebRTCStatus('host_disconnected');
    }, []),
  });

  // ── Set up WebRTC managers when session becomes active ─────────────────────
  useEffect(() => {
    if (sessionState !== 'active_session' || !socket) return;

    const iceServers = getIceServers();

    if (isHost) {
      // Host manager is set up when the host selects a video file (see setLocalFile below)
      // Nothing to do here yet — no file selected
    } else {
      // Viewer: set up viewer manager and signal ready
      console.log('[TheaterProvider] Setting up WebRTCViewerManager for viewer.');
      const manager = new WebRTCViewerManager({
        socket,
        roomId,
        viewerId: currentUserId || 'unknown',
        iceServers,
        onStream: (stream) => {
          setViewerStream(stream);
          setWebRTCStatus('connected');
        },
        onStreamLost: () => {
          setViewerStream(null);
          setWebRTCStatus('host_disconnected');
        },
        onConnectionStateChange: (state) => {
          if (state === 'connected') setWebRTCStatus('connected');
          else if (state === 'failed' || state === 'closed') setWebRTCStatus('failed');
        },
      });

      viewerManagerRef.current = manager;
      manager.signalReady();
    }

    return () => {
      if (!isHost && viewerManagerRef.current) {
        viewerManagerRef.current.destroy();
        viewerManagerRef.current = null;
      }
    };
  }, [sessionState, socket, isHost, roomId, currentUserId]);

  // ── Host: select a local file ──────────────────────────────────────────────
  const setLocalFile = useCallback(async (file: File | null) => {
    // Clean up old media source
    if (mediaSourceRef.current) {
      mediaSourceRef.current.destroy();
      mediaSourceRef.current = null;
    }
    setMediaSource(null);

    // Stop any existing captured stream
    if (hostStream) {
      for (const track of hostStream.getTracks()) {
        track.stop();
      }
      setHostStream(null);
    }

    // Clean up host manager
    if (hostManagerRef.current) {
      hostManagerRef.current.destroy();
      hostManagerRef.current = null;
    }

    setLocalFileState(file);
    setMediaDescriptor(null);

    if (!file) return;

    // Create new media source and load metadata
    const source = new LocalMediaSource(file);
    mediaSourceRef.current = source;
    setMediaSource(source);

    try {
      const descriptor = await source.loadMetadata();
      setMediaDescriptor(descriptor);
      console.log(`[TheaterProvider] File selected: "${descriptor.name}", ${descriptor.durationSeconds?.toFixed(1)}s`);
    } catch (err) {
      console.error('[TheaterProvider] Failed to load file metadata:', err);
    }
  }, [hostStream]);

  // ── Host: after <video> element starts playing, start captureStream + WebRTC ──
  // This is called by SyncVideoPlayer when the host video is ready to stream
  const startHostCapture = useCallback((videoEl: HTMLVideoElement) => {
    videoElRef.current = videoEl;
    const source = mediaSourceRef.current;
    if (!source || !socket || sessionState !== 'active_session') return;

    const stream = source.captureStream(videoEl);
    if (!stream) {
      console.error('[TheaterProvider] captureStream() failed — cannot start WebRTC.');
      return;
    }

    setHostStream(stream);

    const iceServers = getIceServers();

    // Create or replace host manager
    if (hostManagerRef.current) {
      // Replace stream on existing connections
      hostManagerRef.current.replaceStream(stream);
    } else {
      const manager = new WebRTCHostManager({
        stream,
        socket,
        roomId,
        iceServers,
        onPeerStateChange: (viewerId, state) => {
          console.log(`[TheaterProvider] Peer state for ${viewerId}: ${state}`);
        },
      });
      hostManagerRef.current = manager;

      // Flush any queued viewers who were waiting for stream capture
      if (pendingViewersRef.current.length > 0) {
        console.log(`[TheaterProvider] Flushing ${pendingViewersRef.current.length} pending viewer(s).`);
        for (const queued of pendingViewersRef.current) {
          manager.handleViewerReady(queued);
        }
        pendingViewersRef.current = [];
      }
    }

    // Notify all viewers that the stream is ready
    const descriptor = mediaSourceRef.current?.descriptor;
    notifyHostStreamReady(
      descriptor?.name || 'Unknown',
      descriptor?.durationSeconds ?? null
    );

    console.log(`[TheaterProvider] Host capture started. ${stream.getTracks().length} track(s).`);
  }, [socket, sessionState, roomId, notifyHostStreamReady]);

  // ── Expose startHostCapture via context (SyncVideoPlayer will call it) ─────
  // We use a global ref accessible from SyncVideoPlayer through context

  // ── Clean up on session end ────────────────────────────────────────────────
  useEffect(() => {
    if (sessionState !== 'active_session') {
      // Clean up host resources when session ends
      if (hostManagerRef.current) {
        notifyHostStreamEnded();
        hostManagerRef.current.destroy();
        hostManagerRef.current = null;
      }
      if (viewerManagerRef.current) {
        viewerManagerRef.current.destroy();
        viewerManagerRef.current = null;
      }
      queueMicrotask(() => {
        setViewerStream(null);
        setWebRTCStatus('idle');
      });
    }
  }, [sessionState, notifyHostStreamEnded]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (mediaSourceRef.current) {
        mediaSourceRef.current.destroy();
        mediaSourceRef.current = null;
      }
      if (hostManagerRef.current) {
        hostManagerRef.current.destroy();
        hostManagerRef.current = null;
      }
      if (viewerManagerRef.current) {
        viewerManagerRef.current.destroy();
        viewerManagerRef.current = null;
      }
    };
  }, []);

  // ── Emit legacy change-video-src ONLY after mount (backward compat) ────────
  const hasMountedStreamRef = useRef(false);
  useEffect(() => {
    if (!hasMountedStreamRef.current) {
      hasMountedStreamRef.current = true;
      return;
    }
    if (isHost && socket && currentStreamUrl && sessionState === 'active_session') {
      socket.emit('change-video-src', { roomId, streamUrl: currentStreamUrl });
    }
  }, [currentStreamUrl, roomId, socket, sessionState, isHost]);

  // Derive effective role from activeUsers list, falling back to state
  const me = activeUsers.find((u) => u.userId === currentUserId);
  const effectiveRole = (me?.role as WatchPartyRole) || userRole;

  // ── Chat ──────────────────────────────────────────────────────────────────
  const sendMessage = () => {
    if (!inputMessage.trim()) return;
    setComments((prev) => [...prev, { userId: currentUserId || 'me', user: 'You', text: inputMessage }]);
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

        // Local media
        localFile,
        setLocalFile,
        mediaSource,
        mediaDescriptor,
        hostStream,
        viewerStream,
        setViewerStream,
        webrtcStatus,
        setWebRTCStatus,
        startHostCapture,

        // Chat
        comments,
        setComments,
        inputMessage,
        setInputMessage,
        sendMessage,

        // UI
        activeTab,
        setActiveTab,

        // Session
        sessionState,
        isHost,
        startSession,
        endSession,
        loading,
        dbError,

        // Admission
        knocks,
        approveGuest,
        rejectGuest,

        // Reactions
        sendEmoji,
        floatingEmojis,
        // RBAC
        userRole: effectiveRole,
        setUserRole,
        activeUsers,
        changeRole,
        kickUser,
        currentUserId,
        kickedReason,

        // WebRTC signaling actions
        sendWebRTCOffer,
        sendWebRTCAnswer,
        sendWebRTCIce,
        signalViewerReady,
        notifyHostStreamReady,
        notifyHostStreamEnded,
      }}
    >
      {children}
    </TheaterContext.Provider>
  );
};
