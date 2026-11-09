import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer, Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { setupSockets } from '../src/sockets/index.js';
import { RoomRepository } from '../src/repositories/room.repository.js';
import { WEBRTC_EVENTS } from '../src/constants/socketEvents.js';
describe('Local-File WebRTC Signaling, RBAC & Playback State Integration Tests', { concurrency: 1 }, () => {
  let httpServer: HttpServer;
  let ioServer: SocketIOServer;
  let port: number;
  let serverUrl: string;

  const testRoomId = 'test-room-' + Date.now();
  const hostUserId = 'anon_host_123';
  const viewerUserId = 'anon_viewer_456';
  const mockConnectionId = 'conn-uuid-999';

  let hostClient: ClientSocketType;
  let viewerClient: ClientSocketType;

  before(async () => {
    // 1. Create Room in repository
    await RoomRepository.createRoom(testRoomId, hostUserId, '');

    // 2. Start HTTP & Socket.IO server on ephemeral port
    httpServer = createServer();
    ioServer = new SocketIOServer(httpServer, {
      cors: { origin: '*' },
    });
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
    if (hostClient?.connected) hostClient.disconnect();
    if (viewerClient?.connected) viewerClient.disconnect();
    ioServer?.close();
    httpServer?.close();
    setTimeout(() => process.exit(0), 200).unref();
  });

  it('1. Room creation for local file does not inject HLS URL fallback', async () => {
    const room = await RoomRepository.getRoomMetadata(testRoomId);
    assert.ok(room, 'Room should exist');
    assert.strictEqual(
      room.movie_url,
      '',
      'movie_url must be empty for local files, NOT defaulting to master_party.m3u8'
    );
  });

  it('2. Connect host and viewer sockets and join room', async () => {
    // Host joins
    hostClient = ClientSocket(serverUrl, { transports: ['websocket'] });
    await new Promise<void>((resolve) => {
      hostClient.on('connect', () => {
        hostClient.emit('room:join', {
          roomId: testRoomId,
          userId: hostUserId,
          name: 'Host User',
          isHost: true,
        });
      });
      hostClient.on('room:active-users', (users: Array<{ userId: string; role: string; isHost: boolean }>) => {
        const host = users.find((u) => u.userId === hostUserId);
        if (host) {
          assert.strictEqual(host.isHost, true);
          resolve();
        }
      });
    });

    // Viewer joins
    viewerClient = ClientSocket(serverUrl, { transports: ['websocket'] });
    await new Promise<void>((resolve) => {
      viewerClient.on('connect', () => {
        viewerClient.emit('room:join', {
          roomId: testRoomId,
          userId: viewerUserId,
          name: 'Viewer User',
          isHost: false,
        });
      });
      viewerClient.on('room:active-users', (users: Array<{ userId: string; role: string; isHost: boolean }>) => {
        const viewer = users.find((u) => u.userId === viewerUserId);
        if (viewer) {
          assert.strictEqual(viewer.isHost, false);
          resolve();
        }
      });
    });
  });

  it('3. Viewer signals ready -> server relays webrtc:viewer-ready to Host socket', async () => {
    const receivedPromise = new Promise<{ viewerId: string; connectionId: string }>((resolve) => {
      hostClient.once(WEBRTC_EVENTS.VIEWER_READY, (data) => {
        resolve(data);
      });
    });

    viewerClient.emit(WEBRTC_EVENTS.VIEWER_READY, {
      roomId: testRoomId,
      viewerId: viewerUserId,
      connectionId: mockConnectionId,
    });

    const received = await receivedPromise;
    assert.strictEqual(received.viewerId, viewerUserId);
    assert.strictEqual(received.connectionId, mockConnectionId);
  });

  it('4. Host sends SDP offer -> server relays offer to target Viewer', async () => {
    const offerPayload = {
      roomId: testRoomId,
      targetId: viewerUserId,
      sdp: { type: 'offer', sdp: 'v=0\r\no=- 42 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' },
      connectionId: mockConnectionId,
    };

    const offerPromise = new Promise<{ sdp: { type: string; sdp: string }; connectionId: string }>((resolve) => {
      viewerClient.once(WEBRTC_EVENTS.OFFER, (data) => {
        resolve(data);
      });
    });

    hostClient.emit(WEBRTC_EVENTS.OFFER, offerPayload);

    const receivedOffer = await offerPromise;
    assert.strictEqual(receivedOffer.connectionId, mockConnectionId);
    assert.strictEqual(receivedOffer.sdp.type, 'offer');
    assert.ok(receivedOffer.sdp.sdp.includes('v=0'));
  });

  it('5. Viewer attempts to send SDP offer -> server rejects with webrtc:error', async () => {
    const errorPromise = new Promise<{ message: string }>((resolve) => {
      viewerClient.once('webrtc:error', (data) => {
        resolve(data);
      });
    });

    viewerClient.emit(WEBRTC_EVENTS.OFFER, {
      roomId: testRoomId,
      targetId: hostUserId,
      sdp: { type: 'offer', sdp: 'malicious-offer' },
      connectionId: 'fake-id',
    });

    const err = await errorPromise;
    assert.ok(err.message.includes('Viewers cannot initiate WebRTC offers'));
  });

  it('6. Viewer sends SDP answer -> server relays answer to Host', async () => {
    const answerPayload = {
      roomId: testRoomId,
      targetId: 'host',
      sdp: { type: 'answer', sdp: 'v=0\r\no=- 99 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' },
      connectionId: mockConnectionId,
      senderId: viewerUserId,
    };

    const answerPromise = new Promise<{ sdp: { type: string; sdp: string }; connectionId: string; senderId: string }>((resolve) => {
      hostClient.once(WEBRTC_EVENTS.ANSWER, (data) => {
        resolve(data);
      });
    });

    viewerClient.emit(WEBRTC_EVENTS.ANSWER, answerPayload);

    const receivedAnswer = await answerPromise;
    assert.strictEqual(receivedAnswer.connectionId, mockConnectionId);
    assert.strictEqual(receivedAnswer.senderId, viewerUserId);
    assert.strictEqual(receivedAnswer.sdp.type, 'answer');
  });

  it('7. Bidirectional ICE candidate exchange', async () => {
    const candidateData = {
      candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 5000 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };

    // Host to Viewer
    const hostToViewerPromise = new Promise<{ candidate: typeof candidateData }>((resolve) => {
      viewerClient.once(WEBRTC_EVENTS.ICE_CANDIDATE, (data) => {
        resolve(data);
      });
    });

    hostClient.emit(WEBRTC_EVENTS.ICE_CANDIDATE, {
      roomId: testRoomId,
      targetId: viewerUserId,
      candidate: candidateData,
      connectionId: mockConnectionId,
    });

    const receivedByViewer = await hostToViewerPromise;
    assert.strictEqual(receivedByViewer.candidate.candidate, candidateData.candidate);

    // Viewer to Host
    const viewerToHostPromise = new Promise<{ candidate: typeof candidateData }>((resolve) => {
      hostClient.once(WEBRTC_EVENTS.ICE_CANDIDATE, (data) => {
        resolve(data);
      });
    });

    viewerClient.emit(WEBRTC_EVENTS.ICE_CANDIDATE, {
      roomId: testRoomId,
      targetId: 'host',
      candidate: candidateData,
      connectionId: mockConnectionId,
      senderId: viewerUserId,
    });

    const receivedByHost = await viewerToHostPromise;
    assert.strictEqual(receivedByHost.candidate.candidate, candidateData.candidate);
  });

  it('8. Host stream ready updates room state and broadcasts metadata (no video bytes)', async () => {
    const streamReadyPromise = new Promise<{ mediaName: string; mediaDuration: number }>((resolve) => {
      viewerClient.once(WEBRTC_EVENTS.HOST_STREAM_READY, (data) => {
        resolve(data);
      });
    });

    hostClient.emit(WEBRTC_EVENTS.HOST_STREAM_READY, {
      roomId: testRoomId,
      mediaName: 'family_vacation.mp4',
      mediaDuration: 300,
    });

    const broadcast = await streamReadyPromise;
    assert.strictEqual(broadcast.mediaName, 'family_vacation.mp4');
    assert.strictEqual(broadcast.mediaDuration, 300);

    await new Promise((r) => setTimeout(r, 50));
    const roomState = await RoomRepository.getRoomState(testRoomId);
    assert.strictEqual(roomState?.mediaName, 'family_vacation.mp4');
    assert.strictEqual(roomState?.mediaDuration, 300);
    assert.strictEqual(roomState?.mediaSourceType, 'local');
  });

  it('9. Host issues video:play -> room state updates and broadcasts sync-state', async () => {
    const syncPromise = new Promise<{ isPlaying: boolean; position: number; stateVersion: number }>((resolve) => {
      viewerClient.once('sync-state', (data) => {
        resolve(data);
      });
    });

    hostClient.emit('video:play', { roomId: testRoomId, position: 45.5 });

    const sync = await syncPromise;
    assert.strictEqual(sync.isPlaying, true);
    assert.strictEqual(sync.position, 45.5);
    assert.ok(typeof sync.stateVersion === 'number' && sync.stateVersion > 0);

    const roomState = await RoomRepository.getRoomState(testRoomId);
    assert.strictEqual(roomState?.isPlaying, true);
    assert.strictEqual(roomState?.position, 45.5);
  });

  it('10. Viewer buffering/playback event (video:pause) is BLOCKED by RBAC without altering room state', async () => {
    const errorPromise = new Promise<{ message: string }>((resolve) => {
      viewerClient.once('error_notification', (data) => {
        resolve(data);
      });
    });

    // Viewer tries to pause
    viewerClient.emit('video:pause', { roomId: testRoomId, position: 20 });

    const err = await errorPromise;
    console.log('TEST 10 error received:', err);
    const msg = typeof err === 'string' ? err : err?.message || JSON.stringify(err);
    assert.ok(msg.toLowerCase().includes('viewers cannot control media playback'), `Expected error message, got: ${msg}`);

    // Verify room state is STILL playing at 45.5s (not paused by viewer!)
    const roomState = await RoomRepository.getRoomState(testRoomId);
    assert.strictEqual(
      roomState?.isPlaying,
      true,
      'Room state must remain isPlaying: true — viewer pause was rejected!'
    );
    assert.strictEqual(
      roomState?.position,
      45.5,
      'Room state position must not be altered by viewer buffering/seeking'
    );
  });

  it('11. Host issues video:seek -> state updates with monotonically increasing version', async () => {
    const roomStateBefore = await RoomRepository.getRoomState(testRoomId);
    const versionBefore = roomStateBefore?.stateVersion || 0;

    const syncPromise = new Promise<{ isPlaying: boolean; position: number; stateVersion: number }>((resolve) => {
      viewerClient.once('sync-state', (data) => {
        resolve(data);
      });
    });

    hostClient.emit('video:seek', { roomId: testRoomId, position: 120.0 });

    const sync = await syncPromise;
    assert.strictEqual(sync.position, 120.0);
    assert.ok(sync.stateVersion > versionBefore, 'stateVersion must increment monotonically');
  });

  it('12. Host stream ended updates room state and notifies viewers', async () => {
    const endedPromise = new Promise<void>((resolve) => {
      viewerClient.once(WEBRTC_EVENTS.HOST_STREAM_ENDED, () => {
        resolve();
      });
    });

    hostClient.emit(WEBRTC_EVENTS.HOST_STREAM_ENDED, { roomId: testRoomId });

    await endedPromise;

    const roomState = await RoomRepository.getRoomState(testRoomId);
    assert.strictEqual(roomState?.isPlaying, false);
  });
});
