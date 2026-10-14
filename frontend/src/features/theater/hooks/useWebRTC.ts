/**
 * useWebRTC.ts
 * ────────────
 * React hook that orchestrates WebRTC for the watch-together session.
 *
 * HOST path:
 *   localStream → WebRTCHostManager → one peer per viewer
 *
 * VIEWER path:
 *   WebRTCViewerManager → incoming MediaStream → <video srcObject>
 *
 * This hook is purely a lifecycle wrapper. It does not render UI.
 * All signaling goes through the socket callbacks passed in.
 */

import { useEffect, useRef, useCallback } from 'react';
import { WebRTCHostManager } from '../webrtc/WebRTCHostManager';
import { WebRTCViewerManager } from '../webrtc/WebRTCViewerManager';
import { getIceServers } from '../webrtc/iceServers';
import type { Socket } from 'socket.io-client';
import type { WebRTCStatus } from '../context/useTheater';

interface UseWebRTCHostParams {
  role: 'host';
  socket: Socket;
  roomId: string;
  localStream: MediaStream;
  onPeerStateChange?: (viewerId: string, state: RTCPeerConnectionState) => void;
}

interface UseWebRTCViewerParams {
  role: 'viewer';
  socket: Socket;
  roomId: string;
  viewerId: string;
  onStream: (stream: MediaStream) => void;
  onStreamLost: () => void;
  onStatusChange: (status: WebRTCStatus) => void;
  /** Signal viewer-ready immediately on mount */
  signalReady?: boolean;
}

type UseWebRTCParams = UseWebRTCHostParams | UseWebRTCViewerParams;

/** Returned manager reference for programmatic control */
export interface UseWebRTCResult {
  /** For host: replace the captured media stream on all connections */
  replaceStream?: (newStream: MediaStream) => Promise<void>;
  /** For viewer: trigger a fresh viewer-ready signal (e.g. after reconnect) */
  reconnect?: () => void;
}

export function useWebRTC(params: UseWebRTCParams): UseWebRTCResult {
  const hostManagerRef = useRef<WebRTCHostManager | null>(null);
  const viewerManagerRef = useRef<WebRTCViewerManager | null>(null);

  const iceServers = getIceServers();

  useEffect(() => {
    if (params.role === 'host') {
      const { socket, roomId, localStream, onPeerStateChange } = params;

      console.log('[useWebRTC] Creating WebRTCHostManager.');
      const manager = new WebRTCHostManager({
        stream: localStream,
        socket,
        roomId,
        iceServers,
        onPeerStateChange,
      });
      hostManagerRef.current = manager;

      return () => {
        console.log('[useWebRTC] Destroying WebRTCHostManager.');
        manager.destroy();
        hostManagerRef.current = null;
      };
    } else {
      const { socket, roomId, viewerId, onStream, onStreamLost, onStatusChange, signalReady } = params;

      console.log('[useWebRTC] Creating WebRTCViewerManager.');
      const manager = new WebRTCViewerManager({
        socket,
        roomId,
        viewerId,
        iceServers,
        onStream: (stream) => {
          onStatusChange('connected');
          onStream(stream);
        },
        onStreamLost: () => {
          onStatusChange('host_disconnected');
          onStreamLost();
        },
        onConnectionStateChange: (state) => {
          if (state === 'connecting' || state === 'new') {
            onStatusChange('connecting');
          } else if (state === 'connected') {
            onStatusChange('connected');
          } else if (state === 'failed' || state === 'closed') {
            onStatusChange('failed');
          }
        },
      });
      viewerManagerRef.current = manager;

      if (signalReady) {
        onStatusChange('connecting');
        manager.signalReady();
      }

      return () => {
        console.log('[useWebRTC] Destroying WebRTCViewerManager.');
        manager.destroy();
        viewerManagerRef.current = null;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.role, params.socket, params.roomId]);

  const replaceStream = useCallback(async (newStream: MediaStream) => {
    if (hostManagerRef.current) {
      await hostManagerRef.current.replaceStream(newStream);
    }
  }, []);

  const reconnect = useCallback(() => {
    if (viewerManagerRef.current) {
      viewerManagerRef.current.signalReady();
    }
  }, []);

  if (params.role === 'host') {
    return { replaceStream };
  } else {
    return { reconnect };
  }
}
