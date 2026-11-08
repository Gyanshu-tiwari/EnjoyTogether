import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import express from 'express';
import { setupSockets } from '../src/sockets/index.js';
import { RoomRepository } from '../src/repositories/room.repository.js';
import { FriendCodeRepository } from '../src/repositories/friendCode.repository.js';
import { FriendRepository } from '../src/repositories/friend.repository.js';
import { RoomInvitationRepository } from '../src/repositories/roomInvitation.repository.js';
import roomRouter from '../src/routes/room.routes.js';
import { WEBRTC_EVENTS } from '../src/constants/socketEvents.js';

describe('Host-to-Guest Watch Party Invitation Lifecycle & Host Role Preservation Tests', { timeout: 60000, concurrency: 1 }, () => {
  let app: express.Express;
  let httpServer: HttpServer;
  let ioServer: SocketIOServer;
  let serverUrl: string;

  const hostUserId = 'host_reg_uuid_' + Date.now();
  const roomId = 'room_party_' + Date.now();

  let hostSocket: ClientSocketType;
  let guestSocket: ClientSocketType;
  let intruderSocket: ClientSocketType;

  let guestSession: {
    guestId: string;
    friendCode: string;
    sessionSecret: string;
  };
  let intruderSession: {
    guestId: string;
    friendCode: string;
    sessionSecret: string;
  };

  let activeInvitationId: string;

  before(async () => {
    // 1. Setup clean repositories
    FriendCodeRepository.clearInMemoryRegistry();
    RoomInvitationRepository.clearInMemoryInvitations();

    // 2. Setup Express app & Socket.IO server
    app = express();
    app.use(express.json());
    // Attach dummy authenticated user middleware for testing
    app.use((req, _res, next) => {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.includes('host_token')) {
        req.user = { id: hostUserId, email: 'host@test.com' };
      }
      next();
    });
    app.use('/api/rooms', roomRouter);

    httpServer = createServer(app);
    ioServer = new SocketIOServer(httpServer, {
      cors: { origin: '*' },
    });
    setupSockets(ioServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        if (typeof addr === 'object' && addr !== null) {
          serverUrl = `http://localhost:${addr.port}`;
          resolve();
        }
      });
    });

    // 3. Allocate Guest session and Intruder session
    guestSession = await FriendCodeRepository.getOrCreateGuestSession();
    intruderSession = await FriendCodeRepository.getOrCreateGuestSession();
  });

  after(async () => {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (guestSocket?.connected) guestSocket.disconnect();
    if (intruderSocket?.connected) intruderSocket.disconnect();
    await new Promise<void>((resolve) => {
      ioServer?.close(() => {
        httpServer?.close(() => resolve());
      });
    });
  });

  it('1. Registered host creates watch party room and joins as HOST', async () => {
    const hostToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      Buffer.from(JSON.stringify({
        sub: hostUserId,
        email: 'host@test.com',
        user_metadata: { username: 'SuperHost' },
        exp: Math.floor(Date.now() / 1000) + 7200,
      })).toString('base64url') + '.sig';

    await RoomRepository.createRoom(roomId, hostUserId, '');
    const meta = await RoomRepository.getRoomMetadata(roomId);
    assert.equal(meta.host_id, hostUserId, 'Room host_id must match registered host user ID');

    // Host connects socket
    hostSocket = ClientSocket(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: hostToken },
    });


    await new Promise<void>((resolve, reject) => {
      hostSocket.on('connect', () => {
        // Register host identity and join room
        hostSocket.emit('user:register', { userId: hostUserId });
        hostSocket.emit('room:join', { roomId, userId: hostUserId });
      });

      hostSocket.on('room:active-users', (users: Array<{ userId: string; role: string; isHost: boolean }>) => {
        const hostUser = users.find((u) => u.userId === hostUserId);
        if (hostUser) {
          assert.equal(hostUser.isHost, true, 'Room creator must be assigned host role');
          assert.equal(hostUser.role, 'host', 'Host role must be "host"');
          resolve();
        }
      });

      setTimeout(() => reject(new Error('Timeout waiting for host join')), 5000);
    });
  });

  it('2. Guest connects global notification socket and registers identity', async () => {
    guestSocket = ClientSocket(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: {
        anonymous: true,
        sessionSecret: guestSession.sessionSecret,
        guestId: guestSession.guestId,
      },
    });

    await new Promise<void>((resolve, reject) => {
      guestSocket.on('connect', () => {
        guestSocket.emit('user:register', {
          userId: guestSession.guestId,
          sessionSecret: guestSession.sessionSecret,
        });
      });

      guestSocket.on('user:registered', (data: { userId: string }) => {
        assert.equal(data.userId, guestSession.guestId, 'Registered socket user must match guestId');
        resolve();
      });

      setTimeout(() => reject(new Error('Timeout waiting for guest registration')), 5000);
    });
  });

  it('3. Host searches for guest using 6-digit friend code', async () => {
    const results = await FriendRepository.searchUsers(guestSession.friendCode, hostUserId);
    assert.equal(results.length, 1, 'Should find exactly one user by 6-digit friend code');
    assert.equal(results[0].id, guestSession.guestId, 'Found identity ID must match guestId');
    assert.equal(results[0].friendCode, guestSession.friendCode, 'Friend code must match');
    assert.equal(results[0].isGuest, true, 'User should be identified as guest');
  });

  it('4. Host sends room invitation and Guest receives real-time notification', async () => {
    const guestReceivedPromise = new Promise<{
      id: string;
      roomId: string;
      hostId: string;
      recipientId: string;
    }>((resolve, reject) => {
      guestSocket.on('room:invitation:received', (invitation) => {
        resolve(invitation);
      });
      setTimeout(() => reject(new Error('Timeout waiting for invitation on guest socket')), 5000);
    });

    // Host emits room:invite:send
    const sendAckPromise = new Promise<{ success: boolean; delivered: boolean; invitation: any }>((resolve, reject) => {
      hostSocket.emit(
        'room:invite:send',
        {
          roomId,
          targetUserId: guestSession.guestId,
          targetUsername: `Guest_${guestSession.friendCode}`,
        },
        (res: any) => {
          if (res?.success) resolve(res);
          else reject(new Error(res?.error || 'Send failed'));
        }
      );
      setTimeout(() => reject(new Error('Timeout waiting for host send ack')), 5000);
    });

    const [ackRes, receivedInv] = await Promise.all([sendAckPromise, guestReceivedPromise]);

    assert.equal(ackRes.success, true, 'Host send must succeed');
    assert.equal(ackRes.delivered, true, 'Delivery must be confirmed to online guest socket');
    assert.equal(receivedInv.roomId, roomId, 'Invitation room ID must match');
    assert.equal(receivedInv.hostId, hostUserId, 'Invitation host ID must match');
    assert.equal(receivedInv.recipientId, guestSession.guestId, 'Recipient ID must match guest');

    activeInvitationId = receivedInv.id;
  });

  it('5. Security: Unrelated guest cannot accept another guest invitation', async () => {
    intruderSocket = ClientSocket(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: {
        anonymous: true,
        sessionSecret: intruderSession.sessionSecret,
        guestId: intruderSession.guestId,
      },
    });

    await new Promise<void>((resolve) => {
      intruderSocket.on('connect', () => {
        intruderSocket.emit('user:register', {
          userId: intruderSession.guestId,
          sessionSecret: intruderSession.sessionSecret,
        });
        resolve();
      });
    });

    // Intruder attempts to accept activeInvitationId
    const intruderAttemptPromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
      intruderSocket.emit(
        'room:invite:respond',
        { invitationId: activeInvitationId, response: 'accept' },
        (res: any) => resolve(res)
      );
    });

    const res = await intruderAttemptPromise;
    assert.equal(res.success, false, 'Intruder must be rejected from accepting another invitation');
    assert.ok(
      res.error?.includes('Unauthorized') || res.error?.includes('not addressed to you'),
      'Must return unauthorized error'
    );
  });

  it('6. Intended Guest accepts invitation and Host receives acceptance alert', async () => {
    const hostAlertPromise = new Promise<{ invitationId: string; roomId: string; recipientId: string }>((resolve, reject) => {
      hostSocket.on('room:invitation:accepted', (data) => resolve(data));
      setTimeout(() => reject(new Error('Timeout waiting for host acceptance alert')), 5000);
    });

    const guestAckPromise = new Promise<{ success: boolean; roomId: string }>((resolve, reject) => {
      guestSocket.emit(
        'room:invite:respond',
        { invitationId: activeInvitationId, response: 'accept' },
        (res: any) => {
          if (res?.success) resolve(res);
          else reject(new Error(res?.error || 'Accept failed'));
        }
      );
      setTimeout(() => reject(new Error('Timeout waiting for guest accept ack')), 5000);
    });

    const [guestAck, hostAlert] = await Promise.all([guestAckPromise, hostAlertPromise]);
    assert.equal(guestAck.success, true, 'Acceptance must succeed');
    assert.equal(guestAck.roomId, roomId, 'Must return correct room ID');
    assert.equal(hostAlert.recipientId, guestSession.guestId, 'Host alert must indicate correct recipient');
    assert.equal(hostAlert.roomId, roomId, 'Host alert must indicate correct room');
  });

  it('7. Invited Guest knocks on room, Host receives join request with Accept/Reject, and Host approves admission', async () => {
    // 1. Host waits for knock-alert (join request)
    const hostKnockAlertPromise = new Promise<{ socketId: string; username: string }>((resolve, reject) => {
      hostSocket.once('room:knock-alert', (data) => resolve(data));
      setTimeout(() => reject(new Error('Timeout waiting for room:knock-alert on host')), 5000);
    });

    // 2. Guest knocks
    guestSocket.emit('room:knock', {
      roomId,
      username: `Guest_${guestSession.friendCode}`,
    });

    const knockAlert = await hostKnockAlertPromise;
    assert.equal(knockAlert.socketId, guestSocket.id, 'Knock alert socketId must match guest socket');

    // 3. Guest waits for approval
    const approvedPromise = new Promise<void>((resolve, reject) => {
      guestSocket.once('room:entry-approved', () => resolve());
      setTimeout(() => reject(new Error('Timeout waiting for room:entry-approved on guest')), 5000);
    });

    // 4. Host approves guest entry
    hostSocket.emit('room:approve-entry', { guestSocketId: knockAlert.socketId });
    await approvedPromise;

    // 5. Guest joins room
    const activeUsersPromise = new Promise<void>((resolve, reject) => {
      hostSocket.on('room:active-users', (users) => {
        const guest = users.find((u) => u.userId === guestSession.guestId);
        if (guest) {
          assert.equal(guest.isHost, false, 'Guest must not be host');
          assert.equal(guest.role, 'viewer', 'Guest role must be viewer');
          resolve();
        }
      });
      setTimeout(() => reject(new Error('Timeout waiting for active users update')), 5000);
    });

    guestSocket.emit('room:join', {
      roomId,
      userId: guestSession.guestId,
      sessionSecret: guestSession.sessionSecret,
    });

    await activeUsersPromise;
  });

  it('8. Host remains authoritative HOST after guest joins and after sync re-evaluation', async () => {
    // Re-check room active users on host socket
    const users = await new Promise<Array<{ userId: string; role: string; isHost: boolean }>>((resolve) => {
      hostSocket.emit('room:join', { roomId, userId: hostUserId });
      hostSocket.once('room:active-users', (u) => resolve(u));
    });

    const hostEntry = users.find((u) => u.userId === hostUserId);
    assert.ok(hostEntry, 'Host must be present in active users');
    assert.equal(hostEntry.isHost, true, 'Host must remain isHost=true');
    assert.equal(hostEntry.role, 'host', 'Host role must remain "host"');
  });

  it('9. WebRTC signaling relay connects Host and Guest', async () => {
    const connId = 'conn_' + Date.now();

    // 1. Viewer sends viewer-ready
    const hostReceivedReady = new Promise<{ viewerId: string; connectionId: string }>((resolve, reject) => {
      hostSocket.on(WEBRTC_EVENTS.VIEWER_READY, (data) => resolve(data));
      setTimeout(() => reject(new Error('Timeout waiting for viewer-ready')), 5000);
    });

    guestSocket.emit(WEBRTC_EVENTS.VIEWER_READY, {
      roomId,
      viewerId: guestSession.guestId,
      connectionId: connId,
    });

    const readyData = await hostReceivedReady;
    assert.equal(readyData.viewerId, guestSession.guestId);
    assert.equal(readyData.connectionId, connId);

    // 2. Host sends offer
    const guestReceivedOffer = new Promise<{ sdp: any; connectionId: string }>((resolve, reject) => {
      guestSocket.on(WEBRTC_EVENTS.OFFER, (data) => resolve(data));
      setTimeout(() => reject(new Error('Timeout waiting for offer on guest')), 5000);
    });

    hostSocket.emit(WEBRTC_EVENTS.OFFER, {
      roomId,
      targetId: guestSession.guestId,
      sdp: { type: 'offer', sdp: 'v=0\r\no=host 1234 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' },
      connectionId: connId,
    });

    const offerData = await guestReceivedOffer;
    assert.equal(offerData.connectionId, connId);
    assert.equal(offerData.sdp.type, 'offer');

    // 3. Guest sends answer
    const hostReceivedAnswer = new Promise<{ sdp: any; connectionId: string }>((resolve, reject) => {
      hostSocket.on(WEBRTC_EVENTS.ANSWER, (data) => resolve(data));
      setTimeout(() => reject(new Error('Timeout waiting for answer on host')), 5000);
    });

    guestSocket.emit(WEBRTC_EVENTS.ANSWER, {
      roomId,
      sdp: { type: 'answer', sdp: 'v=0\r\no=guest 5678 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' },
      connectionId: connId,
    });

    const answerData = await hostReceivedAnswer;
    assert.equal(answerData.connectionId, connId);
    assert.equal(answerData.sdp.type, 'answer');

    // 4. ICE candidate exchange
    const guestReceivedIce = new Promise<{ candidate: any }>((resolve, reject) => {
      guestSocket.on(WEBRTC_EVENTS.ICE_CANDIDATE, (data) => resolve(data));
      setTimeout(() => reject(new Error('Timeout waiting for ICE candidate on guest')), 5000);
    });

    hostSocket.emit(WEBRTC_EVENTS.ICE_CANDIDATE, {
      roomId,
      targetId: guestSession.guestId,
      candidate: { candidate: 'candidate:1 1 UDP 2130706431 127.0.0.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 },
      connectionId: connId,
    });

    const iceData = await guestReceivedIce;
    assert.ok(iceData.candidate.candidate.includes('127.0.0.1'));
  });

  it('10. Video playback state synchronizes from Host to Guest (play, seek, pause)', async () => {
    // 1. Play
    const playPromise = new Promise<any>((resolve, reject) => {
      guestSocket.once('sync-state', (data) => resolve(data));
      setTimeout(() => reject(new Error('Timeout waiting for play sync-state')), 5000);
    });
    hostSocket.emit('video:play', { roomId, position: 15.5 });
    const playData = await playPromise;
    assert.equal(playData.isPlaying, true);
    assert.equal(playData.position, 15.5);

    // 2. Seek
    const seekPromise = new Promise<any>((resolve, reject) => {
      guestSocket.once('sync-state', (data) => resolve(data));
      setTimeout(() => reject(new Error('Timeout waiting for seek sync-state')), 5000);
    });
    hostSocket.emit('video:seek', { roomId, position: 42.0 });
    const seekData = await seekPromise;
    assert.equal(seekData.position, 42.0);

    // 3. Pause
    const pausePromise = new Promise<any>((resolve, reject) => {
      guestSocket.once('sync-state', (data) => resolve(data));
      setTimeout(() => reject(new Error('Timeout waiting for pause sync-state')), 5000);
    });
    hostSocket.emit('video:pause', { roomId, position: 42.0 });
    const pauseData = await pausePromise;
    assert.equal(pauseData.isPlaying, false);
    assert.equal(pauseData.position, 42.0);
  });

  it('11. RBAC enforcement: Guest cannot execute host-only operations', async () => {
    const errorPromise = new Promise<string>((resolve) => {
      guestSocket.once('error', (msg) => resolve(msg));
    });

    // Guest attempts to approve another socket
    guestSocket.emit('room:approve-entry', { guestSocketId: intruderSocket.id });
    const errorMsg = await errorPromise;
    assert.ok(errorMsg.includes('Unauthorized'), 'Guest must receive unauthorized error for approve-entry');
  });

  it('12. Decline invitation flow: Host is notified and guest is not admitted', async () => {
    // Host sends invitation to intruder
    const invRes = await new Promise<any>((resolve) => {
      hostSocket.emit(
        'room:invite:send',
        { roomId, targetUserId: intruderSession.guestId },
        (res: any) => resolve(res)
      );
    });
    assert.equal(invRes.success, true);
    const declineInvId = invRes.invitation.id;

    // Host listens for decline
    const declineAlertPromise = new Promise<any>((resolve, reject) => {
      hostSocket.once('room:invitation:declined', (data) => resolve(data));
      setTimeout(() => reject(new Error('Timeout waiting for decline alert')), 5000);
    });

    // Intruder declines
    const declineAckPromise = new Promise<any>((resolve) => {
      intruderSocket.emit(
        'room:invite:respond',
        { invitationId: declineInvId, response: 'decline' },
        (res: any) => resolve(res)
      );
    });

    const [declineAck, hostAlert] = await Promise.all([declineAckPromise, declineAlertPromise]);
    assert.equal(declineAck.success, true);
    assert.equal(declineAck.response, 'decline');
    assert.equal(hostAlert.recipientId, intruderSession.guestId);
    assert.equal(RoomInvitationRepository.isGuestPreApproved(roomId, intruderSession.guestId), false);
  });

  it('13. Offline recipient invitation persistence via pending API endpoint', async () => {
    const offlineGuestId = 'anon_offline_' + Date.now();
    // Host invites offline guest via REST
    const inviteRes = await fetch(`${serverUrl}/api/rooms/${roomId}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer host_token',
      },
      body: JSON.stringify({ targetUserId: offlineGuestId }),
    });

    assert.equal(inviteRes.status, 201);
    const inviteBody = await inviteRes.json();
    assert.equal(inviteBody.data.delivered, false, 'Delivery must be false for offline guest');
    assert.equal(inviteBody.data.invitation.recipientId, offlineGuestId);

    // Later, offline guest comes online and queries pending invitations via REST
    const pendingRes = await fetch(`${serverUrl}/api/rooms/invitations/pending`, {
      headers: {
        'x-guest-id': offlineGuestId,
      },
    });

    assert.equal(pendingRes.status, 200);
    const pendingBody = await pendingRes.json();
    assert.ok(Array.isArray(pendingBody.data.invitations));
    const found = pendingBody.data.invitations.find((i: any) => i.recipientId === offlineGuestId);
    assert.ok(found, 'Pending invitation must be retrievable when recipient comes online');
    assert.equal(found.roomId, roomId);
  });
});
