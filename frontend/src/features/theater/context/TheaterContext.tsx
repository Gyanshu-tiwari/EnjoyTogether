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
import { getAnonymousUserId } from '@/shared/utils/anonymousUser';
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
  const [localFile, setLocalFileState] = useState<File | null>(pendingFile ?? null);

  // Resolve or revive valid LocalMediaSource from props
  const getInitialSource = (): LocalMediaSource | null => {
    if (pendingSource) {
      if (pendingSource.status === 'destroyed') {
        pendingSource.revive();
      }
      return pendingSource;
    }
    if (pendingFile) {
      return new LocalMediaSource(pendingFile);
    }
    return null;
  };

  const initialSource = getInitialSource();
  const mediaSourceRef = useRef<LocalMediaSource | null>(initialSource);
  const [mediaSource, setMediaSource] = useState<LocalMediaSource | null>(initialSource);
  const [mediaDescriptor, setMediaDescriptor] = useState<MediaSourceDescriptor | null>(() => {
    if (initialSource && initialSource.status === 'ready') {
      return initialSource.descriptor;
    }
    return null;
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  // Sync state if pending props arrive after initial mount or change
  useEffect(() => {
    if (pendingFile) {
      setLocalFileState(pendingFile);
    }
    if (pendingSource) {
      if (pendingSource.status === 'destroyed') {
        pendingSource.revive();
      }
      mediaSourceRef.current = pendingSource;
      setMediaSource(pendingSource);
      if (pendingSource.status === 'ready') {
        setMediaDescriptor(pendingSource.descriptor);
      } else {
        pendingSource.loadMetadata().then((desc) => {
          setMediaDescriptor(desc);
        }).catch((err) => {
          console.error('[TheaterProvider] Failed to load metadata for pending source:', err);
        });
      }
    } else if (pendingFile && (!mediaSourceRef.current || mediaSourceRef.current.status === 'destroyed')) {
      const src = new LocalMediaSource(pendingFile);
      mediaSourceRef.current = src;
      setMediaSource(src);
      src.loadMetadata().then((desc) => {
        setMediaDescriptor(desc);
      }).catch((err) => {
        console.error('[TheaterProvider] Failed to load metadata for pending file:', err);
      });
    }
  }, [pendingFile, pendingSource]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const [hostStream, setHostStream] = useState<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null); // Set by SyncVideoPlayer

  // ── WebRTC state ──────────────────────────────────────────────────────────
  const [viewerStream, setViewerStream] = useState<MediaStream | null>(null);
  const [webrtcStatus, setWebRTCStatus] = useState<WebRTCStatus>('idle');
  const [streamDuration, setStreamDuration] = useState<number | null>(null);
  const [streamMediaName, setStreamMediaName] = useState<string | null>(null);
  const hostManagerRef = useRef<WebRTCHostManager | null>(null);
  const viewerManagerRef = useRef<WebRTCViewerManager | null>(null);
  const pendingViewersRef = useRef<Array<{ viewerId: string; connectionId: string }>>([]);
  const pendingSignalReadyRef = useRef<boolean>(false);

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
        pendingViewersRef.current = pendingViewersRef.current.filter((v) => v.viewerId !== data.viewerId);
        pendingViewersRef.current.push(data);
      }
    }, []),

    onViewerJoined: useCallback((data: { viewerId: string; roomId: string }) => {
      console.log(`[TheaterProvider] Host notified that viewer joined room: ${data.viewerId}`);
      // Host awaits viewer's webrtc:viewer-ready with its coordinated connectionId
      // to eliminate offer/answer collisions and mismatched connection IDs.
    }, []),

    onHostStreamReady: useCallback((data?: { mediaName?: string; mediaDuration?: number | null }) => {
      if (data?.mediaDuration !== undefined && data.mediaDuration !== null) {
        setStreamDuration(data.mediaDuration);
      }
      if (data?.mediaName) {
        setStreamMediaName(data.mediaName);
      }
      if (!isHost) {
        console.log('[TheaterProvider] onHostStreamReady received for viewer:', data);
        setWebRTCStatus((prev) => (prev === 'connected' ? 'connected' : 'connecting'));
        if (viewerManagerRef.current) {
          viewerManagerRef.current.signalReady(true);
        } else {
          pendingSignalReadyRef.current = true;
        }
      }
    }, [isHost]),

    onHostStreamEnded: useCallback(() => {
      viewerManagerRef.current?.handleHostStreamEnded();
      setViewerStream(null);
      setWebRTCStatus('host_disconnected');
    }, []),
  });

  const retryViewerConnection = useCallback(() => {
    if (!isHost) {
      console.log('[TheaterProvider] Retrying viewer connection to host...');
      setWebRTCStatus('connecting');
      viewerManagerRef.current?.retry();
    }
  }, [isHost]);

  // ── Set up WebRTC managers when session becomes active ─────────────────────
  useEffect(() => {
    if (sessionState !== 'active_session' || !socket) return;

    const iceServers = getIceServers();

    if (isHost) {
      // Host manager is set up when the host selects a video file (see setLocalFile below)
      // Nothing to do here yet — no file selected
    } else {
      // Viewer: set up viewer manager and signal ready
      const effectiveViewerId = currentUserId || (typeof window !== 'undefined' ? (localStorage.getItem('et_anon_user_id') || getAnonymousUserId()) : 'viewer');
      console.log(`[TheaterProvider] Setting up WebRTCViewerManager for viewer ${effectiveViewerId}.`);
      const manager = new WebRTCViewerManager({
        socket,
        roomId,
        viewerId: effectiveViewerId,
        iceServers,
        onStream: (stream) => {
          console.log(`[TheaterProvider] Viewer received remote stream with ${stream.getTracks().length} track(s).`);
          setViewerStream(stream);
          setWebRTCStatus('connected');
        },
        onStreamLost: () => {
          console.log('[TheaterProvider] Viewer stream lost.');
          setViewerStream(null);
          setWebRTCStatus('host_disconnected');
        },
        onConnectionStateChange: (state) => {
          console.log(`[TheaterProvider] Viewer connectionState: ${state}`);
          if (state === 'connected') {
            setWebRTCStatus('connected');
          } else if (state === 'failed' || state === 'closed') {
            setWebRTCStatus('failed');
          } else if (state === 'connecting') {
            // Guard: do not downgrade to 'connecting' if we already transitioned to 'connected'
            setWebRTCStatus((prev) => (prev === 'connected' ? 'connected' : 'connecting'));
          }
        },
      });

      viewerManagerRef.current = manager;
      setWebRTCStatus('connecting');
      manager.signalReady(true);
      pendingSignalReadyRef.current = false;
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
    let source = mediaSourceRef.current || mediaSource;
    if (!source && localFile) {
      source = new LocalMediaSource(localFile);
      mediaSourceRef.current = source;
      setMediaSource(source);
    }
    if (!source || !socket || sessionState !== 'active_session') return;

    if (source.status === 'destroyed') {
      source.revive();
    }

    const stream = source.captureStream(videoEl);
    if (!stream) {
      console.error('[TheaterProvider] captureStream() failed — cannot start WebRTC.');
      return;
    }

    setHostStream(stream);

    const iceServers = getIceServers();

    const descriptor = mediaSourceRef.current?.descriptor;
    const sourceDimensions = (descriptor?.width && descriptor?.height) ? {
      width: descriptor.width,
      height: descriptor.height,
    } : (videoEl && videoEl.videoWidth && videoEl.videoHeight) ? {
      width: videoEl.videoWidth,
      height: videoEl.videoHeight,
    } : undefined;

    // Create or replace host manager
    if (hostManagerRef.current) {
      // Replace stream on existing connections and update dimensions
      if (sourceDimensions) {
        hostManagerRef.current.updateSourceDimensions(sourceDimensions);
      }
      hostManagerRef.current.replaceStream(stream);
    } else {
      const manager = new WebRTCHostManager({
        stream,
        socket,
        roomId,
        iceServers,
        sourceDimensions,
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
    const resolvedDuration = (descriptor?.durationSeconds && descriptor.durationSeconds > 0)
      ? descriptor.durationSeconds
      : (videoEl && isFinite(videoEl.duration) && videoEl.duration > 0 ? Math.round(videoEl.duration) : null);
    const resolvedName = descriptor?.name || localFile?.name || 'Local Video';
    setStreamDuration(resolvedDuration);
    setStreamMediaName(resolvedName);
    notifyHostStreamReady(
      resolvedName,
      resolvedDuration
    );

    console.log(`[TheaterProvider] Host capture started. ${stream.getTracks().length} track(s).`);
  }, [socket, sessionState, roomId, notifyHostStreamReady, localFile, mediaSource]);

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
      // Clean up host WebRTC connections
      if (hostManagerRef.current) {
        hostManagerRef.current.destroy();
        hostManagerRef.current = null;
      }
      // Clean up viewer WebRTC connections
      if (viewerManagerRef.current) {
        viewerManagerRef.current.destroy();
        viewerManagerRef.current = null;
      }
      // NOTE: Do not destroy mediaSourceRef.current on transient unmount!
      // In React Strict Mode or during route/skeleton toggling, destroying
      // mediaSource kills the active source for subsequent mounts.
      // mediaSource is destroyed explicitly when a file is replaced in setLocalFile()
      // or permanently disposed when leaving the room.
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
        streamDuration,
        streamMediaName,
        retryViewerConnection,
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
