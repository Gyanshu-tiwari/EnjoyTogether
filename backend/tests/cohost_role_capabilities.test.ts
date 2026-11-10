import test, { describe, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { Server } from 'socket.io';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import express from 'express';
import { setupSockets } from '../src/sockets/index.js';
import { RoomRepository } from '../src/repositories/room.repository.js';

describe('Co-Host Role Promotion & Playback Control Capabilities', () => {
  let server: http.Server;
  let ioServer: Server;
  let serverPort: number;
  let hostSocket: ClientSocket;
  let coHostSocket: ClientSocket;
  let viewer3Socket: ClientSocket;

  const testRoomId = `cohost-room-${Date.now()}`;
  const hostUserId = `anon_host_${Date.now()}`;
  const guestUserId = `guest_${Date.now()}`;
  const viewer3UserId = `anon_viewer3_${Date.now()}`;

  before(async () => {
    const app = express();
    server = http.createServer(app);
    ioServer = new Server(server, { cors: { origin: '*' } });
    setupSockets(ioServer);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        serverPort = typeof addr === 'object' && addr ? addr.port : 5000;
        resolve();
      });
    });

    await RoomRepository.createRoom(testRoomId, hostUserId, '');
  });

  after(async () => {
    hostSocket?.disconnect();
    coHostSocket?.disconnect();
    viewer3Socket?.disconnect();
    ioServer?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('1. Host and Guest join room; Guest initially has viewer role', async () => {
    const serverUrl = `http://localhost:${serverPort}`;

    hostSocket = Client(serverUrl, { transports: ['websocket'] });
    coHostSocket = Client(serverUrl, { transports: ['websocket'] });

    await Promise.all([
      new Promise<void>((resolve) => hostSocket.on('connect', resolve)),
      new Promise<void>((resolve) => coHostSocket.on('connect', resolve)),
    ]);

    // Host joins
    hostSocket.emit('room:join', { roomId: testRoomId, userId: hostUserId });
    // Guest joins
    coHostSocket.emit('room:join', { roomId: testRoomId, userId: guestUserId });

    // Wait for join acknowledgement
    await new Promise((r) => setTimeout(r, 100));

    const guestInitialRole = await RoomRepository.getUserRoomRole(testRoomId, guestUserId);
    assert.strictEqual(guestInitialRole, 'viewer', 'Initial guest role should be viewer');
  });

  test('2. Viewer attempting playback control before promotion is rejected by RBAC', async () => {
    let errorReceived: any = null;
    coHostSocket.once('error_notification', (err) => {
      errorReceived = err;
    });

    coHostSocket.emit('video:play', { roomId: testRoomId, position: 10 });
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(errorReceived, 'Viewer should receive error notification');
    assert.strictEqual(errorReceived.code, 'VIEWER_RESTRICTED');
  });

  test('3. Host promotes Guest to Co-Host; Co-Host receives role update', async () => {
    let myRoleReceived: string | null = null;
    let roomRoleEvent: any = null;

    coHostSocket.once('room:my-role-changed', (data) => {
      myRoleReceived = data.role;
    });

    hostSocket.once('room:role-changed', (data) => {
      roomRoleEvent = data;
    });

    hostSocket.emit('room:change-role', { targetUserId: guestUserId, newRole: 'co-host' });

    await new Promise((r) => setTimeout(r, 150));

    assert.strictEqual(myRoleReceived, 'co-host', 'Co-Host socket must receive room:my-role-changed');
    assert.ok(roomRoleEvent, 'Room broadcast room:role-changed must fire');
    assert.strictEqual(roomRoleEvent.userId, guestUserId);
    assert.strictEqual(roomRoleEvent.role, 'co-host');

    const updatedRoleInDb = await RoomRepository.getUserRoomRole(testRoomId, guestUserId);
    assert.strictEqual(updatedRoleInDb, 'co-host', 'RoomRepository must store co-host role');
  });

  test('4. Co-Host can successfully perform play, pause, and seek', async () => {
    let hostReceivedPlayState: any = null;
    let hostReceivedPauseState: any = null;
    let hostReceivedSeekState: any = null;

    // Co-host sends video:play
    hostSocket.once('sync-state', (state) => {
      hostReceivedPlayState = state;
    });
    coHostSocket.emit('video:play', { roomId: testRoomId, position: 25.5 });
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(hostReceivedPlayState, 'Host must receive sync-state on co-host play');
    assert.strictEqual(hostReceivedPlayState.isPlaying, true);
    assert.strictEqual(hostReceivedPlayState.position, 25.5);

    // Co-host sends video:seek
    hostSocket.once('sync-state', (state) => {
      hostReceivedSeekState = state;
    });
    coHostSocket.emit('video:seek', { roomId: testRoomId, position: 120 });
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(hostReceivedSeekState, 'Host must receive sync-state on co-host seek');
    assert.strictEqual(hostReceivedSeekState.position, 120);
    assert.strictEqual(hostReceivedSeekState.isSeek, true);

    // Co-host sends video:pause
    hostSocket.once('sync-state', (state) => {
      hostReceivedPauseState = state;
    });
    coHostSocket.emit('video:pause', { roomId: testRoomId, position: 120 });
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(hostReceivedPauseState, 'Host must receive sync-state on co-host pause');
    assert.strictEqual(hostReceivedPauseState.isPlaying, false);
    assert.strictEqual(hostReceivedPauseState.position, 120);
  });

  test('5. Co-Host can approve a knocking guest (moderation capability)', async () => {
    const serverUrl = `http://localhost:${serverPort}`;
    viewer3Socket = Client(serverUrl, { transports: ['websocket'] });
    await new Promise<void>((resolve) => viewer3Socket.on('connect', resolve));

    let knockAlertReceived: any = null;
    coHostSocket.once('room:knock-alert', (alert) => {
      knockAlertReceived = alert;
    });

    viewer3Socket.emit('room:knock', { roomId: testRoomId, username: 'TestViewer3' });
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(knockAlertReceived, 'Co-host must receive knock-alert');
    assert.strictEqual(knockAlertReceived.socketId, viewer3Socket.id);

    // Co-host approves entry
    let approvedFired = false;
    viewer3Socket.once('room:entry-approved', () => {
      approvedFired = true;
    });

    coHostSocket.emit('room:approve-entry', { guestSocketId: viewer3Socket.id });
    await new Promise((r) => setTimeout(r, 100));

    assert.strictEqual(approvedFired, true, 'Knocking guest must be approved by co-host');
  });

  test('6. Co-Host can kick a viewer (moderation capability)', async () => {
    viewer3Socket.emit('room:join', { roomId: testRoomId, userId: viewer3UserId });
    await new Promise((r) => setTimeout(r, 100));

    let kickedFired = false;
    viewer3Socket.once('room:kicked', () => {
      kickedFired = true;
    });

    coHostSocket.emit('room:kick-user', { targetUserId: viewer3UserId });
    await new Promise((r) => setTimeout(r, 100));

    assert.strictEqual(kickedFired, true, 'Viewer must be kicked by co-host');
  });

  test('7. Security: Co-Host cannot promote or demote other users (host-only privilege)', async () => {
    let errorFired: any = null;
    coHostSocket.once('error', (err) => {
      errorFired = err;
    });

    coHostSocket.emit('room:change-role', { targetUserId: viewer3UserId, newRole: 'co-host' });
    await new Promise((r) => setTimeout(r, 100));

    assert.strictEqual(errorFired, 'Unauthorized: only host can change roles.');
  });
});
