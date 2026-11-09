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
import { errorMiddleware } from '../src/middleware/error.middleware.js';

describe('Global Notification Dropdown & Invitation System Tests', { timeout: 60000, concurrency: 1 }, () => {
  let app: express.Express;
  let httpServer: HttpServer;
  let ioServer: SocketIOServer;
  let serverUrl: string;

  const hostUserId = 'host_reg_user_' + Date.now();
  const regRecipientId = 'recipient_reg_user_' + Date.now();
  const roomId = 'room_notif_' + Date.now();

  const hostToken =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    Buffer.from(
      JSON.stringify({
        sub: hostUserId,
        email: 'host@test.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url') +
    '.dummy_sig';

  const regRecipientToken =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    Buffer.from(
      JSON.stringify({
        sub: regRecipientId,
        email: 'recipient@test.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url') +
    '.dummy_sig';

  let hostSocket: ClientSocketType;
  let guestSocket: ClientSocketType;
  let regRecipientSocket: ClientSocketType;
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

  let firstInvitationId: string;
  let secondInvitationId: string;

  before(async () => {
    // 1. Clear memory
    FriendCodeRepository.clearInMemoryRegistry();
    RoomInvitationRepository.clearInMemoryInvitations();

    // 2. Setup Express test app with mock auth header parser
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.includes('Bearer host_token')) {
        req.user = { id: hostUserId, email: 'host@test.com' };
      } else if (authHeader && authHeader.includes('Bearer recipient_token')) {
        req.user = { id: regRecipientId, email: 'recipient@test.com' };
      }
      next();
    });
    app.use('/api/rooms', roomRouter);
    app.use(errorMiddleware);

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
        }
        resolve();
      });
    });

    // 3. Create guest sessions
    guestSession = await FriendCodeRepository.getOrCreateGuestSession();
    intruderSession = await FriendCodeRepository.getOrCreateGuestSession();

    // 4. Initialize room in RoomRepository
    await RoomRepository.createRoom(roomId, hostUserId, '');
  });

  after(async () => {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (guestSocket?.connected) guestSocket.disconnect();
    if (regRecipientSocket?.connected) regRecipientSocket.disconnect();
    if (intruderSocket?.connected) intruderSocket.disconnect();
    await new Promise<void>((resolve) => {
      ioServer?.close(() => {
        httpServer?.close(() => resolve());
      });
    });
  });

  it('1. Registered Host connects with Supabase JWT and registers global notification identity', async () => {
    hostSocket = ClientSocket(serverUrl, {
      auth: { token: hostToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout registering host socket')), 5000);
      hostSocket.on('user:registered', (payload) => {
        if (payload.userId === hostUserId) {
          clearTimeout(timeout);
          resolve();
        }
      });
      hostSocket.emit('user:register', { userId: hostUserId, isAnonymous: false });
    });
    assert.ok(hostSocket.connected, 'Host socket must be connected');
  });

  it('2. Guest connects with session ownership and registers verified guest identity', async () => {
    guestSocket = ClientSocket(serverUrl, {
      auth: { anonymous: true, sessionSecret: guestSession.sessionSecret },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout registering guest socket')), 5000);
      guestSocket.on('user:registered', (payload) => {
        if (payload.userId === guestSession.guestId) {
          clearTimeout(timeout);
          resolve();
        }
      });
      guestSocket.emit('user:register', {
        userId: guestSession.guestId,
        isAnonymous: true,
        sessionSecret: guestSession.sessionSecret,
      });
    });
    assert.ok(guestSocket.connected, 'Guest socket must be connected');
  });

  it('3. Real-time delivery: Host invites Guest to Watch Party -> Guest receives room:invitation:received', async () => {
    const receivedPromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for room:invitation:received')), 5000);
      guestSocket.once('room:invitation:received', (inv) => {
        clearTimeout(timeout);
        resolve(inv);
      });
    });

    const res = await fetch(`${serverUrl}/api/rooms/${roomId}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer host_token',
      },
      body: JSON.stringify({
        targetUserId: guestSession.guestId,
        targetUsername: `Guest_${guestSession.friendCode}`,
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.data.delivered, true);
    firstInvitationId = body.data.invitation.id;

    const receivedPayload = await receivedPromise;
    assert.strictEqual(receivedPayload.id, firstInvitationId);
    assert.strictEqual(receivedPayload.roomId, roomId);
    assert.strictEqual(receivedPayload.status, 'pending');
  });

  it('4. Notification popover retrieval: Guest fetches pending notifications via API', async () => {
    const res = await fetch(`${serverUrl}/api/rooms/invitations/pending`, {
      headers: {
        'x-guest-id': guestSession.guestId,
        'x-guest-secret': guestSession.sessionSecret,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'success');
    assert.ok(Array.isArray(body.data.invitations));
    const found = body.data.invitations.find((i: any) => i.id === firstInvitationId);
    assert.ok(found, 'Pending invitation must appear in guest pending list');
    assert.strictEqual(found.status, 'pending');
  });

  it('5. Dropdown Decline Action: Guest declines invitation -> Host receives real-time decline notification', async () => {
    const hostDeclinePromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for room:invitation:declined')), 5000);
      hostSocket.once('room:invitation:declined', (event) => {
        clearTimeout(timeout);
        resolve(event);
      });
    });

    const res = await fetch(`${serverUrl}/api/rooms/invitations/${firstInvitationId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-guest-id': guestSession.guestId,
        'x-guest-secret': guestSession.sessionSecret,
      },
      body: JSON.stringify({ response: 'decline' }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.data.invitation.status, 'declined');

    const hostReceivedDecline = await hostDeclinePromise;
    assert.strictEqual(hostReceivedDecline.invitationId, firstInvitationId);
    assert.strictEqual(hostReceivedDecline.recipientId, guestSession.guestId);
  });

  it('6. Re-invite support: Host can re-invite guest after decline -> New active invitation created', async () => {
    const res = await fetch(`${serverUrl}/api/rooms/${roomId}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer host_token',
      },
      body: JSON.stringify({
        targetUserId: guestSession.guestId,
        targetUsername: `Guest_${guestSession.friendCode}`,
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    secondInvitationId = body.data.invitation.id;
    assert.notStrictEqual(secondInvitationId, firstInvitationId, 'A fresh invitation ID is issued');
  });

  it('7. Security: Intruder guest cannot accept or decline another guest invitation', async () => {
    const res = await fetch(`${serverUrl}/api/rooms/invitations/${secondInvitationId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-guest-id': intruderSession.guestId,
        'x-guest-secret': intruderSession.sessionSecret,
      },
      body: JSON.stringify({ response: 'accept' }),
    });

    assert.strictEqual(res.status, 403, 'Intruder must be rejected with 403 Forbidden');
  });

  it('8. Dropdown Join Party Action: Target Guest accepts invitation -> Host notified & pre-approval granted', async () => {
    const hostAcceptPromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for room:invitation:accepted')), 5000);
      hostSocket.once('room:invitation:accepted', (event) => {
        clearTimeout(timeout);
        resolve(event);
      });
    });

    const res = await fetch(`${serverUrl}/api/rooms/invitations/${secondInvitationId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-guest-id': guestSession.guestId,
        'x-guest-secret': guestSession.sessionSecret,
      },
      body: JSON.stringify({ response: 'accept' }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.data.invitation.status, 'accepted');

    const hostReceivedAccept = await hostAcceptPromise;
    assert.strictEqual(hostReceivedAccept.invitationId, secondInvitationId);
    assert.strictEqual(hostReceivedAccept.recipientId, guestSession.guestId);

    // Verify pre-approval in repository
    const isApproved = RoomInvitationRepository.isGuestPreApproved(roomId, guestSession.guestId);
    assert.strictEqual(isApproved, true, 'Accepted guest must be pre-approved for room admission');
  });

  it('9. Idempotency & Protection: Responding to already accepted/declined invitation is rejected', async () => {
    const res = await fetch(`${serverUrl}/api/rooms/invitations/${secondInvitationId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-guest-id': guestSession.guestId,
        'x-guest-secret': guestSession.sessionSecret,
      },
      body: JSON.stringify({ response: 'accept' }),
    });

    assert.strictEqual(res.status, 400, 'Re-responding to already settled invitation should return 400');
    const body = await res.json();
    assert.match(body.message, /already/i);
  });

  it('10. Expired invitation protection: Expired invitations cannot be accepted', async () => {
    const expiredInv = await RoomInvitationRepository.createInvitation({
      roomId,
      hostId: hostUserId,
      hostName: 'Host',
      recipientId: guestSession.guestId,
      createdAt: Date.now() - 20 * 60 * 1000, // 20 minutes ago
    });

    const res = await fetch(`${serverUrl}/api/rooms/invitations/${expiredInv.id}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-guest-id': guestSession.guestId,
        'x-guest-secret': guestSession.sessionSecret,
      },
      body: JSON.stringify({ response: 'accept' }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.message, /expired/i);
  });

  it('11. Registered-User recipient: Host invites registered user -> Registered user fetches and accepts', async () => {
    regRecipientSocket = ClientSocket(serverUrl, {
      auth: { token: regRecipientToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout registering reg socket')), 5000);
      regRecipientSocket.on('user:registered', (payload) => {
        if (payload.userId === regRecipientId) {
          clearTimeout(timeout);
          resolve();
        }
      });
      regRecipientSocket.emit('user:register', { userId: regRecipientId, isAnonymous: false });
    });

    const regReceivedPromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for reg recipient invitation')), 5000);
      regRecipientSocket.once('room:invitation:received', (inv) => {
        clearTimeout(timeout);
        resolve(inv);
      });
    });

    const inviteRes = await fetch(`${serverUrl}/api/rooms/${roomId}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer host_token',
      },
      body: JSON.stringify({
        targetUserId: regRecipientId,
        targetUsername: 'recipient_reg',
      }),
    });
    assert.strictEqual(inviteRes.status, 201);
    const inviteBody = await inviteRes.json();
    const regInvId = inviteBody.data.invitation.id;

    const regReceived = await regReceivedPromise;
    assert.strictEqual(regReceived.id, regInvId);

    // Fetch pending
    const pendingRes = await fetch(`${serverUrl}/api/rooms/invitations/pending`, {
      headers: {
        Authorization: 'Bearer recipient_token',
      },
    });
    assert.strictEqual(pendingRes.status, 200);
    const pendingBody = await pendingRes.json();
    const found = pendingBody.data.invitations.find((i: any) => i.id === regInvId);
    assert.ok(found, 'Invitation must appear in registered user pending list');

    // Accept
    const acceptRes = await fetch(`${serverUrl}/api/rooms/invitations/${regInvId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer recipient_token',
      },
      body: JSON.stringify({ response: 'accept' }),
    });
    assert.strictEqual(acceptRes.status, 200);
    assert.strictEqual(RoomInvitationRepository.isGuestPreApproved(roomId, regRecipientId), true);
  });
});
