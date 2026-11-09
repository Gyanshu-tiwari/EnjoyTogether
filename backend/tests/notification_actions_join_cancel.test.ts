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

describe('Notification Actions: Join Party & Cancel E2E Test Suite', { timeout: 60000, concurrency: 1 }, () => {
  let app: express.Express;
  let httpServer: HttpServer;
  let ioServer: SocketIOServer;
  let serverUrl: string;

  const hostUserId = 'host_actions_' + Date.now();
  const regGuestUserId = 'reg_guest_' + Date.now();
  const otherUserId = 'other_user_' + Date.now();
  const roomId = 'room_actions_' + Date.now();

  const hostToken =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    Buffer.from(
      JSON.stringify({
        sub: hostUserId,
        email: 'host@test.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url') +
    '.sig';

  const regGuestToken =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    Buffer.from(
      JSON.stringify({
        sub: regGuestUserId,
        email: 'regguest@test.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url') +
    '.sig';

  const otherUserToken =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    Buffer.from(
      JSON.stringify({
        sub: otherUserId,
        email: 'other@test.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url') +
    '.sig';

  let hostSocket: ClientSocketType;
  let regGuestSocket: ClientSocketType;
  let anonGuestSocket: ClientSocketType;

  let anonGuestSession: {
    guestId: string;
    friendCode: string;
    sessionSecret: string;
  };

  before(async () => {
    // Reset registries
    FriendCodeRepository.clearInMemoryRegistry();
    RoomInvitationRepository.clearInMemoryInvitations();

    // Create Express app
    app = express();
    app.use(express.json());
    // Attach auth mock for authorization header
    app.use((req, _res, next) => {
      const authHeader = req.headers.authorization;
      if (authHeader?.includes(hostToken)) {
        req.user = { id: hostUserId, email: 'host@test.com' };
      } else if (authHeader?.includes(regGuestToken)) {
        req.user = { id: regGuestUserId, email: 'regguest@test.com' };
      } else if (authHeader?.includes(otherUserToken)) {
        req.user = { id: otherUserId, email: 'other@test.com' };
      }
      next();
    });

    app.use('/api/rooms', roomRouter);
    app.use(errorMiddleware);

    httpServer = createServer(app);
    ioServer = new SocketIOServer(httpServer, { cors: { origin: '*' } });
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

    // Create anonymous guest session with valid secret
    anonGuestSession = await FriendCodeRepository.getOrCreateGuestSession();

    // Initialize room in RoomRepository
    await RoomRepository.createRoom(roomId, hostUserId, '');

    // Connect host socket
    hostSocket = ClientSocket(serverUrl, {
      auth: { token: hostToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout host registration')), 5000);
      hostSocket.on('user:registered', (payload) => {
        if (payload.userId === hostUserId) {
          clearTimeout(t);
          resolve();
        }
      });
      hostSocket.emit('user:register', { userId: hostUserId, isAnonymous: false });
    });

    // Host creates room and joins
    hostSocket.emit('room:join', { roomId, userId: hostUserId });

    // Connect registered guest socket
    regGuestSocket = ClientSocket(serverUrl, {
      auth: { token: regGuestToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout reg guest registration')), 5000);
      regGuestSocket.on('user:registered', (payload) => {
        if (payload.userId === regGuestUserId) {
          clearTimeout(t);
          resolve();
        }
      });
      regGuestSocket.emit('user:register', { userId: regGuestUserId, isAnonymous: false });
    });

    // Connect anonymous guest socket
    anonGuestSocket = ClientSocket(serverUrl, {
      auth: {
        sessionSecret: anonGuestSession.sessionSecret,
        guestId: anonGuestSession.guestId,
        anonymous: true,
      },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout anon guest registration')), 5000);
      anonGuestSocket.on('user:registered', (payload) => {
        if (payload.userId === anonGuestSession.guestId) {
          clearTimeout(t);
          resolve();
        }
      });
      anonGuestSocket.emit('user:register', {
        userId: anonGuestSession.guestId,
        sessionSecret: anonGuestSession.sessionSecret,
        isAnonymous: true,
      });
    });
  });

  after(() => {
    hostSocket?.disconnect();
    regGuestSocket?.disconnect();
    anonGuestSocket?.disconnect();
    ioServer?.close();
    httpServer?.close();
  });

  // ── Test 1 & 4 & 11: Registered guest recipient accepts invitation & joins without knock ──
  it('1, 4 & 11. Registered guest recipient accepts invitation, host receives acceptance event, and guest joins as VIEWER without knocking', async () => {
    // 1. Host invites registered guest
    const inviteRes = await fetch(`${serverUrl}/api/rooms/${roomId}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        targetUserId: regGuestUserId,
        targetUsername: 'RegGuest',
      }),
    });
    assert.strictEqual(inviteRes.status, 201);
    const inviteBody = await inviteRes.json();
    const invitationId = inviteBody.data.invitation.id;

    // 2. Set up listener on Host for real-time acceptance event
    const hostAcceptPromise = new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout waiting for host acceptance event')), 5000);
      hostSocket.once('room:invitation:accepted', (data) => {
        clearTimeout(t);
        resolve(data);
      });
    });

    // 3. Registered recipient accepts invitation via POST /respond
    const respondRes = await fetch(`${serverUrl}/api/rooms/invitations/${invitationId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${regGuestToken}`,
      },
      body: JSON.stringify({ response: 'accept' }),
    });

    assert.strictEqual(respondRes.status, 200, 'Acceptance must return 200 OK');
    const respondBody = await respondRes.json();
    assert.strictEqual(respondBody.status, 'success');
    assert.strictEqual(respondBody.data.invitation.status, 'accepted');
    assert.strictEqual(respondBody.data.invitation.roomId, roomId);

    // 4. Verify Host received real-time acceptance event
    const hostEvent = await hostAcceptPromise;
    assert.strictEqual(hostEvent.invitationId, invitationId);
    assert.strictEqual(hostEvent.roomId, roomId);
    assert.strictEqual(hostEvent.recipientId, regGuestUserId);

    // 5. Verify room pre-approval is active
    assert.strictEqual(
      RoomInvitationRepository.isGuestPreApproved(roomId, regGuestUserId),
      true,
      'Registered recipient must be pre-approved'
    );

    // 6. Registered recipient joins room -> must receive room:entry-approved without knocking
    const entryApprovedPromise = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout waiting for room:entry-approved')), 5000);
      regGuestSocket.once('room:entry-approved', () => {
        clearTimeout(t);
        resolve();
      });
    });

    const activeUsersPromise = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout waiting for room:active-users')), 5000);
      hostSocket.once('room:active-users', (users: any[]) => {
        const found = users.find((u) => u.userId === regGuestUserId);
        if (found) {
          assert.strictEqual(found.isHost, false, 'Recipient must not be host');
          assert.strictEqual(found.role, 'viewer', 'Recipient must join with VIEWER role');
          clearTimeout(t);
          resolve();
        }
      });
    });

    regGuestSocket.emit('room:join', { roomId, userId: regGuestUserId });
    await Promise.all([entryApprovedPromise, activeUsersPromise]);
  });

  // ── Test 2: Guest recipient accepts invitation and joins the room ──
  it('2. Guest recipient accepts invitation using guest secret and joins room as VIEWER', async () => {
    // Host invites anonymous guest
    const inviteRes = await fetch(`${serverUrl}/api/rooms/${roomId}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        targetUserId: anonGuestSession.guestId,
        targetUsername: 'AnonGuest',
      }),
    });
    assert.strictEqual(inviteRes.status, 201);
    const inviteBody = await inviteRes.json();
    const invitationId = inviteBody.data.invitation.id;

    // Guest accepts with valid x-guest-id and x-guest-secret
    const respondRes = await fetch(`${serverUrl}/api/rooms/invitations/${invitationId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-guest-id': anonGuestSession.guestId,
        'x-guest-secret': anonGuestSession.sessionSecret,
      },
      body: JSON.stringify({ response: 'accept' }),
    });

    assert.strictEqual(respondRes.status, 200);
    const body = await respondRes.json();
    assert.strictEqual(body.data.invitation.status, 'accepted');

    assert.strictEqual(
      RoomInvitationRepository.isGuestPreApproved(roomId, anonGuestSession.guestId),
      true,
      'Guest recipient must be pre-approved'
    );

    // Guest joins room -> receives room:entry-approved
    const entryApprovedPromise = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout waiting for anon room:entry-approved')), 5000);
      anonGuestSocket.once('room:entry-approved', () => {
        clearTimeout(t);
        resolve();
      });
    });

    anonGuestSocket.emit('room:join', {
      roomId,
      userId: anonGuestSession.guestId,
      sessionSecret: anonGuestSession.sessionSecret,
    });

    await entryApprovedPromise;
  });

  // ── Test 3 & 5 & 12: Recipient declines invitation (Cancel action) -> Host notified, declined invitation cannot be joined ──
  it('3, 5 & 12. Recipient declines invitation (Cancel action): Host receives decline event and guest is NOT pre-approved', async () => {
    // Create new room and invitation for decline test
    const declineRoomId = 'room_decline_' + Date.now();
    await RoomRepository.createRoom(declineRoomId, hostUserId, '');
    hostSocket.emit('room:join', { roomId: declineRoomId, userId: hostUserId });

    const inviteRes = await fetch(`${serverUrl}/api/rooms/${declineRoomId}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        targetUserId: anonGuestSession.guestId,
        targetUsername: 'AnonGuest',
      }),
    });
    assert.strictEqual(inviteRes.status, 201);
    const inviteBody = await inviteRes.json();
    const invitationId = inviteBody.data.invitation.id;

    // Setup listener for host decline event
    const hostDeclinePromise = new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timeout waiting for host decline event')), 5000);
      hostSocket.once('room:invitation:declined', (data) => {
        clearTimeout(t);
        resolve(data);
      });
    });

    // Guest declines invitation (Cancel button clicked)
    const declineRes = await fetch(`${serverUrl}/api/rooms/invitations/${invitationId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-guest-id': anonGuestSession.guestId,
        'x-guest-secret': anonGuestSession.sessionSecret,
      },
      body: JSON.stringify({ response: 'decline' }),
    });

    assert.strictEqual(declineRes.status, 200, 'Decline must return 200 OK');
    const declineBody = await declineRes.json();
    assert.strictEqual(declineBody.status, 'success');
    assert.strictEqual(declineBody.data.invitation.status, 'declined');

    // Host receives room:invitation:declined
    const declineEvent = await hostDeclinePromise;
    assert.strictEqual(declineEvent.invitationId, invitationId);
    assert.strictEqual(declineEvent.roomId, declineRoomId);
    assert.strictEqual(declineEvent.recipientId, anonGuestSession.guestId);

    // Verify guest is NOT pre-approved
    const isApproved = RoomInvitationRepository.isGuestPreApproved(declineRoomId, anonGuestSession.guestId);
    assert.strictEqual(isApproved, false, 'Declined guest must NOT be pre-approved');

    // Verify database record has updated status
    const inv = await RoomInvitationRepository.getInvitationById(invitationId);
    assert.strictEqual(inv?.status, 'declined');
  });

  // ── Test 6: Invalid guest secret is rejected ──
  it('6. Invalid guest secret is rejected with 401 Unauthorized', async () => {
    const inviteRes = await fetch(`${serverUrl}/api/rooms/${roomId}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        targetUserId: anonGuestSession.guestId,
        targetUsername: 'AnonGuest',
      }),
    });
    assert.strictEqual(inviteRes.status, 201);
    const { data: { invitation } } = await inviteRes.json();

    const badSecretRes = await fetch(`${serverUrl}/api/rooms/invitations/${invitation.id}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-guest-id': anonGuestSession.guestId,
        'x-guest-secret': 'invalid_secret_forgery_attempt',
      },
      body: JSON.stringify({ response: 'accept' }),
    });

    assert.strictEqual(badSecretRes.status, 401, 'Invalid guest secret must return 401');
    const body = await badSecretRes.json();
    assert.match(body.message, /invalid guest session secret/i);
  });

  // ── Test 7: Non-recipient cannot respond ──
  it('7. Non-recipient cannot respond (rejected with 403 Forbidden)', async () => {
    const inviteRes = await fetch(`${serverUrl}/api/rooms/${roomId}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        targetUserId: regGuestUserId,
        targetUsername: 'RegGuest',
      }),
    });
    assert.strictEqual(inviteRes.status, 201);
    const { data: { invitation } } = await inviteRes.json();

    // otherUserId tries to respond
    const intruderRes = await fetch(`${serverUrl}/api/rooms/invitations/${invitation.id}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${otherUserToken}`,
      },
      body: JSON.stringify({ response: 'accept' }),
    });

    assert.strictEqual(intruderRes.status, 403, 'Intruder must be rejected with 403');
    const body = await intruderRes.json();
    assert.match(body.message, /not addressed to you/i);
  });

  // ── Test 8: Expired invitation cannot be accepted ──
  it('8. Expired invitation cannot be accepted (rejected with 400 Bad Request)', async () => {
    const expiredInv = await RoomInvitationRepository.createInvitation({
      roomId,
      hostId: hostUserId,
      hostName: 'Host',
      recipientId: regGuestUserId,
      createdAt: Date.now() - 25 * 60 * 1000, // 25 minutes ago (> 15 min TTL)
    });

    const res = await fetch(`${serverUrl}/api/rooms/invitations/${expiredInv.id}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${regGuestToken}`,
      },
      body: JSON.stringify({ response: 'accept' }),
    });

    assert.strictEqual(res.status, 400, 'Expired invitation must return 400');
    const body = await res.json();
    assert.match(body.message, /expired/i);
  });

  // ── Test 9: Duplicate clicks do not create duplicate responses ──
  it('9. Duplicate clicks do not create duplicate responses (subsequent response rejected)', async () => {
    const inviteRes = await fetch(`${serverUrl}/api/rooms/${roomId}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        targetUserId: regGuestUserId,
        targetUsername: 'RegGuest',
      }),
    });
    assert.strictEqual(inviteRes.status, 201);
    const { data: { invitation } } = await inviteRes.json();

    // First click: accept
    const firstRes = await fetch(`${serverUrl}/api/rooms/invitations/${invitation.id}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${regGuestToken}`,
      },
      body: JSON.stringify({ response: 'accept' }),
    });
    assert.strictEqual(firstRes.status, 200);

    // Second click: duplicate response
    const secondRes = await fetch(`${serverUrl}/api/rooms/invitations/${invitation.id}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${regGuestToken}`,
      },
      body: JSON.stringify({ response: 'accept' }),
    });
    assert.strictEqual(secondRes.status, 400, 'Duplicate response must return 400');
    const body = await secondRes.json();
    assert.match(body.message, /already been accepted/i);
  });

  // ── Test 10: API failure preserves invitation and allows retry ──
  it('10. API failure preserves invitation and allows retry', async () => {
    const inviteRes = await fetch(`${serverUrl}/api/rooms/${roomId}/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        targetUserId: anonGuestSession.guestId,
        targetUsername: 'AnonGuest',
      }),
    });
    assert.strictEqual(inviteRes.status, 201);
    const { data: { invitation } } = await inviteRes.json();

    // Simulate transient failure: client sent bad payload (e.g. invalid response action)
    const failRes = await fetch(`${serverUrl}/api/rooms/invitations/${invitation.id}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-guest-id': anonGuestSession.guestId,
        'x-guest-secret': anonGuestSession.sessionSecret,
      },
      body: JSON.stringify({ response: 'invalid_action' }),
    });
    assert.strictEqual(failRes.status, 400);

    // Verify invitation is still pending in repository
    const invAfterFail = await RoomInvitationRepository.getInvitationById(invitation.id);
    assert.strictEqual(invAfterFail?.status, 'pending', 'Failed request must preserve pending status');

    // Retry with valid action succeeds
    const retryRes = await fetch(`${serverUrl}/api/rooms/invitations/${invitation.id}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-guest-id': anonGuestSession.guestId,
        'x-guest-secret': anonGuestSession.sessionSecret,
      },
      body: JSON.stringify({ response: 'accept' }),
    });
    assert.strictEqual(retryRes.status, 200, 'Retry must succeed');
    const retryBody = await retryRes.json();
    assert.strictEqual(retryBody.data.invitation.status, 'accepted');
  });
});
