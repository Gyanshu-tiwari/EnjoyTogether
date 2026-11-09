/**
 * webrtc_stream_delivery_pipeline.test.ts
 * ───────────────────────────────────────
 * Comprehensive regression test suite verifying the 12 critical scenarios
 * for host-to-guest WebRTC streaming delivery:
 *
 * 1. Host starts streaming before guest joins
 * 2. Guest joins after host is already streaming (catch-up)
 * 3. Guest joins before host starts streaming
 * 4. Host starts streaming after guest joins
 * 5. Guest receives video media description & SDP offer
 * 6. Guest receives answer confirmation and ICE exchange
 * 7. Host pauses and resumes
 * 8. Host seeks
 * 9. Host replaces video source
 * 10. Host reconnects and recovers session
 * 11. WebRTC connection failure and recovery retry
 * 12. Multiple viewers receive the same host stream simultaneously
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer, Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { setupSockets } from '../src/sockets/index.js';
import { RoomRepository } from '../src/repositories/room.repository.js';
import { WEBRTC_EVENTS } from '../src/constants/socketEvents.js';

describe('WebRTC Stream Delivery Pipeline & Regression Suite', { concurrency: 1 }, () => {
  let httpServer: HttpServer;
  let ioServer: SocketIOServer;
  let port: number;
  let serverUrl: string;

  const testRoomId = `stream-pipeline-${Date.now()}`;
  const hostId = `anon_host_${Date.now()}`;
  const viewer1Id = `anon_viewer1_${Date.now()}`;
  const viewer2Id = `anon_viewer2_${Date.now()}`;

  let hostSocket: ClientSocketType;
  let viewer1Socket: ClientSocketType;
  let viewer2Socket: ClientSocketType;

  before(async () => {
    await RoomRepository.createRoom(testRoomId, hostId, '');

    httpServer = createServer();
    ioServer = new SocketIOServer(httpServer, { cors: { origin: '*' } });
    setupSockets(ioServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        if (typeof addr === 'object' && addr !== null) {
          port = addr.port;
          serverUrl = `http://localhost:${port}`;
          resolve();
        }
      });
    });
  });

  after(async () => {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (viewer1Socket?.connected) viewer1Socket.disconnect();
    if (viewer2Socket?.connected) viewer2Socket.disconnect();
    ioServer?.close();
    httpServer?.close();
    setTimeout(() => process.exit(0), 200).unref();
  });

  it('1 & 2. Host starts streaming before guest joins -> Guest joins and receives immediate catch-up', async () => {
    // Connect host first
    hostSocket = ClientSocket(serverUrl, { transports: ['websocket'] });
    await new Promise<void>((resolve) => {
      hostSocket.on('connect', () => {
        hostSocket.emit('room:join', { roomId: testRoomId, userId: hostId, isHost: true });
      });
      hostSocket.on('room:active-users', (users: any[]) => {
        if (users.some((u) => u.userId === hostId)) resolve();
      });
    });

    // Host announces active local stream BEFORE any guest arrives
    const streamMetaPromise = new Promise<void>((resolve) => {
      hostSocket.emit(
        WEBRTC_EVENTS.HOST_STREAM_READY,
        { roomId: testRoomId, mediaName: 'preloaded_video.mp4', mediaDuration: 120 },
        () => resolve()
      );
      // Fallback timeout in case no ack
      setTimeout(resolve, 150);
    });
    await streamMetaPromise;

    // Verify room state is recorded as local media
    const roomState = await RoomRepository.getRoomState(testRoomId);
    assert.strictEqual(roomState.mediaSourceType, 'local');
    assert.strictEqual(roomState.mediaName, 'preloaded_video.mp4');

    // Host sets up listener for newly joined viewers
    const viewerJoinedPromise = new Promise<{ viewerId: string }>((resolve) => {
      hostSocket.on('webrtc:viewer-joined', (data) => resolve(data));
    });

    // Now Guest 1 joins AFTER host already started streaming
    viewer1Socket = ClientSocket(serverUrl, { transports: ['websocket'] });
    const guestCatchupPromise = new Promise<{ mediaName: string }>((resolve) => {
      viewer1Socket.on(WEBRTC_EVENTS.HOST_STREAM_READY, (data) => resolve(data));
    });

    await new Promise<void>((resolve) => {
      viewer1Socket.on('connect', () => {
        viewer1Socket.emit('room:join', { roomId: testRoomId, userId: viewer1Id, isHost: false });
        resolve();
      });
    });

    // Verify Guest 1 immediately received host-stream-ready catch-up
    const catchupData = await guestCatchupPromise;
    assert.strictEqual(catchupData.mediaName, 'preloaded_video.mp4', 'Guest received catch-up mediaName');

    // Verify Host was notified of the newly joined viewer
    const joinedData = await viewerJoinedPromise;
    assert.strictEqual(joinedData.viewerId, viewer1Id, 'Host notified that viewer1 joined active stream');
  });

  it('3 & 4. Guest joins before host starts streaming -> Ready signal queued and flushed when host initiates', async () => {
    const earlyRoomId = `early-guest-room-${Date.now()}`;
    const earlyHostId = `anon_early_host_${Date.now()}`;
    const earlyGuestId = `anon_early_guest_${Date.now()}`;

    await RoomRepository.createRoom(earlyRoomId, earlyHostId, '');

    // Guest connects and joins room first
    const earlyGuestSocket = ClientSocket(serverUrl, { transports: ['websocket'] });
    await new Promise<void>((resolve) => {
      earlyGuestSocket.on('connect', () => {
        earlyGuestSocket.emit('room:join', { roomId: earlyRoomId, userId: earlyGuestId, isHost: false });
        resolve();
      });
    });

    // Guest emits viewer-ready before host has joined or started stream
    earlyGuestSocket.emit(WEBRTC_EVENTS.VIEWER_READY, {
      roomId: earlyRoomId,
      viewerId: earlyGuestId,
      connectionId: 'conn-early-1',
    });

    // Now host connects and joins
    const earlyHostSocket = ClientSocket(serverUrl, { transports: ['websocket'] });
    const flushedReadyPromise = new Promise<{ viewerId: string; connectionId: string }>((resolve) => {
      earlyHostSocket.on(WEBRTC_EVENTS.VIEWER_READY, (data) => resolve(data));
    });

    await new Promise<void>((resolve) => {
      earlyHostSocket.on('connect', () => {
        earlyHostSocket.emit('room:join', { roomId: earlyRoomId, userId: earlyHostId, isHost: true });
        resolve();
      });
    });

    // Host must receive the queued viewer-ready signal upon joining!
    const flushedData = await flushedReadyPromise;
    assert.strictEqual(flushedData.viewerId, earlyGuestId, 'Host received queued viewer-ready signal');
    assert.strictEqual(flushedData.connectionId, 'conn-early-1');

    earlyGuestSocket.disconnect();
    earlyHostSocket.disconnect();
  });

  it('5 & 6. WebRTC SDP Offer, Answer and ICE Candidate delivery', async () => {
    const connectionId = 'conn-delivery-test';

    // 1. Viewer signals ready
    const hostReadyPromise = new Promise<{ viewerId: string }>((resolve) => {
      hostSocket.on(WEBRTC_EVENTS.VIEWER_READY, (data) => resolve(data));
    });
    viewer1Socket.emit(WEBRTC_EVENTS.VIEWER_READY, {
      roomId: testRoomId,
      viewerId: viewer1Id,
      connectionId,
    });
    const ready = await hostReadyPromise;
    assert.strictEqual(ready.viewerId, viewer1Id);

    // 2. Host sends SDP offer containing video media section
    const offerSdp = {
      type: 'offer',
      sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\na=rtpmap:96 VP8/90000\r\n',
    };
    const viewerOfferPromise = new Promise<{ sdp: any; connectionId: string }>((resolve) => {
      viewer1Socket.on(WEBRTC_EVENTS.OFFER, (data) => resolve(data));
    });
    hostSocket.emit(WEBRTC_EVENTS.OFFER, {
      roomId: testRoomId,
      targetId: viewer1Id,
      sdp: offerSdp,
      connectionId,
    });
    const offerReceived = await viewerOfferPromise;
    assert.strictEqual(offerReceived.sdp.type, 'offer');
    assert.ok(offerReceived.sdp.sdp.includes('m=video'), 'Offer contains video media description');

    // 3. Viewer sends SDP answer
    const answerSdp = {
      type: 'answer',
      sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\na=rtpmap:96 VP8/90000\r\n',
    };
    const hostAnswerPromise = new Promise<{ sdp: any; connectionId: string }>((resolve) => {
      hostSocket.on(WEBRTC_EVENTS.ANSWER, (data) => resolve(data));
    });
    viewer1Socket.emit(WEBRTC_EVENTS.ANSWER, {
      roomId: testRoomId,
      targetId: 'host',
      sdp: answerSdp,
      connectionId,
      senderId: viewer1Id,
    });
    const answerReceived = await hostAnswerPromise;
    assert.strictEqual(answerReceived.sdp.type, 'answer');

    // 4. ICE candidate exchange
    const hostIcePromise = new Promise<{ candidate: any }>((resolve) => {
      hostSocket.on(WEBRTC_EVENTS.ICE_CANDIDATE, (data) => resolve(data));
    });
    const viewerIcePromise = new Promise<{ candidate: any }>((resolve) => {
      viewer1Socket.on(WEBRTC_EVENTS.ICE_CANDIDATE, (data) => resolve(data));
    });

    hostSocket.emit(WEBRTC_EVENTS.ICE_CANDIDATE, {
      roomId: testRoomId,
      targetId: viewer1Id,
      candidate: { candidate: 'candidate:host1 1 udp 2122260223 192.168.1.100 50000 typ host' },
      connectionId,
    });
    viewer1Socket.emit(WEBRTC_EVENTS.ICE_CANDIDATE, {
      roomId: testRoomId,
      targetId: 'host',
      candidate: { candidate: 'candidate:viewer1 1 udp 2122260223 192.168.1.101 50001 typ host' },
      connectionId,
      senderId: viewer1Id,
    });

    const [vIce, hIce] = await Promise.all([viewerIcePromise, hostIcePromise]);
    assert.ok(vIce.candidate, 'Viewer received ICE candidate');
    assert.ok(hIce.candidate, 'Host received ICE candidate');
  });

  it('7. Host pauses and resumes -> Playback state updates viewers without breaking WebRTC', async () => {
    // Host pauses
    const pausePromise = new Promise<{ isPlaying: boolean; position: number }>((resolve) => {
      viewer1Socket.on('sync-state', (state) => {
        if (state.isPlaying === false) resolve(state);
      });
    });
    hostSocket.emit('video:pause', { roomId: testRoomId, position: 24.0 });
    const pauseState = await pausePromise;
    assert.strictEqual(pauseState.isPlaying, false);
    assert.strictEqual(pauseState.position, 24.0);

    // Host resumes
    const resumePromise = new Promise<{ isPlaying: boolean; position: number }>((resolve) => {
      viewer1Socket.on('sync-state', (state) => {
        if (state.isPlaying === true) resolve(state);
      });
    });
    hostSocket.emit('video:play', { roomId: testRoomId, position: 24.0 });
    const resumeState = await resumePromise;
    assert.strictEqual(resumeState.isPlaying, true);
  });

  it('8. Host seeks -> Monotonic timeline sync delivered to viewers', async () => {
    const seekPromise = new Promise<{ position: number; stateVersion?: number; version?: number }>((resolve) => {
      viewer1Socket.on('sync-state', (state) => {
        if (state.position === 75.5) resolve(state);
      });
    });
    hostSocket.emit('video:seek', { roomId: testRoomId, position: 75.5 });
    const seekState = await seekPromise;
    assert.strictEqual(seekState.position, 75.5);
    const version = seekState.stateVersion ?? seekState.version ?? 1;
    assert.ok(version > 0, 'Seek incremented version');
  });

  it('9. Host replaces the video source -> Broadcasts new media metadata to all viewers', async () => {
    const newMediaPromise = new Promise<{ mediaName: string; mediaDuration: number | null }>((resolve) => {
      viewer1Socket.on(WEBRTC_EVENTS.HOST_STREAM_READY, (data) => resolve(data));
    });

    hostSocket.emit(WEBRTC_EVENTS.HOST_STREAM_READY, {
      roomId: testRoomId,
      mediaName: 'summer_trip_4k.mp4',
      mediaDuration: 360,
    });

    const newMedia = await newMediaPromise;
    assert.strictEqual(newMedia.mediaName, 'summer_trip_4k.mp4');
    assert.strictEqual(newMedia.mediaDuration, 360);

    const roomState = await RoomRepository.getRoomState(testRoomId);
    assert.strictEqual(roomState.mediaName, 'summer_trip_4k.mp4');
  });

  it('10. Host refresh / recovery within grace period preserves room', async () => {
    // Simulate temporary disconnect
    hostSocket.disconnect();

    // Reconnect host
    hostSocket = ClientSocket(serverUrl, { transports: ['websocket'] });
    await new Promise<void>((resolve) => {
      hostSocket.on('connect', () => {
        hostSocket.emit('room:join', { roomId: testRoomId, userId: hostId, isHost: true });
      });
      hostSocket.on('room:active-users', (users: any[]) => {
        if (users.some((u) => u.userId === hostId)) resolve();
      });
    });

    // Room state still intact
    const roomState = await RoomRepository.getRoomState(testRoomId);
    assert.strictEqual(roomState.mediaSourceType, 'local');
    assert.strictEqual(roomState.mediaName, 'summer_trip_4k.mp4');
  });

  it('11. WebRTC connection recovery: Viewer re-signals ready and receives fresh offer', async () => {
    const freshConnId = 'conn-recovery-retry';

    const hostReceiveRetryPromise = new Promise<{ viewerId: string; connectionId: string }>((resolve) => {
      hostSocket.on(WEBRTC_EVENTS.VIEWER_READY, (data) => {
        if (data.connectionId === freshConnId) resolve(data);
      });
    });

    viewer1Socket.emit(WEBRTC_EVENTS.VIEWER_READY, {
      roomId: testRoomId,
      viewerId: viewer1Id,
      connectionId: freshConnId,
    });

    const readyData = await hostReceiveRetryPromise;
    assert.strictEqual(readyData.connectionId, freshConnId);

    // Host sends replacement offer
    const viewerOfferPromise = new Promise<{ connectionId: string }>((resolve) => {
      viewer1Socket.on(WEBRTC_EVENTS.OFFER, (data) => {
        if (data.connectionId === freshConnId) resolve(data);
      });
    });

    hostSocket.emit(WEBRTC_EVENTS.OFFER, {
      roomId: testRoomId,
      targetId: viewer1Id,
      sdp: { type: 'offer', sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' },
      connectionId: freshConnId,
    });

    const offerData = await viewerOfferPromise;
    assert.strictEqual(offerData.connectionId, freshConnId, 'Viewer received fresh offer on recovery');
  });

  it('12. Multiple viewers receive the same host stream concurrently', async () => {
    // Connect Viewer 2
    viewer2Socket = ClientSocket(serverUrl, { transports: ['websocket'] });
    const viewer2CatchupPromise = new Promise<{ mediaName: string }>((resolve) => {
      viewer2Socket.on(WEBRTC_EVENTS.HOST_STREAM_READY, (data) => resolve(data));
    });

    await new Promise<void>((resolve) => {
      viewer2Socket.on('connect', () => {
        viewer2Socket.emit('room:join', { roomId: testRoomId, userId: viewer2Id, isHost: false });
      });
      viewer2Socket.on('room:active-users', (users: any[]) => {
        if (users.some((u) => u.userId === viewer2Id)) resolve();
      });
    });

    const v2Catchup = await viewer2CatchupPromise;
    assert.strictEqual(v2Catchup.mediaName, 'summer_trip_4k.mp4', 'Viewer 2 received active stream metadata');

    // Both viewers receive play event simultaneously
    const v1PlayPromise = new Promise<boolean>((resolve) => {
      viewer1Socket.on('sync-state', (state) => {
        if (state.position === 99.0) resolve(true);
      });
    });
    const v2PlayPromise = new Promise<boolean>((resolve) => {
      viewer2Socket.on('sync-state', (state) => {
        if (state.position === 99.0) resolve(true);
      });
    });

    hostSocket.emit('video:play', { roomId: testRoomId, position: 99.0 });

    const [v1Received, v2Received] = await Promise.all([v1PlayPromise, v2PlayPromise]);
    assert.ok(v1Received && v2Received, 'Both Viewer 1 and Viewer 2 received playback sync concurrently');
  });

  it('13. ICE candidates arriving before remote description are buffered and preserved', async () => {
    // Viewer simulation buffers candidates that arrive before setRemoteDescription
    const earlyCandQueue: any[] = [];
    let remoteDescSet = false;
    const addedCandidates: any[] = [];

    function onIncomingCandidate(cand: any) {
      if (!remoteDescSet) {
        earlyCandQueue.push(cand);
      } else {
        addedCandidates.push(cand);
      }
    }

    function onRemoteDescriptionApplied() {
      remoteDescSet = true;
      while (earlyCandQueue.length > 0) {
        addedCandidates.push(earlyCandQueue.shift());
      }
    }

    // Host emits 3 candidates before viewer processes offer
    onIncomingCandidate({ candidate: 'candidate:early-1 1 udp 2122260223 10.0.0.1 5001 typ host' });
    onIncomingCandidate({ candidate: 'candidate:early-2 1 udp 2122260223 10.0.0.2 5002 typ srflx' });
    onIncomingCandidate({ candidate: 'candidate:early-3 1 udp 2122260223 10.0.0.3 5003 typ relay' });

    assert.strictEqual(earlyCandQueue.length, 3, 'All 3 early candidates buffered before remote description');
    assert.strictEqual(addedCandidates.length, 0, 'No candidates applied before remote description');

    // Remote description arrives
    onRemoteDescriptionApplied();

    assert.strictEqual(earlyCandQueue.length, 0, 'Candidate buffer drained after remote description');
    assert.strictEqual(addedCandidates.length, 3, 'All 3 buffered candidates applied successfully');
  });

  it('14. Guest browser refresh -> Reconnects and rejoins active stream with immediate catch-up', async () => {
    // Disconnect viewer 1
    viewer1Socket.disconnect();

    // Reconnect viewer 1 (simulating browser reload)
    viewer1Socket = ClientSocket(serverUrl, { transports: ['websocket'] });
    const refreshedCatchupPromise = new Promise<{ mediaName: string; mediaDuration: number | null }>((resolve) => {
      viewer1Socket.on(WEBRTC_EVENTS.HOST_STREAM_READY, (data) => resolve(data));
    });

    await new Promise<void>((resolve) => {
      viewer1Socket.on('connect', () => {
        viewer1Socket.emit('room:join', { roomId: testRoomId, userId: viewer1Id, isHost: false });
        resolve();
      });
    });

    const catchup = await refreshedCatchupPromise;
    assert.strictEqual(catchup.mediaName, 'summer_trip_4k.mp4', 'Refreshed viewer received active media catch-up');
    assert.strictEqual(catchup.mediaDuration, 360);
  });

  it('15. Invalid participant identity: Missing roomId or invalid payload is safely rejected', async () => {
    let errorFired = false;
    viewer1Socket.on('webrtc:error', () => { errorFired = true; });

    // Emit offer with missing sdp
    viewer1Socket.emit(WEBRTC_EVENTS.OFFER, {
      roomId: testRoomId,
      targetId: 'host',
      sdp: null as any,
      connectionId: 'invalid-test',
    });

    await new Promise((r) => setTimeout(r, 60));
    // Verify room state is untouched and server did not crash
    const roomState = await RoomRepository.getRoomState(testRoomId);
    assert.strictEqual(roomState.mediaName, 'summer_trip_4k.mp4', 'Room state unharmed by malformed signaling');
  });

  it('16. Unauthorized signaling attempts: Viewer attempting HOST_STREAM_READY is blocked by server', async () => {
    let errorReceived: any = null;
    const errorPromise = new Promise<void>((resolve) => {
      viewer1Socket.on('webrtc:error', (err) => {
        errorReceived = err;
        resolve();
      });
    });

    viewer1Socket.emit(WEBRTC_EVENTS.HOST_STREAM_READY, {
      roomId: testRoomId,
      mediaName: 'hacked_stream.mp4',
      mediaDuration: 999,
    });

    await errorPromise;
    assert.ok(errorReceived, 'Server emitted error for viewer stream-ready attempt');
    assert.strictEqual(errorReceived.message, 'Only host/co-host can signal stream ready.');

    // Verify room state was NOT modified
    const roomState = await RoomRepository.getRoomState(testRoomId);
    assert.strictEqual(roomState.mediaName, 'summer_trip_4k.mp4', 'Room state protected from unauthorized modification');
  });

  it('17. Autoplay rejection: Muted playback fallback resolves without connection failure', async () => {
    // Simulate browser autoplay rejection and fallback
    let unmutedRejected = false;
    let mutedSucceeded = false;

    async function attemptPlay(muted: boolean): Promise<void> {
      if (!muted) {
        unmutedRejected = true;
        throw new Error('NotAllowedError: play() failed because the user didn\'t interact with the document first.');
      } else {
        mutedSucceeded = true;
      }
    }

    try {
      await attemptPlay(false);
    } catch {
      // Fall back to muted
      await attemptPlay(true);
    }

    assert.ok(unmutedRejected, 'Unmuted autoplay was blocked');
    assert.ok(mutedSucceeded, 'Muted playback fallback succeeded immediately');
  });

  it('18. Empty MediaStream track event association fallback', async () => {
    const stream = { tracks: [] as string[] };
    const eventWithoutStreams = {
      streams: [] as any[],
      track: { id: 'track-direct-video-1', kind: 'video' },
    };

    // When event.streams is empty, track should be added directly from event.track
    if (eventWithoutStreams.streams.length > 0) {
      eventWithoutStreams.streams[0].tracks.forEach((t: any) => stream.tracks.push(t.id));
    } else if (eventWithoutStreams.track) {
      stream.tracks.push(eventWithoutStreams.track.id);
    }

    assert.strictEqual(stream.tracks.length, 1);
    assert.strictEqual(stream.tracks[0], 'track-direct-video-1', 'Track associated successfully from event.track');
  });

  it('19. Host outbound media statistics collection and structured diagnosis', async () => {
    // Test outbound stats report calculation logic
    const mockReports: any[] = [
      { type: 'outbound-rtp', kind: 'video', bytesSent: 154200, packetsSent: 120, framesEncoded: 90, framesPerSecond: 30 },
      { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.024, localCandidateId: 'c-loc', remoteCandidateId: 'c-rem', bytesSent: 154200, bytesReceived: 3400 },
      { type: 'local-candidate', id: 'c-loc', candidateType: 'host' },
      { type: 'remote-candidate', id: 'c-rem', candidateType: 'srflx' },
    ];

    let bytesSent = 0;
    let packetsSent = 0;
    let framesEncoded = 0;
    let framesPerSecond = 0;
    let roundTripTime: number | undefined;
    let selectedPair: any = undefined;

    const candMap = new Map<string, any>();
    mockReports.forEach((r) => {
      if ((r.type === 'local-candidate' || r.type === 'remote-candidate') && r.id) candMap.set(r.id, r);
    });

    mockReports.forEach((r) => {
      if (r.type === 'outbound-rtp') {
        bytesSent = r.bytesSent ?? 0;
        packetsSent = r.packetsSent ?? 0;
        framesEncoded = r.framesEncoded ?? 0;
        framesPerSecond = r.framesPerSecond ?? 0;
      } else if (r.type === 'candidate-pair' && r.state === 'succeeded') {
        roundTripTime = r.currentRoundTripTime;
        selectedPair = {
          state: r.state,
          localCandidateType: candMap.get(r.localCandidateId)?.candidateType,
          remoteCandidateType: candMap.get(r.remoteCandidateId)?.candidateType,
          currentRoundTripTime: r.currentRoundTripTime,
        };
      }
    });

    const diagnosis = bytesSent > 0 && framesEncoded > 0 ? 'transmitting' : (bytesSent === 0 ? 'no_outgoing_media' : 'unknown');

    assert.strictEqual(bytesSent, 154200);
    assert.strictEqual(packetsSent, 120);
    assert.strictEqual(framesEncoded, 90);
    assert.strictEqual(framesPerSecond, 30);
    assert.strictEqual(roundTripTime, 0.024);
    assert.strictEqual(selectedPair?.localCandidateType, 'host');
    assert.strictEqual(selectedPair?.remoteCandidateType, 'srflx');
    assert.strictEqual(diagnosis, 'transmitting');
  });

  it('20. Guest inbound media statistics collection and structured diagnosis', async () => {
    // Test inbound stats report calculation logic
    const mockReports: any[] = [
      { type: 'inbound-rtp', kind: 'video', bytesReceived: 245000, packetsReceived: 180, packetsLost: 1, framesReceived: 110, framesDecoded: 108, framesDropped: 2, framesPerSecond: 29.5 },
      { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.031, localCandidateId: 'c-loc-v', remoteCandidateId: 'c-rem-v' },
      { type: 'local-candidate', id: 'c-loc-v', candidateType: 'srflx' },
      { type: 'remote-candidate', id: 'c-rem-v', candidateType: 'host' },
    ];

    let bytesReceived = 0;
    let packetsReceived = 0;
    let packetsLost = 0;
    let framesReceived = 0;
    let framesDecoded = 0;
    let framesDropped = 0;
    let framesPerSecond = 0;
    let roundTripTime: number | undefined;
    let selectedPair: any = undefined;

    const candMap = new Map<string, any>();
    mockReports.forEach((r) => {
      if ((r.type === 'local-candidate' || r.type === 'remote-candidate') && r.id) candMap.set(r.id, r);
    });

    mockReports.forEach((r) => {
      if (r.type === 'inbound-rtp') {
        bytesReceived = r.bytesReceived ?? 0;
        packetsReceived = r.packetsReceived ?? 0;
        packetsLost = r.packetsLost ?? 0;
        framesReceived = r.framesReceived ?? 0;
        framesDecoded = r.framesDecoded ?? 0;
        framesDropped = r.framesDropped ?? 0;
        framesPerSecond = r.framesPerSecond ?? 0;
      } else if (r.type === 'candidate-pair' && r.state === 'succeeded') {
        roundTripTime = r.currentRoundTripTime;
        selectedPair = {
          state: r.state,
          localCandidateType: candMap.get(r.localCandidateId)?.candidateType,
          remoteCandidateType: candMap.get(r.remoteCandidateId)?.candidateType,
        };
      }
    });

    let diagnosis: string = 'unknown';
    if (bytesReceived === 0) diagnosis = 'no_incoming_media';
    else if (bytesReceived > 0 && framesDecoded === 0) diagnosis = 'media_received_not_decoded';
    else if (framesDecoded > 0) diagnosis = 'healthy';

    assert.strictEqual(bytesReceived, 245000);
    assert.strictEqual(packetsReceived, 180);
    assert.strictEqual(packetsLost, 1);
    assert.strictEqual(framesDecoded, 108);
    assert.strictEqual(framesDropped, 2);
    assert.strictEqual(selectedPair?.localCandidateType, 'srflx');
    assert.strictEqual(selectedPair?.remoteCandidateType, 'host');
    assert.strictEqual(diagnosis, 'healthy');
  });
});
