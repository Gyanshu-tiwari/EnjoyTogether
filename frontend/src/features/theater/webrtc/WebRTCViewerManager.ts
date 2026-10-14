/**
 * WebRTCViewerManager.ts
 * ──────────────────────
 * Manages the single RTCPeerConnection from a Viewer to the Host.
 *
 * The viewer:
 * - Signals readiness to the Host via socket
 * - Receives an SDP offer from the Host
 * - Creates an SDP answer and sends it back
 * - Collects ICE candidates and relays them
 * - Receives the Host's MediaStream via ontrack
 * - Exposes the stream for a <video srcObject={stream}> element
 *
 * The backend NEVER receives video bytes — only SDP/ICE via Socket.IO.
 */

import type { Socket } from 'socket.io-client';

export interface WebRTCViewerManagerConfig {
  /** Socket.IO socket for signaling */
  socket: Socket;
  /** Room ID for signaling namespace */
  roomId: string;
  /** Our viewer ID (userId) */
  viewerId: string;
  /** ICE server configuration */
  iceServers: RTCIceServer[];
  /** Called when the incoming MediaStream is received */
  onStream: (stream: MediaStream) => void;
  /** Called when stream is lost (host disconnected, etc.) */
  onStreamLost: () => void;
  /** Called when connection state changes */
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}

export class WebRTCViewerManager {
  private _pc: RTCPeerConnection | null = null;
  private _socket: Socket;
  private _roomId: string;
  private _viewerId: string;
  private _iceServers: RTCIceServer[];
  private _onStream: (stream: MediaStream) => void;
  private _onStreamLost: () => void;
  private _onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  private _connectionId: string = '';
  private _destroyed = false;
  private _incomingStream: MediaStream | null = null;
  private _makingAnswer = false;

  constructor(config: WebRTCViewerManagerConfig) {
    this._socket = config.socket;
    this._roomId = config.roomId;
    this._viewerId = config.viewerId;
    this._iceServers = config.iceServers;
    this._onStream = config.onStream;
    this._onStreamLost = config.onStreamLost;
    this._onConnectionStateChange = config.onConnectionStateChange;

    console.log(`[WebRTCViewerManager] Initialized for viewer ${this._viewerId} in room ${this._roomId}.`);
  }

  /**
   * Signal to the host that this viewer is ready for a peer connection.
   * The host will respond with a webrtc:offer.
   */
  signalReady(): void {
    if (this._destroyed) return;
    this._connectionId = crypto.randomUUID();
    console.log(`[WebRTCViewerManager] Signaling ready to host. Connection ID: ${this._connectionId}`);
    this._socket.emit('webrtc:viewer-ready', {
      roomId: this._roomId,
      viewerId: this._viewerId,
      connectionId: this._connectionId,
    });
  }

  public handleOffer = async ({
    sdp,
    connectionId,
  }: {
    senderId?: string;
    sdp: RTCSessionDescriptionInit;
    connectionId: string;
  }) => {
    if (this._destroyed) return;

    // A new offer from a different connectionId means the host restarted.
    // Close old peer and start fresh.
    if (this._pc && connectionId !== this._connectionId) {
      console.log(`[WebRTCViewerManager] New connectionId received (${connectionId}). Rebuilding peer.`);
      this._closePeer();
    }
    this._connectionId = connectionId;

    if (!this._pc) {
      this._createPeer();
    }

    const pc = this._pc!;

    // Glare-safe: if we're making an answer and another offer arrives, defer
    if (this._makingAnswer) {
      console.warn('[WebRTCViewerManager] Offer arrived while making answer — deferring.');
      return;
    }

    try {
      this._makingAnswer = true;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this._socket.emit('webrtc:answer', {
        roomId: this._roomId,
        targetId: 'host', // The backend routes this to the host socket
        sdp: { type: answer.type, sdp: answer.sdp },
        connectionId,
        senderId: this._viewerId,
      });
      console.log(`[WebRTCViewerManager] Answer sent to host.`);
    } catch (err) {
      console.error('[WebRTCViewerManager] Failed to handle offer:', err);
    } finally {
      this._makingAnswer = false;
    }
  };

  public handleIceCandidate = async ({
    candidate,
    connectionId,
  }: {
    senderId?: string;
    candidate: RTCIceCandidateInit;
    connectionId: string;
  }) => {
    if (this._destroyed || !this._pc) return;
    if (connectionId !== this._connectionId) return; // Stale
    try {
      await this._pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[WebRTCViewerManager] addIceCandidate failed:', err);
    }
  };

  public handleHostStreamEnded = () => {
    console.log('[WebRTCViewerManager] Host stream ended.');
    this._closePeer();
    this._incomingStream = null;
    this._onStreamLost();
  };

  private _createPeer(): void {
    const pc = new RTCPeerConnection({ iceServers: this._iceServers });
    this._pc = pc;
    this._incomingStream = new MediaStream();

    pc.ontrack = (event) => {
      console.log(`[WebRTCViewerManager] Track received: ${event.track.kind}`);
      const stream = this._incomingStream!;
      if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach((track) => {
          if (!stream.getTrackById(track.id)) {
            stream.addTrack(track);
          }
        });
      } else if (event.track) {
        if (!stream.getTrackById(event.track.id)) {
          stream.addTrack(event.track);
        }
      }
      // Notify once we have at least a video track
      if (stream.getVideoTracks().length > 0) {
        this._onStream(stream);
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this._socket.emit('webrtc:ice-candidate', {
          roomId: this._roomId,
          targetId: 'host',
          candidate: candidate.toJSON(),
          connectionId: this._connectionId,
          senderId: this._viewerId,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTCViewerManager] ICE state: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed') {
        console.warn('[WebRTCViewerManager] ICE failed. Requesting reconnect.');
        this._closePeer();
        this._onStreamLost();
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`[WebRTCViewerManager] Connection state: ${state}`);
      this._onConnectionStateChange?.(state);
      if (state === 'failed' || state === 'closed') {
        this._closePeer();
        this._onStreamLost();
      }
    };

    console.log('[WebRTCViewerManager] RTCPeerConnection created.');
  }

  private _closePeer(): void {
    if (!this._pc) return;
    this._pc.ontrack = null;
    this._pc.onicecandidate = null;
    this._pc.oniceconnectionstatechange = null;
    this._pc.onconnectionstatechange = null;
    this._pc.close();
    this._pc = null;

    if (this._incomingStream) {
      for (const track of this._incomingStream.getTracks()) {
        track.stop();
      }
      this._incomingStream = null;
    }
    console.log('[WebRTCViewerManager] Peer connection closed and tracks stopped.');
  }

  /** Get the current incoming media stream (may be null if not yet connected) */
  get stream(): MediaStream | null {
    return this._incomingStream;
  }

  /** Destroy all resources */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._closePeer();
    this._incomingStream = null;

    console.log('[WebRTCViewerManager] Destroyed.');
  }
}
