import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase.js';
import { RoomInvitationRepository } from '../src/repositories/roomInvitation.repository.js';
import { FriendCodeRepository } from '../src/repositories/friendCode.repository.js';
import { RoomRepository } from '../src/repositories/room.repository.js';
import express from 'express';
import { createServer, Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { setupSockets } from '../src/sockets/index.js';
import roomRouter from '../src/routes/room.routes.js';
import { errorMiddleware } from '../src/middleware/error.middleware.js';

describe('Supabase PostgreSQL Database Verification for public.room_invitations', { timeout: 60000, concurrency: 1 }, () => {
  let app: express.Express;
  let httpServer: HttpServer;
  let ioServer: SocketIOServer;
  let serverUrl: string;

  const testPrefix = `dbtest_${Date.now()}`;
  const hostUserId = `host_${testPrefix}`;
  const guestRecipientId = `anon_${testPrefix.slice(0, 16)}`;
  const regRecipientId = `reg_${testPrefix}`;
  const roomId = `room_${testPrefix}`;

  const hostToken =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    Buffer.from(
      JSON.stringify({
        sub: hostUserId,
        email: `${hostUserId}@test.com`,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url') +
    '.dummy_sig';

  let hostSocket: ClientSocketType;
  let guestSocket: ClientSocketType;

  let guestSession: {
    guestId: string;
    friendCode: string;
    sessionSecret: string;
  };

  const createdInvitationIds: string[] = [];

  before(async () => {
    assert.ok(supabase, 'Supabase client must be initialized for live database tests');

    // Express app & Socket server
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.includes('Bearer host_token')) {
        req.user = { id: hostUserId, email: `${hostUserId}@test.com` };
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

    // Create guest session
    guestSession = await FriendCodeRepository.getOrCreateGuestSession();

    // Register room in repository
    await RoomRepository.createRoom(roomId, hostUserId, '');
  });

  after(async () => {
    if (hostSocket?.connected) hostSocket.disconnect();
    if (guestSocket?.connected) guestSocket.disconnect();
    await new Promise<void>((resolve) => {
      ioServer?.close(() => {
        httpServer?.close(() => resolve());
      });
    });

    // Clean up test records from PostgreSQL
    if (supabase && createdInvitationIds.length > 0) {
      await supabase.from('room_invitations').delete().in('id', createdInvitationIds);
    }
  });

  it('1. Confirms public.room_invitations exists in PostgreSQL and returns expected schema columns', async () => {
    assert.ok(supabase);
    const { data, error } = await supabase.from('room_invitations').select('*').limit(1);
    assert.strictEqual(error, null, `Query to public.room_invitations must succeed without error: ${error?.message}`);
    assert.ok(Array.isArray(data), 'Response data must be an array');
  });

  it('2. Verifies constraints: CHECK constraint rejects invalid status, NOT NULL rejects missing required fields', async () => {
    assert.ok(supabase);

    // Test CHECK (status IN ('pending', 'accepted', 'declined', 'expired'))
    const { error: invalidStatusErr } = await supabase.from('room_invitations').insert({
      room_id: roomId,
      host_id: hostUserId,
      host_name: 'Host',
      recipient_id: guestRecipientId,
      status: 'bogus_status_123',
    });
    assert.ok(invalidStatusErr, 'Must reject invalid status');
    assert.match(invalidStatusErr.message, /check constraint/i);

    // Test NOT NULL on room_id
    const { error: nullRoomErr } = await supabase.from('room_invitations').insert({
      room_id: null as any,
      host_id: hostUserId,
      host_name: 'Host',
      recipient_id: guestRecipientId,
      status: 'pending',
    });
    assert.ok(nullRoomErr, 'Must reject null room_id');
    assert.match(nullRoomErr.message, /violates not-null constraint/i);

    // Test NOT NULL on recipient_id
    const { error: nullRecipientErr } = await supabase.from('room_invitations').insert({
      room_id: roomId,
      host_id: hostUserId,
      host_name: 'Host',
      recipient_id: null as any,
      status: 'pending',
    });
    assert.ok(nullRecipientErr, 'Must reject null recipient_id');
    assert.match(nullRecipientErr.message, /violates not-null constraint/i);
  });

  it('3. Persists invitation directly to Supabase PostgreSQL and retrieves row with all columns', async () => {
    assert.ok(supabase);

    const inv = await RoomInvitationRepository.createInvitation({
      roomId,
      hostId: hostUserId,
      hostName: 'TestHostDB',
      hostAvatar: 'https://example.com/host-avatar.webp',
      recipientId: guestSession.guestId,
      recipientUsername: `Guest_${guestSession.friendCode}`,
    });
    createdInvitationIds.push(inv.id);

    // Directly query PostgreSQL to verify physical database persistence
    const { data: dbRow, error } = await supabase
      .from('room_invitations')
      .select('*')
      .eq('id', inv.id)
      .single();

    assert.strictEqual(error, null, `Direct DB query must succeed: ${error?.message}`);
    assert.ok(dbRow, 'Row must exist in PostgreSQL');
    assert.strictEqual(dbRow.id, inv.id);
    assert.strictEqual(dbRow.room_id, roomId);
    assert.strictEqual(dbRow.host_id, hostUserId);
    assert.strictEqual(dbRow.host_name, 'TestHostDB');
    assert.strictEqual(dbRow.host_avatar, 'https://example.com/host-avatar.webp');
    assert.strictEqual(dbRow.recipient_id, guestSession.guestId);
    assert.strictEqual(dbRow.status, 'pending');
    assert.ok(dbRow.created_at, 'created_at must be populated');
    assert.ok(dbRow.updated_at, 'updated_at must be populated');
  });

  it('4. In-Memory Wipe & PostgreSQL Recovery: Pending invitations survive server restart / cache clear', async () => {
    assert.ok(supabase);

    // 1. Wipe in-memory invitations map completely
    RoomInvitationRepository.clearInMemoryInvitations();

    // 2. Fetch pending invitations for guest from repository
    const recovered = await RoomInvitationRepository.getPendingInvitationsForUser(guestSession.guestId);
    assert.ok(Array.isArray(recovered), 'Must return an array');

    const target = recovered.find((i) => createdInvitationIds.includes(i.id));
    assert.ok(target, 'Pending invitation must be recovered from PostgreSQL database after in-memory wipe');
    assert.strictEqual(target.status, 'pending');
    assert.strictEqual(target.roomId, roomId);
    assert.strictEqual(target.hostName, 'TestHostDB');

    // 3. Fetch specific invitation by ID after in-memory wipe
    RoomInvitationRepository.clearInMemoryInvitations();
    const fetchedById = await RoomInvitationRepository.getInvitationById(target.id);
    assert.ok(fetchedById, 'getInvitationById must recover record from PostgreSQL');
    assert.strictEqual(fetchedById.id, target.id);
    assert.strictEqual(fetchedById.recipientId, guestSession.guestId);
  });

  it('5. Database Status Mutation (Decline): Updates PostgreSQL record status and updated_at timestamp', async () => {
    assert.ok(supabase);
    const invId = createdInvitationIds[0];

    const result = await RoomInvitationRepository.respondToInvitation(invId, guestSession.guestId, 'decline');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.invitation.status, 'declined');

    // Verify directly in PostgreSQL
    const { data: dbRow, error } = await supabase
      .from('room_invitations')
      .select('status, updated_at, created_at')
      .eq('id', invId)
      .single();

    assert.strictEqual(error, null);
    assert.strictEqual(dbRow.status, 'declined', 'PostgreSQL status must be updated to declined');
  });

  it('6. Re-invite & Acceptance: Database status mutates to accepted, sets pre-approval in repository', async () => {
    assert.ok(supabase);

    // Create fresh invitation
    const freshInv = await RoomInvitationRepository.createInvitation({
      roomId,
      hostId: hostUserId,
      hostName: 'TestHostDB',
      recipientId: guestSession.guestId,
    });
    createdInvitationIds.push(freshInv.id);

    // Accept invitation
    const result = await RoomInvitationRepository.respondToInvitation(freshInv.id, guestSession.guestId, 'accept');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.invitation.status, 'accepted');

    // Verify PostgreSQL has status = accepted
    const { data: dbRow, error } = await supabase
      .from('room_invitations')
      .select('status')
      .eq('id', freshInv.id)
      .single();

    assert.strictEqual(error, null);
    assert.strictEqual(dbRow.status, 'accepted');

    // Verify pre-approval
    assert.strictEqual(
      RoomInvitationRepository.isGuestPreApproved(roomId, guestSession.guestId),
      true,
      'Recipient must be pre-approved for room admission'
    );
  });

  it('7. Duplicate response protection: Responding to already accepted invitation is rejected', async () => {
    const invId = createdInvitationIds[createdInvitationIds.length - 1];

    await assert.rejects(
      async () => {
        await RoomInvitationRepository.respondToInvitation(invId, guestSession.guestId, 'accept');
      },
      (err: any) => {
        assert.match(err.message, /already.*accepted/i);
        return true;
      }
    );
  });

  it('8. Expiration Protection: Invitation older than 15 minutes is rejected and marked expired in PostgreSQL', async () => {
    assert.ok(supabase);

    // Create expired invitation (20 minutes ago)
    const expiredInv = await RoomInvitationRepository.createInvitation({
      roomId,
      hostId: hostUserId,
      hostName: 'TestHostDB',
      recipientId: guestSession.guestId,
      createdAt: Date.now() - 20 * 60 * 1000,
    });
    createdInvitationIds.push(expiredInv.id);

    // Attempt to accept
    await assert.rejects(
      async () => {
        await RoomInvitationRepository.respondToInvitation(expiredInv.id, guestSession.guestId, 'accept');
      },
      (err: any) => {
        assert.match(err.message, /expired/i);
        return true;
      }
    );

    // Wipe memory and verify status in PostgreSQL is expired or not pending
    RoomInvitationRepository.clearInMemoryInvitations();
    const pendingList = await RoomInvitationRepository.getPendingInvitationsForUser(guestSession.guestId);
    const foundInPending = pendingList.find((i) => i.id === expiredInv.id);
    assert.strictEqual(foundInPending, undefined, 'Expired invitation must not appear in pending list');
  });

  it('9. Security & Guest Ownership: Intruder guest is rejected from responding to another user invitation', async () => {
    const freshInv = await RoomInvitationRepository.createInvitation({
      roomId,
      hostId: hostUserId,
      hostName: 'TestHostDB',
      recipientId: guestSession.guestId,
    });
    createdInvitationIds.push(freshInv.id);

    const intruderSession = await FriendCodeRepository.getOrCreateGuestSession();

    await assert.rejects(
      async () => {
        await RoomInvitationRepository.respondToInvitation(freshInv.id, intruderSession.guestId, 'accept');
      },
      (err: any) => {
        assert.match(err.message, /not addressed to you/i);
        return true;
      }
    );

    // Verify status in DB remains pending
    const { data: dbRow } = await supabase
      .from('room_invitations')
      .select('status')
      .eq('id', freshInv.id)
      .single();

    assert.strictEqual(dbRow?.status, 'pending', 'DB status must remain pending after unauthorized attempt');
  });

  it('10. Registered user invitation creation & PostgreSQL retrieval', async () => {
    assert.ok(supabase);

    const regInv = await RoomInvitationRepository.createInvitation({
      roomId,
      hostId: hostUserId,
      hostName: 'TestHostDB',
      recipientId: regRecipientId,
      recipientUsername: 'RegRecipientUser',
    });
    createdInvitationIds.push(regInv.id);

    // Wipe memory to prove DB query
    RoomInvitationRepository.clearInMemoryInvitations();

    const pending = await RoomInvitationRepository.getPendingInvitationsForUser(regRecipientId);
    const found = pending.find((i) => i.id === regInv.id);
    assert.ok(found, 'Registered user pending invitation must be recovered from PostgreSQL');
    assert.strictEqual(found.recipientId, regRecipientId);
    assert.strictEqual(found.status, 'pending');

    // Accept via registered user
    const res = await RoomInvitationRepository.respondToInvitation(regInv.id, regRecipientId, 'accept');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.invitation.status, 'accepted');
  });

  it('11. Real-time delivery with live PostgreSQL persistence and sender updates', async () => {
    // 1. Connect Host Socket
    hostSocket = ClientSocket(serverUrl, {
      auth: { token: hostToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Host socket registration timeout')), 5000);
      hostSocket.on('user:registered', (payload) => {
        if (payload.userId === hostUserId) {
          clearTimeout(timeout);
          resolve();
        }
      });
      hostSocket.emit('user:register', { userId: hostUserId, isAnonymous: false });
    });

    // 2. Connect Guest Socket
    guestSocket = ClientSocket(serverUrl, {
      auth: { anonymous: true, sessionSecret: guestSession.sessionSecret },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Guest socket registration timeout')), 5000);
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

    // 3. Setup real-time listener on Guest
    const guestReceivedPromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Guest invite receive timeout')), 5000);
      guestSocket.once('room:invitation:received', (inv) => {
        clearTimeout(timeout);
        resolve(inv);
      });
    });

    // 4. Host sends invitation via HTTP API
    const inviteRes = await fetch(`${serverUrl}/api/rooms/${roomId}/invite`, {
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

    assert.strictEqual(inviteRes.status, 201);
    const inviteBody = await inviteRes.json();
    const liveInvId = inviteBody.data.invitation.id;
    createdInvitationIds.push(liveInvId);

    const receivedPayload = await guestReceivedPromise;
    assert.strictEqual(receivedPayload.id, liveInvId);

    // 5. Setup acceptance listener on Host
    const hostAcceptPromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Host accept receive timeout')), 5000);
      hostSocket.once('room:invitation:accepted', (event) => {
        clearTimeout(timeout);
        resolve(event);
      });
    });

    // 6. Guest accepts via HTTP API
    const respondRes = await fetch(`${serverUrl}/api/rooms/invitations/${liveInvId}/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-guest-id': guestSession.guestId,
        'x-guest-secret': guestSession.sessionSecret,
      },
      body: JSON.stringify({ response: 'accept' }),
    });

    assert.strictEqual(respondRes.status, 200);

    const hostReceivedAccept = await hostAcceptPromise;
    assert.strictEqual(hostReceivedAccept.invitationId, liveInvId);
    assert.strictEqual(hostReceivedAccept.recipientId, guestSession.guestId);

    // 7. Verify persistent status in PostgreSQL
    const { data: finalDbRow } = await supabase
      .from('room_invitations')
      .select('status')
      .eq('id', liveInvId)
      .single();

    assert.strictEqual(finalDbRow?.status, 'accepted');
  });
});
