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
 * - Provides stats inspection (getInboundStats) and connection watchdog
 *
 * The backend NEVER receives video bytes — only SDP/ICE via Socket.IO.
 */

import type { Socket } from 'socket.io-client';
import { tuneOpusSdp } from './WebRTCHostManager';

export interface ViewerMediaStats {
  viewerId: string;
  connectionId: string;
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  iceGatheringState: RTCIceGatheringState;
  signalingState: RTCSignalingState;
  hasLocalDescription: boolean;
  hasRemoteDescription: boolean;
  localCandidatesGathered: number;
  remoteCandidatesReceived: number;
  candidatesAdded: number;
  candidateErrors: number;
  selectedCandidatePair?: {
    state: string;
    localCandidateType?: string; // 'host' | 'srflx' | 'relay'
    remoteCandidateType?: string;
    currentRoundTripTime?: number;
    bytesSent?: number;
    bytesReceived?: number;
  };
  bytesReceived: number;
  packetsReceived: number;
  packetsLost: number;
  framesReceived: number;
  framesDecoded: number;
  framesDropped: number;
  framesPerSecond: number;
  roundTripTime?: number;
  diagnosis:
    | 'signaling_pending'
    | 'ice_failed'
    | 'no_incoming_media'
    | 'media_received_not_decoded'
    | 'media_decoded_not_rendered'
    | 'healthy'
    | 'unknown';
}

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
  private _pendingIceCandidates: RTCIceCandidateInit[] = [];

  private _statsInfo = {
    localCandidatesGathered: 0,
    remoteCandidatesReceived: 0,
    candidatesAdded: 0,
    candidateErrors: 0,
  };
  private _deferredOffer: { sdp: RTCSessionDescriptionInit; connectionId: string } | null = null;

  // Watchdog timers
  private _readyRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private _connectionTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

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

  private _logPeerLifecycle(event: string): void {
    if (!this._pc) return;
    console.log(
      `[WebRTC:Viewer] [${event}] roomId=${this._roomId} viewerId=${this._viewerId} connId=${this._connectionId} ` +
      `connState=${this._pc.connectionState} iceState=${this._pc.iceConnectionState} ` +
      `iceGathering=${this._pc.iceGatheringState} signaling=${this._pc.signalingState} ` +
      `hasLocalDesc=${Boolean(this._pc.localDescription)} hasRemoteDesc=${Boolean(this._pc.remoteDescription)} ` +
      `localCandGathered=${this._statsInfo.localCandidatesGathered} remoteCandRecv=${this._statsInfo.remoteCandidatesReceived} ` +
      `candAdded=${this._statsInfo.candidatesAdded} candErrors=${this._statsInfo.candidateErrors} ` +
      `ts=${new Date().toISOString()}`
    );
  }

  /**
   * Signal to the host that this viewer is ready for a peer connection.
   * Starts a watchdog timer to retry or fail if the host does not respond.
   */
  signalReady(force: boolean = false): void {
    if (this._destroyed) return;

    // If we are already connected, do not re-signal unless forced (e.g. user clicked Retry)
    if (!force && this._pc && this._pc.connectionState === 'connected') {
      console.log('[WebRTCViewerManager] Already connected to host stream. Skipping redundant signalReady.');
      return;
    }

    // If an answer is currently in flight or remote description is already set for the current connectionId,
    // don't blow away the active negotiation on duplicate triggers
    if (!force && this._connectionId && this._makingAnswer) {
      console.log('[WebRTCViewerManager] Answer is already being generated for current connection. Skipping redundant signalReady.');
      return;
    }

    // Only generate a new connectionId if we don't have an active one or if forced
    if (force || !this._connectionId) {
      this._clearWatchdogs();
      this._connectionId = crypto.randomUUID();
    }

    console.log(`[WebRTCViewerManager] Signaling ready to host. Connection ID: ${this._connectionId} (viewer: ${this._viewerId})`);

    this._socket.emit('webrtc:viewer-ready', {
      roomId: this._roomId,
      viewerId: this._viewerId,
      connectionId: this._connectionId,
    });

    // 1st watchdog: re-signal ready if host has not responded with an offer within 4s
    if (!this._readyRetryTimer) {
      this._readyRetryTimer = setTimeout(() => {
        if (this._destroyed || this._pc?.remoteDescription) return;
        console.warn('[WebRTCViewerManager] No offer received after 4s. Re-emitting viewer-ready signal with current connectionId...');
        this._socket.emit('webrtc:viewer-ready', {
          roomId: this._roomId,
          viewerId: this._viewerId,
          connectionId: this._connectionId,
        });
      }, 4000);
    }

    // 2nd watchdog: if peer is still not connected after 15s, transition to failed
    if (!this._connectionTimeoutTimer) {
      this._connectionTimeoutTimer = setTimeout(() => {
        if (this._destroyed) return;
        if (!this._pc || this._pc.connectionState !== 'connected') {
          console.error('[WebRTCViewerManager] Connection watchdog timeout (15s). WebRTC setup failed.');
          this._onConnectionStateChange?.('failed');
        }
      }, 15000);
    }
  }

  /** Retry connection from scratch */
  retry(): void {
    if (this._destroyed) return;
    console.log('[WebRTCViewerManager] Retrying connection...');
    this._closePeer(true);
    this._connectionId = ''; // Reset so a fresh UUID is generated
    this.signalReady(true);
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

    if (this._readyRetryTimer) {
      clearTimeout(this._readyRetryTimer);
      this._readyRetryTimer = null;
    }

    // Glare-safe: if we are currently generating/setting an answer, queue this offer so it isn't dropped!
    if (this._makingAnswer) {
      console.warn(`[WebRTCViewerManager] Offer arrived while making answer for ${this._connectionId} — queueing offer for ${connectionId}.`);
      this._deferredOffer = { sdp, connectionId };
      return;
    }

    // If an offer arrives with a new connectionId from the host, reset peer
    if (this._pc && connectionId !== this._connectionId) {
      console.log(`[WebRTCViewerManager] New connectionId received (${connectionId}). Rebuilding peer.`);
      this._closePeer(false); // preserve watchdogs!
    }
    this._connectionId = connectionId;

    if (!this._pc) {
      this._createPeer();
    }

    // Re-arm connection timeout if not running
    if (!this._connectionTimeoutTimer) {
      this._connectionTimeoutTimer = setTimeout(() => {
        if (this._destroyed) return;
        if (!this._pc || this._pc.connectionState !== 'connected') {
          console.error('[WebRTCViewerManager] Connection watchdog timeout (15s). WebRTC setup failed.');
          this._onConnectionStateChange?.('failed');
        }
      }, 15000);
    }

    const pc = this._pc!;

    try {
      this._makingAnswer = true;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log(`[WebRTCViewerManager] Remote description set from offer (${connectionId}).`);
      this._logPeerLifecycle('remote_description_set');

      // Drain any buffered ICE candidates that arrived before setRemoteDescription
      if (this._pendingIceCandidates.length > 0) {
        console.log(`[WebRTCViewerManager] Flushing ${this._pendingIceCandidates.length} buffered ICE candidates.`);
        for (const cand of this._pendingIceCandidates) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
            this._statsInfo.candidatesAdded++;
          } catch (iceErr) {
            this._statsInfo.candidateErrors++;
            console.warn('[WebRTCViewerManager] Error adding buffered ICE candidate:', iceErr);
          }
        }
        this._pendingIceCandidates = [];
      }

      const answer = await pc.createAnswer();
      const tunedSdp = tuneOpusSdp(answer.sdp || '');
      const tunedAnswer = new RTCSessionDescription({ type: answer.type, sdp: tunedSdp });
      await pc.setLocalDescription(tunedAnswer);
      this._logPeerLifecycle('answer_created');
      this._socket.emit('webrtc:answer', {
        roomId: this._roomId,
        targetId: 'host',
        sdp: { type: tunedAnswer.type, sdp: tunedAnswer.sdp },
        connectionId,
        senderId: this._viewerId,
      });
      console.log(`[WebRTCViewerManager] Answer sent to host for connectionId=${connectionId} with stereo Opus parameters.`);
    } catch (err) {
      console.error('[WebRTCViewerManager] Failed to handle offer:', err);
    } finally {
      this._makingAnswer = false;
      if (this._deferredOffer && !this._destroyed) {
        const next = this._deferredOffer;
        this._deferredOffer = null;
        this.handleOffer(next);
      }
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
    if (this._destroyed) return;
    this._statsInfo.remoteCandidatesReceived++;

    // Accept candidate if it matches current connectionId OR if connectionId hasn't been set yet
    if (this._connectionId && connectionId !== this._connectionId) {
      console.log(`[WebRTCViewerManager] Candidate for non-current connectionId (${connectionId} vs ${this._connectionId}). Discarding.`);
      return;
    }

    if (!this._pc || !this._pc.remoteDescription) {
      // Buffer until remote description is set
      this._pendingIceCandidates.push(candidate);
      return;
    }

    try {
      await this._pc.addIceCandidate(new RTCIceCandidate(candidate));
      this._statsInfo.candidatesAdded++;
    } catch (err) {
      this._statsInfo.candidateErrors++;
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
      console.log(`[WebRTCViewerManager] ontrack fired: kind=${event.track.kind}, id=${event.track.id}, readyState=${event.track.readyState}`);
      const stream = this._incomingStream!;

      // Add track listeners for mute/unmute/ended
      event.track.onmute = () => {
        console.warn(`[WebRTCViewerManager] Remote track muted: ${event.track.kind}`);
      };
      event.track.onunmute = () => {
        console.log(`[WebRTCViewerManager] Remote track unmuted: ${event.track.kind}`);
        if (stream.getVideoTracks().length > 0) {
          this._onStream(new MediaStream(stream.getTracks()));
        }
      };
      event.track.onended = () => {
        console.log(`[WebRTCViewerManager] Remote track ended: ${event.track.kind}`);
      };

      if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach((track) => {
          if (!stream.getTrackById(track.id)) {
            stream.addTrack(track);
            console.log(`[WebRTCViewerManager] Added track ${track.id} (${track.kind}) from event.streams[0]`);
          }
        });
      } else if (event.track) {
        if (!stream.getTrackById(event.track.id)) {
          stream.addTrack(event.track);
          console.log(`[WebRTCViewerManager] Added track ${event.track.id} (${event.track.kind}) directly from event.track`);
        }
      }

      // Configure receiver jitter buffer target (250ms) to eliminate network micro-stutters and frame drops
      for (const receiver of pc.getReceivers()) {
        if ('jitterBufferTarget' in receiver) {
          (receiver as any).jitterBufferTarget = 250;
        } else if ('playoutDelayHint' in receiver) {
          (receiver as any).playoutDelayHint = 0.25;
        }
      }

      // Notify consumer once we have at least a video track with a new MediaStream instance
      if (stream.getVideoTracks().length > 0) {
        console.log(`[WebRTCViewerManager] Incoming stream ready with ${stream.getVideoTracks().length} video track(s) and ${stream.getAudioTracks().length} audio track(s).`);
        this._onStream(new MediaStream(stream.getTracks()));
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this._statsInfo.localCandidatesGathered++;
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
      this._logPeerLifecycle('ice_state_change');
      if (pc.iceConnectionState === 'failed') {
        console.warn('[WebRTCViewerManager] ICE failed. Requesting reconnect.');
        this._closePeer();
        this._onStreamLost();
        this._onConnectionStateChange?.('failed');
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`[WebRTCViewerManager] Connection state: ${state}`);
      this._logPeerLifecycle('connection_state_change');
      if (state === 'connected') {
        this._clearWatchdogs();
      }
      this._onConnectionStateChange?.(state);
      if (state === 'failed' || state === 'closed') {
        this._closePeer();
        this._onStreamLost();
      }
    };

    console.log('[WebRTCViewerManager] RTCPeerConnection created.');
  }

  /**
   * Inspect WebRTC stats on the viewer side (inbound-rtp video).
   * Distinguishes no incoming media, media received but not decoded, and healthy.
   */
  async getInboundStats(): Promise<ViewerMediaStats | null> {
    if (!this._pc) return null;
    try {
      const stats = await this._pc.getStats();
      let bytesReceived = 0;
      let packetsReceived = 0;
      let framesDecoded = 0;
      let framesReceived = 0;
      let framesDropped = 0;
      let framesPerSecond = 0;
      let packetsLost = 0;
      let roundTripTime: number | undefined;

      let selectedPair: ViewerMediaStats['selectedCandidatePair'] = undefined;
      const candidateMap = new Map<string, any>();

      stats.forEach((report) => {
        if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          candidateMap.set(report.id, report);
        }
      });

      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
          bytesReceived = report.bytesReceived || 0;
          packetsReceived = report.packetsReceived || 0;
          framesDecoded = report.framesDecoded || 0;
          framesReceived = report.framesReceived || 0;
          framesDropped = report.framesDropped || 0;
          framesPerSecond = report.framesPerSecond || 0;
          packetsLost = report.packetsLost || 0;
        } else if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated || report.selected)) {
          roundTripTime = report.currentRoundTripTime;
          const local = candidateMap.get(report.localCandidateId);
          const remote = candidateMap.get(report.remoteCandidateId);
          selectedPair = {
            state: report.state,
            localCandidateType: local?.candidateType,
            remoteCandidateType: remote?.candidateType,
            currentRoundTripTime: report.currentRoundTripTime,
            bytesSent: report.bytesSent,
            bytesReceived: report.bytesReceived,
          };
        }
      });

      let diagnosis: ViewerMediaStats['diagnosis'] = 'unknown';
      if (!this._pc.remoteDescription) {
        diagnosis = 'signaling_pending';
      } else if (this._pc.iceConnectionState === 'failed' || this._pc.connectionState === 'failed') {
        diagnosis = 'ice_failed';
      } else if (bytesReceived === 0) {
        diagnosis = 'no_incoming_media';
      } else if (bytesReceived > 0 && framesDecoded === 0) {
        diagnosis = 'media_received_not_decoded';
      } else if (framesDecoded > 0) {
        diagnosis = 'healthy';
      }

      return {
        viewerId: this._viewerId,
        connectionId: this._connectionId,
        connectionState: this._pc.connectionState,
        iceConnectionState: this._pc.iceConnectionState,
        iceGatheringState: this._pc.iceGatheringState,
        signalingState: this._pc.signalingState,
        hasLocalDescription: Boolean(this._pc.localDescription),
        hasRemoteDescription: Boolean(this._pc.remoteDescription),
        localCandidatesGathered: this._statsInfo.localCandidatesGathered,
        remoteCandidatesReceived: this._statsInfo.remoteCandidatesReceived,
        candidatesAdded: this._statsInfo.candidatesAdded,
        candidateErrors: this._statsInfo.candidateErrors,
        selectedCandidatePair: selectedPair,
        bytesReceived,
        packetsReceived,
        framesDecoded,
        framesReceived,
        framesDropped,
        framesPerSecond,
        packetsLost,
        roundTripTime,
        diagnosis,
      };
    } catch (err) {
      console.warn('[WebRTCViewerManager] getStats error:', err);
      return null;
    }
  }

  private _clearWatchdogs(): void {
    if (this._readyRetryTimer) {
      clearTimeout(this._readyRetryTimer);
      this._readyRetryTimer = null;
    }
    if (this._connectionTimeoutTimer) {
      clearTimeout(this._connectionTimeoutTimer);
      this._connectionTimeoutTimer = null;
    }
  }

  private _closePeer(clearWatchdogs = true): void {
    if (clearWatchdogs) {
      this._clearWatchdogs();
    }
    this._pendingIceCandidates = [];
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
