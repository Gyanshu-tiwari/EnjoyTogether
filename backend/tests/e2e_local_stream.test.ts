/**
 * e2e_local_stream.test.ts
 * Tests the complete end-to-end local stream flow against the live backend server:
 * 1. Room Creation via REST API (/api/rooms/create)
 * 2. Host and Viewer WebSocket connections
 * 3. WebRTC signaling flow (viewer-ready -> offer -> answer -> ICE candidates)
 * 4. Playback synchronization (play, pause, seek)
 * 5. RBAC security enforcement (viewer restricted from media control)
 * 6. Stream lifecycle (stream-ready, stream-ended, disconnect)
 */

import { io, Socket } from 'socket.io-client';
import axios from 'axios';

const BACKEND_URL = 'http://localhost:5000';

async function runE2ETests() {
  console.log('🚀 Starting Local-File WebRTC Feature E2E Verification...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  ✅ ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
      failed++;
    }
  }

  // ── 1. Create Room via REST API ──────────────────────────────────────────
  console.log('Step 1: Testing Room Creation API (Local Media Source)...');
  const hostId = `anon_host_${Date.now()}`;
  const viewerId = `anon_viewer_${Date.now()}`;
  const mediaName = 'vacation_video.mp4';

  const createRes = await axios.post(`${BACKEND_URL}/api/rooms/create`, {
    hostId,
    movieUrl: '',
    mediaName,
  });

  assert(createRes.status === 201, 'Status is 201 Created');
  assert(Boolean(createRes.data.roomId), `Room ID created: ${createRes.data.roomId}`);
  assert(createRes.data.metadata.movie_url === '', 'movie_url is empty (no cloud upload or HLS)');
  const roomId = createRes.data.roomId;

  // ── 2. Socket Connections ────────────────────────────────────────────────
  console.log('\nStep 2: Connecting Host and Viewer Sockets...');
  const hostSocket: Socket = io(BACKEND_URL, {
    transports: ['websocket'],
    forceNew: true,
  });
  const viewerSocket: Socket = io(BACKEND_URL, {
    transports: ['websocket'],
    forceNew: true,
  });

  await new Promise<void>((resolve) => {
    let connected = 0;
    const check = () => {
      connected++;
      if (connected === 2) resolve();
    };
    hostSocket.on('connect', check);
    viewerSocket.on('connect', check);
  });
  assert(hostSocket.connected && viewerSocket.connected, 'Both sockets connected to server');

  // Join Room
  const hostJoinedPromise = new Promise<void>((resolve) => {
    hostSocket.on('room:active-users', (users) => {
      if (users.some((u: any) => u.userId === hostId)) resolve();
    });
  });
  const viewerJoinedPromise = new Promise<void>((resolve) => {
    viewerSocket.on('room:active-users', (users) => {
      if (users.some((u: any) => u.userId === viewerId)) resolve();
    });
  });
  hostSocket.emit('room:join', { roomId, userId: hostId });
  viewerSocket.emit('room:join', { roomId, userId: viewerId });
  await Promise.all([hostJoinedPromise, viewerJoinedPromise]);

  // ── 3. WebRTC Signaling ──────────────────────────────────────────────────
  console.log('\nStep 3: Testing WebRTC Signaling Handshake...');
  const connId = `conn-${Date.now()}`;

  // Viewer signals ready
  const viewerReadyPromise = new Promise<{ viewerId: string; connectionId: string }>((resolve) => {
    hostSocket.on('webrtc:viewer-ready', (data) => resolve(data));
  });
  viewerSocket.emit('webrtc:viewer-ready', { roomId, viewerId, connectionId: connId });
  const readyData = await viewerReadyPromise;
  assert(readyData.viewerId === viewerId && readyData.connectionId === connId, 'Host received webrtc:viewer-ready');

  // Host sends SDP Offer
  const offerPromise = new Promise<{ sdp: any; connectionId: string }>((resolve) => {
    viewerSocket.on('webrtc:offer', (data) => resolve(data));
  });
  const mockOfferSdp = { type: 'offer', sdp: 'v=0\r\no=host 12345 2 IN IP4 127.0.0.1\r\ns=Local Stream' };
  hostSocket.emit('webrtc:offer', { roomId, targetId: viewerId, sdp: mockOfferSdp, connectionId: connId });
  const offerData = await offerPromise;
  assert(offerData.sdp.type === 'offer', 'Viewer received webrtc:offer from Host');

  // Viewer sends SDP Answer
  const answerPromise = new Promise<{ sdp: any; connectionId: string }>((resolve) => {
    hostSocket.on('webrtc:answer', (data) => resolve(data));
  });
  const mockAnswerSdp = { type: 'answer', sdp: 'v=0\r\no=viewer 67890 2 IN IP4 127.0.0.1\r\ns=Local Stream' };
  viewerSocket.emit('webrtc:answer', { roomId, targetId: 'host', sdp: mockAnswerSdp, connectionId: connId, senderId: viewerId });
  const answerData = await answerPromise;
  assert(answerData.sdp.type === 'answer', 'Host received webrtc:answer from Viewer');

  // Bidirectional ICE Candidate Exchange
  const hostIcePromise = new Promise<{ candidate: any }>((resolve) => {
    hostSocket.on('webrtc:ice-candidate', (data) => resolve(data));
  });
  const viewerIcePromise = new Promise<{ candidate: any }>((resolve) => {
    viewerSocket.on('webrtc:ice-candidate', (data) => resolve(data));
  });

  hostSocket.emit('webrtc:ice-candidate', { roomId, targetId: viewerId, candidate: { candidate: 'candidate:1 1 UDP ...' }, connectionId: connId, senderId: 'host' });
  viewerSocket.emit('webrtc:ice-candidate', { roomId, targetId: 'host', candidate: { candidate: 'candidate:2 1 UDP ...' }, connectionId: connId, senderId: viewerId });

  const [receivedByViewer, receivedByHost] = await Promise.all([viewerIcePromise, hostIcePromise]);
  assert(Boolean(receivedByViewer.candidate), 'Viewer received ICE candidate from Host');
  assert(Boolean(receivedByHost.candidate), 'Host received ICE candidate from Viewer');

  // ── 4. Host Stream Ready & Playback Sync ─────────────────────────────────
  console.log('\nStep 4: Testing Media Announcements & Playback Synchronization...');
  const streamReadyPromise = new Promise<{ mediaName: string; mediaDuration: number | null }>((resolve) => {
    viewerSocket.on('webrtc:host-stream-ready', (data) => resolve(data));
  });
  hostSocket.emit('webrtc:host-stream-ready', { roomId, mediaName: 'vacation_video.mp4', mediaDuration: 180 });
  const streamReadyData = await streamReadyPromise;
  assert(streamReadyData.mediaName === 'vacation_video.mp4', 'Viewer received webrtc:host-stream-ready with mediaName');

  // Host issues video:play
  const playSyncPromise = new Promise<{ isPlaying: boolean; position: number }>((resolve) => {
    viewerSocket.on('sync-state', (data) => {
      if (data.isPlaying) resolve(data);
    });
  });
  hostSocket.emit('video:play', { roomId, position: 10.5 });
  const playSync = await playSyncPromise;
  assert(playSync.isPlaying === true && playSync.position === 10.5, 'Viewer received sync-state on Host play');

  // Host issues video:seek
  const seekSyncPromise = new Promise<{ position: number }>((resolve) => {
    viewerSocket.on('sync-state', (data) => {
      if (data.position === 45.0) resolve(data);
    });
  });
  hostSocket.emit('video:seek', { roomId, position: 45.0 });
  const seekSync = await seekSyncPromise;
  assert(seekSync.position === 45.0, 'Viewer received sync-state on Host seek');

  // ── 5. RBAC Protection ───────────────────────────────────────────────────
  console.log('\nStep 5: Testing Role-Based Access Control (RBAC)...');
  const rbacErrorPromise = new Promise<{ code: string }>((resolve) => {
    viewerSocket.on('error_notification', (err) => resolve(err));
    viewerSocket.on('error', (err) => resolve(err));
  });
  // Viewer attempts to pause
  viewerSocket.emit('video:pause', { roomId, position: 45.0 });
  const rbacError = await rbacErrorPromise;
  assert(rbacError.code === 'VIEWER_RESTRICTED', 'Viewer playback control attempt was BLOCKED by RBAC');

  // Viewer attempts to send unauthorized offer
  const offerRbacPromise = new Promise<{ message: string }>((resolve) => {
    viewerSocket.on('webrtc:error', (err) => resolve(err));
  });
  viewerSocket.emit('webrtc:offer', { roomId, targetId: 'host', sdp: mockOfferSdp, connectionId: connId });
  const offerRbacError = await offerRbacPromise;
  assert(Boolean(offerRbacError.message), 'Viewer unauthorized offer attempt was BLOCKED');

  // ── 6. Stream Teardown ───────────────────────────────────────────────────
  console.log('\nStep 6: Testing Host Stream Teardown...');
  const streamEndedPromise = new Promise<void>((resolve) => {
    viewerSocket.on('webrtc:host-stream-ended', () => resolve());
  });
  hostSocket.emit('webrtc:host-stream-ended', { roomId });
  await streamEndedPromise;
  assert(true, 'Viewer received webrtc:host-stream-ended notification');

  // Cleanup
  hostSocket.disconnect();
  viewerSocket.disconnect();

  console.log(`\n========================================`);
  console.log(`E2E Verification Summary: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runE2ETests().catch((err) => {
  console.error('Fatal E2E test error:', err);
  process.exit(1);
});
