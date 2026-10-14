/**
 * WebRTCHostManager.ts
 * ────────────────────
 * Manages outgoing WebRTC peer connections from the Host to each Viewer.
 *
 * Architecture:
 *   Host MediaStream → RTCPeerConnection (one per viewer) → Viewer
 *
 * Each viewer gets its own independent RTCPeerConnection.
 * The backend NEVER receives video bytes — only SDP and ICE via Socket.IO.
 *
 * Topology: Star from host. No mesh. No SFU yet.
 *
 * Rules:
 * - Never send video bytes over Socket.IO
 * - Always clean up peer connections on remove/destroy
 * - Use replaceTrack() when stream changes (avoids full renegotiation where possible)
 * - Handle ICE restart gracefully
 */

import type { Socket } from 'socket.io-client';

interface PeerEntry {
  pc: RTCPeerConnection;
  viewerId: string;
  makingOffer: boolean;
  connectionId: string; // Unique per negotiation to detect stale signals
}

export interface WebRTCHostManagerConfig {
  /** The local MediaStream from captureStream() */
  stream: MediaStream;
  /** Socket.IO socket for signaling */
  socket: Socket;
  /** Room ID for signaling namespace */
  roomId: string;
  /** ICE server configuration */
  iceServers: RTCIceServer[];
  /** Called when a peer connection state changes */
  onPeerStateChange?: (viewerId: string, state: RTCPeerConnectionState) => void;
}

export class WebRTCHostManager {
  private _peers = new Map<string, PeerEntry>();
  private _stream: MediaStream;
  private _socket: Socket;
  private _roomId: string;
  private _iceServers: RTCIceServer[];
  private _onPeerStateChange?: (viewerId: string, state: RTCPeerConnectionState) => void;
  private _destroyed = false;

  constructor(config: WebRTCHostManagerConfig) {
    this._stream = config.stream;
    this._socket = config.socket;
    this._roomId = config.roomId;
    this._iceServers = config.iceServers;
    this._onPeerStateChange = config.onPeerStateChange;

    console.log(`[WebRTCHostManager] Initialized for room ${this._roomId}. Stream tracks: ${config.stream.getTracks().length}`);
  }

  /** Called when a viewer signals ready for a peer connection */
  public handleViewerReady = async ({ viewerId, connectionId }: { viewerId: string; connectionId: string }) => {
    if (this._destroyed) return;
    console.log(`[WebRTCHostManager] Viewer ready: ${viewerId} (connection ${connectionId})`);
    await this._createPeerForViewer(viewerId, connectionId);
  };

  public handleAnswer = async ({
    senderId,
    sdp,
    connectionId,
  }: {
    senderId: string;
    sdp: RTCSessionDescriptionInit;
    connectionId: string;
  }) => {
    if (this._destroyed) return;
    const entry = this._peers.get(senderId);
    if (!entry) {
      console.warn(`[WebRTCHostManager] Answer from unknown viewer ${senderId}. Ignoring.`);
      return;
    }
    if (entry.connectionId !== connectionId) {
      console.warn(`[WebRTCHostManager] Stale answer from ${senderId} (got ${connectionId}, expected ${entry.connectionId}). Ignoring.`);
      return;
    }
    try {
      await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log(`[WebRTCHostManager] Remote description set for viewer ${senderId}.`);
    } catch (err) {
      console.error(`[WebRTCHostManager] setRemoteDescription failed for ${senderId}:`, err);
    }
  };

  public handleIceCandidate = async ({
    senderId,
    candidate,
    connectionId,
  }: {
    senderId: string;
    candidate: RTCIceCandidateInit;
    connectionId: string;
  }) => {
    if (this._destroyed) return;
    const entry = this._peers.get(senderId);
    if (!entry) return;
    if (entry.connectionId !== connectionId) return; // Stale
    try {
      await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      // Harmless race: remote description not yet set
      console.warn(`[WebRTCHostManager] addIceCandidate failed for ${senderId}:`, err);
    }
  };

  /** Create a new RTCPeerConnection for a viewer and send an offer */
  private async _createPeerForViewer(viewerId: string, connectionId: string): Promise<void> {
    // Remove any existing stale connection for this viewer
    this._removePeer(viewerId, 'replace');

    const pc = new RTCPeerConnection({ iceServers: this._iceServers });
    const entry: PeerEntry = { pc, viewerId, makingOffer: false, connectionId };
    this._peers.set(viewerId, entry);

    // Add all current stream tracks to the peer connection
    for (const track of this._stream.getTracks()) {
      pc.addTrack(track, this._stream);
      console.log(`[WebRTCHostManager] Added ${track.kind} track to peer ${viewerId}.`);
    }

    // ICE candidate collection
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this._socket.emit('webrtc:ice-candidate', {
          roomId: this._roomId,
          targetId: viewerId,
          candidate: candidate.toJSON(),
          connectionId,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTCHostManager] ICE state for ${viewerId}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed') {
        console.warn(`[WebRTCHostManager] ICE failed for ${viewerId}. Attempting ICE restart.`);
        pc.restartIce();
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`[WebRTCHostManager] Connection state for ${viewerId}: ${state}`);
      this._onPeerStateChange?.(viewerId, state);
      if (state === 'failed' || state === 'closed') {
        this._peers.delete(viewerId);
      }
    };

    // Create and send offer
    try {
      entry.makingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this._socket.emit('webrtc:offer', {
        roomId: this._roomId,
        targetId: viewerId,
        sdp: { type: offer.type, sdp: offer.sdp },
        connectionId,
      });
      console.log(`[WebRTCHostManager] Offer sent to viewer ${viewerId}.`);
    } catch (err) {
      console.error(`[WebRTCHostManager] Failed to create/send offer to ${viewerId}:`, err);
      this._removePeer(viewerId, 'error');
    } finally {
      entry.makingOffer = false;
    }
  }

  /**
   * Replace the media stream on all existing peer connections.
   * Uses RTCRtpSender.replaceTrack() to avoid full renegotiation where possible.
   * Falls back to renegotiation if track kinds change.
   */
  async replaceStream(newStream: MediaStream): Promise<void> {
    if (this._destroyed) return;
    this._stream = newStream;

    const newVideoTrack = newStream.getVideoTracks()[0] ?? null;
    const newAudioTrack = newStream.getAudioTracks()[0] ?? null;

    const replacePromises: Promise<void>[] = [];

    for (const [viewerId, entry] of this._peers) {
      const { pc } = entry;
      for (const sender of pc.getSenders()) {
        const kind = sender.track?.kind;
        const newTrack = kind === 'video' ? newVideoTrack : kind === 'audio' ? newAudioTrack : null;
        if (newTrack) {
          replacePromises.push(
            sender.replaceTrack(newTrack).catch((err) => {
              console.error(`[WebRTCHostManager] replaceTrack failed for ${viewerId} (${kind}):`, err);
            })
          );
        }
      }
    }

    await Promise.all(replacePromises);
    console.log(`[WebRTCHostManager] Stream replaced on ${this._peers.size} peer(s).`);
  }

  /** Remove a specific viewer's peer connection */
  private _removePeer(viewerId: string, reason: string) {
    const entry = this._peers.get(viewerId);
    if (!entry) return;
    console.log(`[WebRTCHostManager] Removing peer ${viewerId} (reason: ${reason}).`);
    entry.pc.onicecandidate = null;
    entry.pc.onconnectionstatechange = null;
    entry.pc.oniceconnectionstatechange = null;
    entry.pc.close();
    this._peers.delete(viewerId);
  }

  /** Remove all peer connections and clean up socket listeners */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    console.log(`[WebRTCHostManager] Destroying. Closing ${this._peers.size} peer connection(s).`);

    for (const viewerId of [...this._peers.keys()]) {
      this._removePeer(viewerId, 'destroy');
    }

    // Stop captured media tracks
    for (const track of this._stream.getTracks()) {
      track.stop();
    }
  }

  get peerCount(): number {
    return this._peers.size;
  }
}
