import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client';
import { RoomRepository } from '../src/repositories/room.repository.js';
import { UserRepository } from '../src/repositories/user.repository.js';
import { WEBRTC_EVENTS } from '../src/constants/socketEvents.js';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

describe('MVP Milestone: End-to-End Watch Party & Invite Flow Verification', () => {
  const hostId = 'anon_host_' + Date.now();
  let guestUser: { guestId: string; friendCode: string; sessionSecret: string };
  const regUser = { userId: '123e4567-e89b-12d3-a456-426614174000', friendCode: '191203', username: 'testuser' };
  let roomId: string;

  let hostSocket: ClientSocketType;
  let guestSocket: ClientSocketType;

  before(async () => {
    // Synchronize test registered user profile
    const profile = await UserRepository.syncProfile(regUser.userId, { username: regUser.username });
    if (profile.friendCode) {
      regUser.friendCode = profile.friendCode;
    }

    // Obtain an active guest session via the real API
    const sessRes = await axios.post(`${BACKEND_URL}/api/guests/session`);
    assert.equal(sessRes.status, 200);
    guestUser = {
      guestId: sessRes.data.data.guestId,
      friendCode: sessRes.data.data.friendCode,
      sessionSecret: sessRes.data.data.sessionSecret,
    };
  });

  after(async () => {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (guestSocket?.connected) guestSocket.disconnect();
  });

  // ── Step 1: 6-Digit Friend Code Lookups ───────────────────────────────────
  it('1. Host can look up registered user by exact 6-digit code', async () => {
    const res = await axios.get(`${BACKEND_URL}/api/friends/search`, {
      params: { q: regUser.friendCode },
    });

    assert.equal(res.status, 200);
    const users = res.data?.data?.users;
    assert.ok(Array.isArray(users), 'Search results must be an array');
    assert.equal(users.length, 1, 'Exactly one user should match the unique registered code');
    assert.equal(users[0].friendCode, regUser.friendCode);
    assert.equal(users[0].identityType, 'REGISTERED');
    assert.equal(users[0].isGuest, false);
    assert.equal(users[0].username, regUser.username);
  });

  it('2. Host can look up temporary active guest by exact 6-digit code', async () => {
    const res = await axios.get(`${BACKEND_URL}/api/friends/search`, {
      params: { q: guestUser.friendCode },
    });

    assert.equal(res.status, 200);
    const users = res.data?.data?.users;
    assert.ok(Array.isArray(users));
    assert.equal(users.length, 1, 'Exactly one guest should match the unique guest code');
    assert.equal(users[0].friendCode, guestUser.friendCode);
    assert.equal(users[0].identityType, 'GUEST');
    assert.equal(users[0].isGuest, true);
    assert.equal(users[0].id, guestUser.guestId);
  });

  it('3. Nonexistent or invalid 6-digit code returns empty results', async () => {
    const res = await axios.get(`${BACKEND_URL}/api/friends/search`, {
      params: { q: '000000' },
    });

    assert.equal(res.status, 200);
    const users = res.data?.data?.users;
    assert.ok(Array.isArray(users));
    if (users.length > 0) {
      assert.notEqual(users[0].id, guestUser.guestId);
      assert.notEqual(users[0].id, regUser.userId);
    }
  });

  // ── Step 2: Room Creation & Invitation Generation ────────────────────────
  it('4. Authorized room host creates watch party room for local stream', async () => {
    const createRes = await axios.post(`${BACKEND_URL}/api/rooms/create`, {
      hostId,
      movieUrl: '',
      mediaName: 'summer_blockbuster.mp4',
    });

    assert.equal(createRes.status, 201);
    assert.ok(createRes.data.roomId, 'Room ID must be returned');
    roomId = createRes.data.roomId;
    assert.equal(createRes.data.metadata.host_id, hostId);
  });

  // ── Step 3: Room Admission Flow (Knock, Approve & Join) ───────────────────
  it('5. Host connects socket and joins room', async () => {
    hostSocket = ClientSocket(BACKEND_URL, {
      transports: ['websocket'],
      forceNew: true,
    });

    await new Promise<void>((resolve, reject) => {
      hostSocket.on('connect', () => {
        hostSocket.emit('room:join', {
          roomId,
          userId: hostId,
        });
      });

      hostSocket.on('room:active-users', (users: Array<{ userId: string; role: string; isHost: boolean }>) => {
        const found = users.find((u) => u.userId === hostId);
        if (found) {
          assert.equal(found.isHost, true, 'User must be recognized as host');
          resolve();
        }
      });

      hostSocket.on('error', (err) => reject(new Error('Host socket error: ' + err)));
      setTimeout(() => reject(new Error('Host socket join timeout')), 8000);
    });
  });

  it('6. Guest knocks on room and host receives admission alert', async () => {
    guestSocket = ClientSocket(BACKEND_URL, {
      transports: ['websocket'],
      forceNew: true,
      auth: {
        sessionSecret: guestUser.sessionSecret,
      },
    });

    await new Promise<void>((resolve, reject) => {
      guestSocket.on('connect', () => {
        guestSocket.emit('room:knock', {
          roomId,
          username: `Guest_${guestUser.friendCode}`,
        });
      });

      hostSocket.once('room:knock-alert', (data: { socketId: string; username: string }) => {
        assert.equal(data.socketId, guestSocket.id);
        assert.match(data.username, new RegExp(guestUser.friendCode));
        resolve();
      });

      guestSocket.on('error', (err) => reject(new Error('Guest knock socket error: ' + err)));
      setTimeout(() => reject(new Error('Knock alert timeout')), 8000);
    });
  });

  it('7. Host approves guest admission and guest joins room', async () => {
    const approvedPromise = new Promise<{ roomId: string }>((resolve) => {
      guestSocket.once('room:entry-approved', (data) => resolve(data));
    });

    // Host approves entry
    hostSocket.emit('room:approve-entry', { guestSocketId: guestSocket.id });
    await approvedPromise;

    // Guest joins room with authenticated sessionSecret
    const activeUsersPromise = new Promise<void>((resolve, reject) => {
      guestSocket.on('room:active-users', (users: Array<{ userId: string; role: string; isHost: boolean }>) => {
        const foundGuest = users.find((u) => u.userId === guestUser.guestId);
        if (foundGuest) {
          assert.equal(foundGuest.isHost, false);
          assert.equal(foundGuest.role, 'viewer');
          resolve();
        }
      });
      guestSocket.on('error', (err) => reject(new Error('Guest join error: ' + err)));
      setTimeout(() => reject(new Error('Guest join timeout')), 8000);
    });

    guestSocket.emit('room:join', {
      roomId,
      userId: guestUser.guestId,
      sessionSecret: guestUser.sessionSecret,
    });

    await activeUsersPromise;
  });

  // ── Step 4: WebRTC Signaling Handshake ────────────────────────────────────
  it('8. Viewer emits webrtc:viewer-ready and host receives it', async () => {
    const readyPromise = new Promise<{ viewerId: string; connectionId: string }>((resolve) => {
      hostSocket.once(WEBRTC_EVENTS.VIEWER_READY, (data) => resolve(data));
    });

    guestSocket.emit(WEBRTC_EVENTS.VIEWER_READY, {
      roomId,
      viewerId: guestUser.guestId,
      connectionId: 'conn-e2e-1',
    });

    const readyData = await readyPromise;
    assert.equal(readyData.viewerId, guestUser.guestId);
    assert.equal(readyData.connectionId, 'conn-e2e-1');
  });

  it('9. Host sends SDP offer and viewer receives it', async () => {
    const offerPromise = new Promise<{ sdp: { type: string; sdp: string }; connectionId: string }>((resolve) => {
      guestSocket.once(WEBRTC_EVENTS.OFFER, (data) => resolve(data));
    });

    const mockOffer = {
      roomId,
      targetId: guestUser.guestId,
      sdp: { type: 'offer', sdp: 'v=0\r\no=host 123456 2 IN IP4 127.0.0.1\r\ns=Test Stream' },
      connectionId: 'conn-e2e-1',
    };

    hostSocket.emit(WEBRTC_EVENTS.OFFER, mockOffer);

    const offerData = await offerPromise;
    assert.equal(offerData.sdp.type, 'offer');
    assert.equal(offerData.connectionId, 'conn-e2e-1');
  });

  it('10. Viewer sends SDP answer and host receives it', async () => {
    const answerPromise = new Promise<{ sdp: { type: string; sdp: string }; connectionId: string; senderId: string }>((resolve) => {
      hostSocket.once(WEBRTC_EVENTS.ANSWER, (data) => resolve(data));
    });

    const mockAnswer = {
      roomId,
      targetId: 'host',
      sdp: { type: 'answer', sdp: 'v=0\r\no=viewer 654321 2 IN IP4 127.0.0.1\r\ns=Test Stream' },
      connectionId: 'conn-e2e-1',
      senderId: guestUser.guestId,
    };

    guestSocket.emit(WEBRTC_EVENTS.ANSWER, mockAnswer);

    const answerData = await answerPromise;
    assert.equal(answerData.sdp.type, 'answer');
    assert.equal(answerData.senderId, guestUser.guestId);
  });

  it('11. Bidirectional ICE candidate relay', async () => {
    const hostCandidate = { candidate: 'candidate:1 1 UDP ...', sdpMid: '0', sdpMLineIndex: 0 };
    const guestCandidate = { candidate: 'candidate:2 1 UDP ...', sdpMid: '0', sdpMLineIndex: 0 };

    const viewerIcePromise = new Promise<{ candidate: typeof hostCandidate }>((resolve) => {
      guestSocket.once(WEBRTC_EVENTS.ICE_CANDIDATE, (data) => resolve(data));
    });
    const hostIcePromise = new Promise<{ candidate: typeof guestCandidate }>((resolve) => {
      hostSocket.once(WEBRTC_EVENTS.ICE_CANDIDATE, (data) => resolve(data));
    });

    hostSocket.emit(WEBRTC_EVENTS.ICE_CANDIDATE, {
      roomId,
      targetId: guestUser.guestId,
      candidate: hostCandidate,
      connectionId: 'conn-e2e-1',
    });

    guestSocket.emit(WEBRTC_EVENTS.ICE_CANDIDATE, {
      roomId,
      targetId: 'host',
      candidate: guestCandidate,
      connectionId: 'conn-e2e-1',
      senderId: guestUser.guestId,
    });

    const [viewerReceived, hostReceived] = await Promise.all([viewerIcePromise, hostIcePromise]);
    assert.equal(viewerReceived.candidate.candidate, hostCandidate.candidate);
    assert.equal(hostReceived.candidate.candidate, guestCandidate.candidate);
  });

  // ── Step 5: WebRTC Play, Pause & Seek Synchronization ────────────────────
  it('12. Host initiates video:play -> Viewer receives sync-state with isPlaying: true', async () => {
    const syncPromise = new Promise<{ isPlaying: boolean; position: number; stateVersion: number }>((resolve) => {
      guestSocket.once('sync-state', (data) => {
        if (data.isPlaying) resolve(data);
      });
    });

    hostSocket.emit('video:play', { roomId, position: 15.5 });

    const sync = await syncPromise;
    assert.equal(sync.isPlaying, true);
    assert.equal(sync.position, 15.5);
    assert.ok(typeof sync.stateVersion === 'number' && sync.stateVersion > 0);
  });

  it('13. Host initiates video:pause -> Viewer receives sync-state with isPlaying: false', async () => {
    const syncPromise = new Promise<{ isPlaying: boolean; position: number; stateVersion: number }>((resolve) => {
      guestSocket.once('sync-state', (data) => {
        if (!data.isPlaying) resolve(data);
      });
    });

    hostSocket.emit('video:pause', { roomId, position: 28.0 });

    const sync = await syncPromise;
    assert.equal(sync.isPlaying, false);
    assert.equal(sync.position, 28.0);
    assert.ok(typeof sync.stateVersion === 'number' && sync.stateVersion > 0);
  });

  it('14. Host initiates video:seek -> Viewer receives sync-state with updated position', async () => {
    const syncPromise = new Promise<{ isPlaying: boolean; position: number; stateVersion: number }>((resolve) => {
      guestSocket.once('sync-state', (data) => {
        if (data.position === 120.0) resolve(data);
      });
    });

    hostSocket.emit('video:seek', { roomId, position: 120.0 });

    const sync = await syncPromise;
    assert.equal(sync.position, 120.0);
  });

  // ── Step 6: RBAC Protection & Stream Teardown ────────────────────────────
  it('15. Viewer playback control is blocked by RBAC without altering room state', async () => {
    const errorPromise = new Promise<{ message: string; code?: string }>((resolve) => {
      guestSocket.once('error_notification', (data) => resolve(data));
    });

    // Viewer unauthorized pause attempt
    guestSocket.emit('video:pause', { roomId, position: 5.0 });

    const err = await errorPromise;
    assert.match(err.message, /viewers cannot control media playback/i);

    // Verify room state was NOT modified to 5.0s
    const state = await RoomRepository.getRoomState(roomId);
    assert.equal(state?.position, 120.0, 'Room state position must remain 120.0s');
  });

  it('16. Host stream ended broadcasts to viewer', async () => {
    const endedPromise = new Promise<void>((resolve) => {
      guestSocket.once(WEBRTC_EVENTS.HOST_STREAM_ENDED, () => resolve());
    });

    hostSocket.emit(WEBRTC_EVENTS.HOST_STREAM_ENDED, { roomId });

    await endedPromise;
    const finalState = await RoomRepository.getRoomState(roomId);
    assert.equal(finalState?.isPlaying, false);
  });
});
