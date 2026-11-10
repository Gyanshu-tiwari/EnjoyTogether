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
 * - Provide getOutboundStats for diagnostics
 */

import type { Socket } from 'socket.io-client';

export interface VideoEncodingProfile {
  targetWidth: number;
  targetHeight: number;
  maxBitrate: number;
  maxFramerate: number;
  degradationPreference: RTCDegradationPreference;
}

export const DEFAULT_VIDEO_ENCODING_PROFILE: VideoEncodingProfile = {
  targetWidth: 1280,
  targetHeight: 720,
  maxBitrate: 3_000_000,
  maxFramerate: 30,
  degradationPreference: 'maintain-framerate',
};

/**
 * Munges SDP to enforce stereo, high-fidelity bitrate (128kbps), and CBR for Opus audio.
 * Prevents WebRTC from defaulting to mono speech with voice activity suppression on movie tracks.
 */
export function tuneOpusSdp(sdp: string): string {
  return sdp.replace(/a=fmtp:(\d+)\s+([^\r\n]+)/g, (line, payloadType, params) => {
    const isOpus = payloadType === '111' || sdp.includes(`a=rtpmap:${payloadType} opus/48000`);
    if (isOpus) {
      let tuned = params;
      if (!tuned.includes('stereo=')) tuned += ';stereo=1';
      if (!tuned.includes('sprop-stereo=')) tuned += ';sprop-stereo=1';
      if (!tuned.includes('maxaveragebitrate=')) tuned += ';maxaveragebitrate=128000';
      if (!tuned.includes('cbr=')) tuned += ';cbr=1';
      return `a=fmtp:${payloadType} ${tuned}`;
    }
    return line;
  });
}

export interface HostMediaStats {
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
  bytesSent: number;
  packetsSent: number;
  framesEncoded: number;
  framesPerSecond: number;
  roundTripTime?: number;
  diagnosis: 'no_outgoing_media' | 'transmitting' | 'ice_failed' | 'signaling_pending' | 'unknown';
}

interface PeerEntry {
  pc: RTCPeerConnection;
  viewerId: string;
  makingOffer: boolean;
  connectionId: string; // Unique per negotiation to detect stale signals
  pendingCandidates: RTCIceCandidateInit[];
  statsInfo: {
    localCandidatesGathered: number;
    remoteCandidatesReceived: number;
    candidatesAdded: number;
    candidateErrors: number;
  };
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
  /** Optional video encoding profile overrides */
  videoProfile?: Partial<VideoEncodingProfile>;
  /** Optional source media dimensions from LocalMediaSource descriptor */
  sourceDimensions?: { width?: number | null; height?: number | null };
  /** Called when a peer connection state changes */
  onPeerStateChange?: (viewerId: string, state: RTCPeerConnectionState) => void;
}

export class WebRTCHostManager {
  private _peers = new Map<string, PeerEntry>();
  private _stream: MediaStream;
  private _socket: Socket;
  private _roomId: string;
  private _iceServers: RTCIceServer[];
  private _videoProfile: VideoEncodingProfile;
  private _sourceDimensions?: { width?: number | null; height?: number | null };
  private _onPeerStateChange?: (viewerId: string, state: RTCPeerConnectionState) => void;
  private _destroyed = false;

  constructor(config: WebRTCHostManagerConfig) {
    this._stream = config.stream;
    this._socket = config.socket;
    this._roomId = config.roomId;
    this._iceServers = config.iceServers;
    this._sourceDimensions = config.sourceDimensions;
    this._videoProfile = {
      ...DEFAULT_VIDEO_ENCODING_PROFILE,
      ...(config.videoProfile || {}),
    };
    this._onPeerStateChange = config.onPeerStateChange;

    console.log(
      `[WebRTCHostManager] Initialized for room ${this._roomId}. Stream tracks: ${config.stream.getTracks().length}, ` +
      `profile: target=${this._videoProfile.targetWidth}x${this._videoProfile.targetHeight}, maxBitrate=${this._videoProfile.maxBitrate}, ` +
      `maxFps=${this._videoProfile.maxFramerate}, degPref=${this._videoProfile.degradationPreference}`
    );
    for (const track of config.stream.getTracks()) {
      console.log(`[WebRTCHostManager] Stream track: kind=${track.kind}, id=${track.id}, readyState=${track.readyState}, enabled=${track.enabled}`);
    }
  }

  /** Called when a viewer signals ready for a peer connection */
  public handleViewerReady = async ({ viewerId, connectionId }: { viewerId: string; connectionId: string }) => {
    if (this._destroyed) return;

    // Avoid unnecessary reconnection loops on healthy peer or currently negotiating peer with same connectionId
    const existing = this._peers.get(viewerId);
    if (existing && existing.connectionId === connectionId) {
      if (existing.pc.connectionState === 'connected') {
        console.log(`[WebRTCHostManager] Peer ${viewerId} is already connected on connectionId ${connectionId}. Skipping redundant negotiation.`);
        return;
      }
      if (existing.pc.signalingState !== 'closed' && existing.pc.connectionState !== 'failed' && existing.pc.connectionState !== 'closed') {
        console.log(`[WebRTCHostManager] Peer ${viewerId} is already negotiating on connectionId ${connectionId} (signaling: ${existing.pc.signalingState}, conn: ${existing.pc.connectionState}). Skipping duplicate negotiation.`);
        return;
      }
    }

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
      console.log(`[WebRTCHostManager] Remote description set for viewer ${senderId} (conn: ${connectionId}).`);
      this._logPeerLifecycle(entry, 'remote_description_set');

      // Drain buffered ICE candidates
      if (entry.pendingCandidates.length > 0) {
        console.log(`[WebRTCHostManager] Flushing ${entry.pendingCandidates.length} buffered ICE candidates for ${senderId}.`);
        for (const cand of entry.pendingCandidates) {
          try {
            await entry.pc.addIceCandidate(new RTCIceCandidate(cand));
            entry.statsInfo.candidatesAdded++;
          } catch (iceErr) {
            entry.statsInfo.candidateErrors++;
            console.warn(`[WebRTCHostManager] Error adding buffered ICE candidate for ${senderId}:`, iceErr);
          }
        }
        entry.pendingCandidates = [];
      }
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
    entry.statsInfo.remoteCandidatesReceived++;
    if (entry.connectionId !== connectionId) return; // Stale

    if (!entry.pc.remoteDescription) {
      // Buffer until answer remoteDescription is set
      entry.pendingCandidates.push(candidate);
      return;
    }

    try {
      await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
      entry.statsInfo.candidatesAdded++;
    } catch (err) {
      entry.statsInfo.candidateErrors++;
      console.warn(`[WebRTCHostManager] addIceCandidate failed for ${senderId}:`, err);
    }
  };

  private _logPeerLifecycle(entry: PeerEntry, event: string): void {
    console.log(
      `[WebRTC:Host] [${event}] roomId=${this._roomId} viewerId=${entry.viewerId} connId=${entry.connectionId} ` +
      `connState=${entry.pc.connectionState} iceState=${entry.pc.iceConnectionState} ` +
      `iceGathering=${entry.pc.iceGatheringState} signaling=${entry.pc.signalingState} ` +
      `hasLocalDesc=${Boolean(entry.pc.localDescription)} hasRemoteDesc=${Boolean(entry.pc.remoteDescription)} ` +
      `localCandGathered=${entry.statsInfo.localCandidatesGathered} remoteCandRecv=${entry.statsInfo.remoteCandidatesReceived} ` +
      `candAdded=${entry.statsInfo.candidatesAdded} candErrors=${entry.statsInfo.candidateErrors} ` +
      `ts=${new Date().toISOString()}`
    );
  }

  /** Create a new RTCPeerConnection for a viewer and send an offer */
  private async _createPeerForViewer(viewerId: string, connectionId: string): Promise<void> {
    // Remove any existing stale connection for this viewer
    this._removePeer(viewerId, 'replace');

    const pc = new RTCPeerConnection({ iceServers: this._iceServers });
    const entry: PeerEntry = {
      pc,
      viewerId,
      makingOffer: false,
      connectionId,
      pendingCandidates: [],
      statsInfo: {
        localCandidatesGathered: 0,
        remoteCandidatesReceived: 0,
        candidatesAdded: 0,
        candidateErrors: 0,
      },
    };
    this._peers.set(viewerId, entry);

    // Add all current stream tracks to the peer connection
    for (const track of this._stream.getTracks()) {
      pc.addTrack(track, this._stream);
      console.log(`[WebRTCHostManager] Added ${track.kind} track to peer ${viewerId}. id=${track.id}, state=${track.readyState}, enabled=${track.enabled}`);
    }

    // Ensure transceivers are configured for sendonly from host
    for (const transceiver of pc.getTransceivers()) {
      if (transceiver.direction !== 'sendonly') {
        transceiver.direction = 'sendonly';
      }
      if (transceiver.sender.track?.kind === 'video') {
        if ('degradationPreference' in transceiver) {
          try {
            (transceiver as any).degradationPreference = this._videoProfile.degradationPreference;
          } catch (e) {
            console.warn('[WebRTCHostManager] Could not set degradationPreference on transceiver:', e);
          }
        }
      }
    }

    // Prioritize hardware-accelerated H.264 video codec if available
    this._configureCodecPreferences(pc);

    // Apply video sender encoding constraints (framerate, bitrate ceiling, resolution scaling)
    await this._configureVideoSender(pc);

    // ICE candidate collection
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        entry.statsInfo.localCandidatesGathered++;
        this._socket.emit('webrtc:ice-candidate', {
          roomId: this._roomId,
          targetId: viewerId,
          candidate: candidate.toJSON(),
          connectionId,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      this._logPeerLifecycle(entry, 'ice_state_change');
      if (pc.iceConnectionState === 'failed') {
        console.warn(`[WebRTCHostManager] ICE failed for ${viewerId}. Attempting ICE restart.`);
        pc.restartIce();
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this._logPeerLifecycle(entry, 'connection_state_change');
      this._onPeerStateChange?.(viewerId, state);
      if (state === 'failed' || state === 'closed') {
        this._removePeer(viewerId, state);
      }
    };

    // Create and send offer with tuned stereo Opus SDP
    try {
      entry.makingOffer = true;
      const offer = await pc.createOffer();
      const tunedSdp = tuneOpusSdp(offer.sdp || '');
      const tunedOffer = new RTCSessionDescription({ type: offer.type, sdp: tunedSdp });
      await pc.setLocalDescription(tunedOffer);
      this._logPeerLifecycle(entry, 'offer_created');
      this._socket.emit('webrtc:offer', {
        roomId: this._roomId,
        targetId: viewerId,
        sdp: { type: tunedOffer.type, sdp: tunedOffer.sdp },
        connectionId,
      });
      console.log(`[WebRTCHostManager] Offer sent to viewer ${viewerId} with stereo Opus parameters.`);
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
   * Falls back to renegotiation if track kinds change or a sender is missing.
   */
  async replaceStream(newStream: MediaStream): Promise<void> {
    if (this._destroyed) return;
    this._stream = newStream;

    const newVideoTrack = newStream.getVideoTracks()[0] ?? null;
    const newAudioTrack = newStream.getAudioTracks()[0] ?? null;

    console.log(`[WebRTCHostManager] replaceStream called. Video: ${newVideoTrack?.id}, Audio: ${newAudioTrack?.id}`);

    const replacePromises: Promise<void>[] = [];

    for (const [viewerId, entry] of this._peers) {
      const { pc } = entry;
      let videoSenderFound = false;
      let audioSenderFound = false;

      for (const sender of pc.getSenders()) {
        const kind = sender.track?.kind;
        if (kind === 'video') {
          videoSenderFound = true;
          if (newVideoTrack) {
            replacePromises.push(
              sender
                .replaceTrack(newVideoTrack)
                .then(async () => {
                  await this._configureVideoSender(pc, newVideoTrack);
                })
                .catch((err) => {
                  console.error(`[WebRTCHostManager] replaceTrack failed for ${viewerId} (video):`, err);
                })
            );
          }
        } else if (kind === 'audio') {
          audioSenderFound = true;
          if (newAudioTrack) {
            replacePromises.push(
              sender.replaceTrack(newAudioTrack).catch((err) => {
                console.error(`[WebRTCHostManager] replaceTrack failed for ${viewerId} (audio):`, err);
              })
            );
          }
        }
      }

      // If a track kind was added that had no sender, renegotiate for this viewer
      if ((newVideoTrack && !videoSenderFound) || (newAudioTrack && !audioSenderFound)) {
        console.log(`[WebRTCHostManager] Senders missing on peer ${viewerId}. Re-negotiating peer...`);
        replacePromises.push(this._createPeerForViewer(viewerId, crypto.randomUUID()));
      }
    }

    await Promise.all(replacePromises);
    console.log(`[WebRTCHostManager] Stream replaced on ${this._peers.size} peer(s).`);
  }

  /**
   * Prioritize hardware-accelerated H.264 video codec if available to minimize CPU encoding stutter.
   */
  private _configureCodecPreferences(pc: RTCPeerConnection): void {
    const videoTransceiver = pc.getTransceivers().find((t) => t.sender.track?.kind === 'video');
    if (
      videoTransceiver &&
      typeof (videoTransceiver as any).setCodecPreferences === 'function' &&
      typeof RTCRtpSender.getCapabilities === 'function'
    ) {
      try {
        const capabilities = RTCRtpSender.getCapabilities('video');
        if (capabilities && capabilities.codecs) {
          const h264Codecs = capabilities.codecs.filter((c) => c.mimeType.toLowerCase() === 'video/h264');
          const otherCodecs = capabilities.codecs.filter((c) => c.mimeType.toLowerCase() !== 'video/h264');
          if (h264Codecs.length > 0) {
            (videoTransceiver as any).setCodecPreferences([...h264Codecs, ...otherCodecs]);
            console.log('[WebRTCHostManager] Prioritized H.264 hardware encoding for smooth playback.');
          }
        }
      } catch (err) {
        console.warn('[WebRTCHostManager] Failed to set codec preferences:', err);
      }
    }
  }

  /**
   * Applies video encoding configuration (scaleResolutionDownBy, maxFramerate, maxBitrate, degradationPreference)
   * to the peer's video sender without modifying or downscaling the original local video element.
   */
  private async _configureVideoSender(pc: RTCPeerConnection, overrideTrack?: MediaStreamTrack | null): Promise<void> {
    const videoSender = pc.getSenders().find((s) => (overrideTrack ? s.track === overrideTrack : s.track?.kind === 'video'));
    if (!videoSender) return;

    try {
      const track = overrideTrack || videoSender.track;
      const settings = track?.getSettings ? track.getSettings() : undefined;
      const sourceWidth = settings?.width || this._sourceDimensions?.width || 0;
      const sourceHeight = settings?.height || this._sourceDimensions?.height || 0;

      let scale = 1.0;
      if (sourceHeight >= 1440) {
        scale = 2.0; // 1440p+ cleanly downscaled to 720p without non-integer CPU burden
      } else if (sourceHeight > 1080) {
        scale = 1.5;
      } else {
        scale = 1.0; // 1080p and 720p retain native scaling to avoid CPU encoding jitter
      }

      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      params.degradationPreference = this._videoProfile.degradationPreference;
      params.encodings[0].scaleResolutionDownBy = scale;
      params.encodings[0].maxBitrate = this._videoProfile.maxBitrate;
      params.encodings[0].maxFramerate = this._videoProfile.maxFramerate;

      await videoSender.setParameters(params);
      console.log(
        `[WebRTCHostManager] Video sender encoding applied: scale=${scale} (source=${sourceWidth}x${sourceHeight} -> target=${this._videoProfile.targetWidth}x${this._videoProfile.targetHeight}), ` +
        `maxBitrate=${this._videoProfile.maxBitrate}, maxFramerate=${this._videoProfile.maxFramerate}, degPref=${this._videoProfile.degradationPreference}`
      );
    } catch (err) {
      console.warn(`[WebRTCHostManager] Failed to apply video sender parameters:`, err);
    }
  }

  /**
   * Update source dimensions and re-apply encoding parameters if needed
   */
  public updateSourceDimensions(dimensions: { width?: number | null; height?: number | null }): void {
    this._sourceDimensions = dimensions;
    for (const entry of this._peers.values()) {
      this._configureVideoSender(entry.pc);
    }
  }

  /**
   * Inspect outbound WebRTC stats for each viewer (outbound-rtp video).
   * Distinguishes no outgoing media vs active transmission, ICE failure, or signaling failure.
   */
  async getOutboundStats(viewerId?: string): Promise<HostMediaStats[]> {
    const results: HostMediaStats[] = [];
    const targets = viewerId
      ? (this._peers.has(viewerId) ? [[viewerId, this._peers.get(viewerId)!] as const] : [])
      : Array.from(this._peers.entries());

    for (const [id, entry] of targets) {
      try {
        const stats = await entry.pc.getStats();
        let bytesSent = 0;
        let packetsSent = 0;
        let framesEncoded = 0;
        let framesPerSecond = 0;
        let roundTripTime: number | undefined;

        let selectedPair: HostMediaStats['selectedCandidatePair'] = undefined;
        const candidateMap = new Map<string, any>();

        stats.forEach((report) => {
          if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
            candidateMap.set(report.id, report);
          }
        });

        stats.forEach((report) => {
          if (report.type === 'outbound-rtp' && (report.kind === 'video' || report.mediaType === 'video')) {
            bytesSent = report.bytesSent || 0;
            packetsSent = report.packetsSent || 0;
            framesEncoded = report.framesEncoded || 0;
            framesPerSecond = report.framesPerSecond || 0;
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

        let diagnosis: HostMediaStats['diagnosis'] = 'unknown';
        if (!entry.pc.remoteDescription) {
          diagnosis = 'signaling_pending';
        } else if (entry.pc.iceConnectionState === 'failed' || entry.pc.connectionState === 'failed') {
          diagnosis = 'ice_failed';
        } else if (bytesSent === 0) {
          diagnosis = 'no_outgoing_media';
        } else if (bytesSent > 0 && framesEncoded > 0) {
          diagnosis = 'transmitting';
        }

        results.push({
          viewerId: id,
          connectionId: entry.connectionId,
          connectionState: entry.pc.connectionState,
          iceConnectionState: entry.pc.iceConnectionState,
          iceGatheringState: entry.pc.iceGatheringState,
          signalingState: entry.pc.signalingState,
          hasLocalDescription: Boolean(entry.pc.localDescription),
          hasRemoteDescription: Boolean(entry.pc.remoteDescription),
          localCandidatesGathered: entry.statsInfo.localCandidatesGathered,
          remoteCandidatesReceived: entry.statsInfo.remoteCandidatesReceived,
          candidatesAdded: entry.statsInfo.candidatesAdded,
          candidateErrors: entry.statsInfo.candidateErrors,
          selectedCandidatePair: selectedPair,
          bytesSent,
          packetsSent,
          framesEncoded,
          framesPerSecond,
          roundTripTime,
          diagnosis,
        });
      } catch (err) {
        console.warn(`[WebRTCHostManager] getStats failed for ${id}:`, err);
      }
    }

    return results;
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
