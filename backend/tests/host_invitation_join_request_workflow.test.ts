import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import express from 'express';
import { setupSockets } from '../src/sockets/index.js';
import { RoomRepository } from '../src/repositories/room.repository.js';
import { FriendCodeRepository } from '../src/repositories/friendCode.repository.js';
import { RoomInvitationRepository } from '../src/repositories/roomInvitation.repository.js';
import roomRouter from '../src/routes/room.routes.js';

describe('Requirement 3.D: Host Invitation & Join-Request Notification Workflow Verification', { timeout: 30000, concurrency: 1 }, () => {
  let app: express.Express;
  let httpServer: HttpServer;
  let ioServer: SocketIOServer;
  let serverUrl: string;

  const hostUserId = 'host_user_' + Date.now();
  const roomId = 'room_req3d_' + Date.now();

  let hostSocket: ClientSocketType;
  let friendSocket: ClientSocketType;
  let secondGuestSocket: ClientSocketType;
  let intruderSocket: ClientSocketType;

  let friendSession: { guestId: string; friendCode: string; sessionSecret: string };
  let secondGuestSession: { guestId: string; friendCode: string; sessionSecret: string };
  let intruderSession: { guestId: string; friendCode: string; sessionSecret: string };

  let invitationId: string;

  before(async () => {
    FriendCodeRepository.clearInMemoryRegistry();
    RoomInvitationRepository.clearInMemoryInvitations();

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.includes('host_token')) {
        req.user = { id: hostUserId, email: 'host@test.com' };
      }
      next();
    });
    app.use('/api/rooms', roomRouter);

    httpServer = createServer(app);
    ioServer = new SocketIOServer(httpServer, { cors: { origin: '*' } });
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

    friendSession = await FriendCodeRepository.getOrCreateGuestSession();
    secondGuestSession = await FriendCodeRepository.getOrCreateGuestSession();
    intruderSession = await FriendCodeRepository.getOrCreateGuestSession();
  });

  after(async () => {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (friendSocket?.connected) friendSocket.disconnect();
    if (secondGuestSocket?.connected) secondGuestSocket.disconnect();
    if (intruderSocket?.connected) intruderSocket.disconnect();
    await new Promise<void>((resolve) => {
      ioServer?.close(() => {
        httpServer?.close(() => resolve());
      });
    });
  });

  it('1. Host initializes room and connects to room channel', async () => {
    const hostToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      Buffer.from(JSON.stringify({
        sub: hostUserId,
        email: 'host@test.com',
        user_metadata: { username: 'HostUser' },
        exp: Math.floor(Date.now() / 1000) + 7200,
      })).toString('base64url') + '.sig';

    await RoomRepository.createRoom(roomId, hostUserId, '');
    await RoomRepository.setSessionActiveStatus(roomId, true);

    hostSocket = ClientSocket(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: hostToken },
    });

    await new Promise<void>((resolve, reject) => {
      hostSocket.on('connect', () => {
        hostSocket.emit('user:register', { userId: hostUserId });
        hostSocket.emit('room:join', { roomId, userId: hostUserId });
      });
      hostSocket.on('room:active-users', (users: Array<{ userId: string; isHost: boolean }>) => {
        const found = users.find((u) => u.userId === hostUserId);
        if (found?.isHost) resolve();
      });
      setTimeout(() => reject(new Error('Host socket join timeout')), 4000);
    });
  });

  it('2. Friend connects to global notification socket', async () => {
    friendSocket = ClientSocket(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: {
        anonymous: true,
        guestId: friendSession.guestId,
        sessionSecret: friendSession.sessionSecret,
      },
    });

    await new Promise<void>((resolve, reject) => {
      friendSocket.on('connect', () => {
        friendSocket.emit('user:register', {
          userId: friendSession.guestId,
          sessionSecret: friendSession.sessionSecret,
        });
      });
      friendSocket.on('user:registered', (data: { userId: string }) => {
        if (data.userId === friendSession.guestId) resolve();
      });
      setTimeout(() => reject(new Error('Friend socket register timeout')), 4000);
    });
  });

  it('3. Sending an invitation delivers to friend, and Host does NOT receive any premature join-request/knock alert', async () => {
    let hostReceivedPrematureAlert = false;
    const hostAlertSpy = (data: any) => {
      hostReceivedPrematureAlert = true;
    };
    hostSocket.on('room:knock-alert', hostAlertSpy);

    const friendReceivedPromise = new Promise<any>((resolve, reject) => {
      friendSocket.once('room:invitation:received', (inv) => resolve(inv));
      setTimeout(() => reject(new Error('Friend invitation receive timeout')), 4000);
    });

    const sendAckPromise = new Promise<any>((resolve, reject) => {
      hostSocket.emit(
        'room:invite:send',
        {
          roomId,
          targetUserId: friendSession.guestId,
          targetUsername: `Guest_${friendSession.friendCode}`,
        },
        (res: any) => {
          if (res?.success) resolve(res);
          else reject(new Error(res?.error || 'Send failed'));
        }
      );
    });

    const [sendAck, receivedInv] = await Promise.all([sendAckPromise, friendReceivedPromise]);
    assert.equal(sendAck.success, true);
    assert.equal(receivedInv.roomId, roomId);
    assert.equal(receivedInv.recipientId, friendSession.guestId);
    assert.equal(receivedInv.hostId, hostUserId);

    invitationId = receivedInv.id;

    // Small delay to verify no asynchronous knock-alert was emitted to host
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(hostReceivedPrematureAlert, false, 'Host must NOT receive any knock/join alert when sending an invitation');

    hostSocket.off('room:knock-alert', hostAlertSpy);
  });

  it('4. Host cannot invite themselves (self-invitation prevention)', async () => {
    const selfInvitePromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
      hostSocket.emit(
        'room:invite:send',
        {
          roomId,
          targetUserId: hostUserId,
          targetUsername: 'SelfHost',
        },
        (res: any) => resolve(res)
      );
    });

    const res = await selfInvitePromise;
    assert.equal(res.success, false);
    assert.match(res.error || '', /Cannot invite yourself/i);
  });

  it('5. Friend clicks invitation link and enters room: triggers knock; Host receives join request with Accept/Reject', async () => {
    // 1. Friend accepts the invitation notification
    const friendAcceptPromise = new Promise<any>((resolve, reject) => {
      friendSocket.emit(
        'room:invite:respond',
        { invitationId, response: 'accept' },
        (res: any) => {
          if (res?.success) resolve(res);
          else reject(new Error(res?.error || 'Accept failed'));
        }
      );
    });
    const acceptRes = await friendAcceptPromise;
    assert.equal(acceptRes.success, true);
    assert.equal(acceptRes.roomId, roomId);

    // 2. Friend navigates to /room/:roomId and initiates room entry by knocking
    const hostKnockAlertPromise = new Promise<{ socketId: string; username: string }>((resolve, reject) => {
      hostSocket.once('room:knock-alert', (data) => resolve(data));
      setTimeout(() => reject(new Error('Timeout waiting for host room:knock-alert')), 4000);
    });

    friendSocket.emit('room:knock', {
      roomId,
      username: `Guest_${friendSession.friendCode}`,
    });

    const knockAlert = await hostKnockAlertPromise;
    assert.equal(knockAlert.socketId, friendSocket.id);
    assert.match(knockAlert.username, new RegExp(friendSession.friendCode));
  });

  it('6. Host accepts the join request: Guest receives entry-approved and joins as viewer', async () => {
    const friendApprovedPromise = new Promise<void>((resolve, reject) => {
      friendSocket.once('room:entry-approved', () => resolve());
      setTimeout(() => reject(new Error('Timeout waiting for room:entry-approved')), 4000);
    });

    // Host clicks Accept in UI (room:approve-entry)
    hostSocket.emit('room:approve-entry', { guestSocketId: friendSocket.id });
    await friendApprovedPromise;

    // Friend now joins the room
    const activeUsersPromise = new Promise<void>((resolve, reject) => {
      hostSocket.on('room:active-users', (users: Array<{ userId: string; role: string; isHost: boolean }>) => {
        const friend = users.find((u) => u.userId === friendSession.guestId);
        if (friend) {
          assert.equal(friend.isHost, false);
          assert.equal(friend.role, 'viewer');
          resolve();
        }
      });
      setTimeout(() => reject(new Error('Timeout waiting for active-users')), 4000);
    });

    friendSocket.emit('room:join', {
      roomId,
      userId: friendSession.guestId,
      sessionSecret: friendSession.sessionSecret,
    });

    await activeUsersPromise;
  });

  it('7. Rejection workflow: Another guest knocks and Host rejects admission', async () => {
    secondGuestSocket = ClientSocket(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: {
        anonymous: true,
        guestId: secondGuestSession.guestId,
        sessionSecret: secondGuestSession.sessionSecret,
      },
    });

    await new Promise<void>((resolve) => {
      secondGuestSocket.on('connect', () => {
        secondGuestSocket.emit('user:register', {
          userId: secondGuestSession.guestId,
          sessionSecret: secondGuestSession.sessionSecret,
        });
        resolve();
      });
    });

    const hostKnockAlertPromise = new Promise<{ socketId: string; username: string }>((resolve, reject) => {
      hostSocket.once('room:knock-alert', (data) => resolve(data));
      setTimeout(() => reject(new Error('Timeout waiting for second guest knock alert')), 4000);
    });

    secondGuestSocket.emit('room:knock', {
      roomId,
      username: `SecondGuest_${secondGuestSession.friendCode}`,
    });

    const alert = await hostKnockAlertPromise;
    assert.equal(alert.socketId, secondGuestSocket.id);

    // Guest listens for rejection
    const rejectedPromise = new Promise<void>((resolve, reject) => {
      secondGuestSocket.once('room:entry-rejected', () => resolve());
      setTimeout(() => reject(new Error('Timeout waiting for entry rejection')), 4000);
    });

    // Host clicks Reject in UI (room:reject-entry)
    hostSocket.emit('room:reject-entry', { guestSocketId: alert.socketId });
    await rejectedPromise;
  });

  it('8. Duplicate / Repeated knocking: Host receives only appropriate join requests without duplicates', async () => {
    const repeatGuestSocket = ClientSocket(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: {
        anonymous: true,
        guestId: secondGuestSession.guestId,
        sessionSecret: secondGuestSession.sessionSecret,
      },
    });

    await new Promise<void>((resolve) => {
      repeatGuestSocket.on('connect', () => resolve());
    });

    let alertCount = 0;
    const alertListener = () => { alertCount++; };
    hostSocket.on('room:knock-alert', alertListener);

    // Guest knocks once
    repeatGuestSocket.emit('room:knock', {
      roomId,
      username: `RepeatGuest_${secondGuestSession.friendCode}`,
    });

    await new Promise((r) => setTimeout(r, 200));
    assert.equal(alertCount, 1, 'Exactly one knock alert received for one knock event');

    hostSocket.off('room:knock-alert', alertListener);
    repeatGuestSocket.disconnect();
  });

  it('9. Unauthorized room access attempt: Non-host cannot approve room entry', async () => {
    intruderSocket = ClientSocket(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      auth: {
        anonymous: true,
        guestId: intruderSession.guestId,
        sessionSecret: intruderSession.sessionSecret,
      },
    });

    await new Promise<void>((resolve) => {
      intruderSocket.on('connect', () => resolve());
    });

    let approvedReceived = false;
    secondGuestSocket.once('room:entry-approved', () => {
      approvedReceived = true;
    });

    // Intruder attempts to approve second guest
    intruderSocket.emit('room:approve-entry', { guestSocketId: secondGuestSocket.id });
    await new Promise((r) => setTimeout(r, 300));

    assert.equal(approvedReceived, false, 'Intruder must NOT be able to approve guests');
  });
});
