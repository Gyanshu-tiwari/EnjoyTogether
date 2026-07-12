import type { Socket, Server } from 'socket.io';
import { RoomRepository } from '../repositories/room.repository.js';
import { SOCKET_EVENTS } from '../constants/socketEvents.js';

// ─── RBAC helper ──────────────────────────────────────────────────────────
async function assertCanControl(socket: Socket, roomId: string): Promise<boolean> {
  const userId = (socket as any).userId || (socket as any).user?.id;
  if (!userId) {
    socket.emit('error_notification', { message: 'Unauthorized: authentication required.' });
    return false;
  }
  const role = await RoomRepository.getUserRoomRole(roomId, userId);
  if (role === 'viewer') {
    console.warn(`⚠️ RBAC: viewer ${userId} attempted media control in room ${roomId} — blocked.`);
    socket.emit('error_notification', {
      message: 'Unauthorized: viewers cannot control media playback.',
      code: 'VIEWER_RESTRICTED',
    });
    return false;
  }
  return true;
}

export const registerVideoHandlers = (io: Server, socket: Socket) => {
  // ── Play ────────────────────────────────────────────────────────────────
  socket.on('video:play', async (data: { roomId: string; position: number }) => {
    const { roomId, position } = data;
    const cleanRoomId = String(roomId).trim();

    try {
      if (!(await assertCanControl(socket, cleanRoomId))) return;

      console.log(`🎬 video:play — room ${cleanRoomId} at ${position}s`);
      const updated = await RoomRepository.updateRoomState(cleanRoomId, { isPlaying: true, position });
      // Broadcast to all other room members (not the sender)
      socket.to(cleanRoomId).emit('sync-state', { ...updated, serverTimestamp: Date.now() });
    } catch (err) {
      console.error('Error in video:play:', err);
      socket.emit('error_notification', { message: 'Internal server error during play.' });
    }
  });

  // ── Pause ───────────────────────────────────────────────────────────────
  socket.on('video:pause', async (data: { roomId: string; position: number }) => {
    const { roomId, position } = data;
    const cleanRoomId = String(roomId).trim();

    try {
      if (!(await assertCanControl(socket, cleanRoomId))) return;

      console.log(`🎬 video:pause — room ${cleanRoomId} at ${position}s`);
      const updated = await RoomRepository.updateRoomState(cleanRoomId, { isPlaying: false, position });
      socket.to(cleanRoomId).emit('sync-state', { ...updated, serverTimestamp: Date.now() });
    } catch (err) {
      console.error('Error in video:pause:', err);
      socket.emit('error_notification', { message: 'Internal server error during pause.' });
    }
  });

  // ── Seek ────────────────────────────────────────────────────────────────
  socket.on('video:seek', async (data: { roomId: string; position: number }) => {
    const { roomId, position } = data;
    const cleanRoomId = String(roomId).trim();

    try {
      if (!(await assertCanControl(socket, cleanRoomId))) return;

      console.log(`🎬 video:seek — room ${cleanRoomId} to ${position}s`);
      const updated = await RoomRepository.updateRoomState(cleanRoomId, { position });
      socket.to(cleanRoomId).emit('sync-state', { ...updated, serverTimestamp: Date.now() });
    } catch (err) {
      console.error('Error in video:seek:', err);
      socket.emit('error_notification', { message: 'Internal server error during seek.' });
    }
  });

  // ── Legacy media-action (backwards compat) ──────────────────────────────
  socket.on(
    SOCKET_EVENTS.MEDIA_ACTION,
    async (data: { roomId: string; isPlaying: boolean; position: number }) => {
      const { roomId, isPlaying, position } = data;
      const cleanRoomId = String(roomId).trim();

      try {
        if (!(await assertCanControl(socket, cleanRoomId))) return;
        const updatedState = await RoomRepository.updateRoomState(cleanRoomId, { isPlaying, position });
        socket.to(cleanRoomId).emit('sync-state', { ...updatedState, serverTimestamp: Date.now() });
      } catch (err) {
        console.error('Error in legacy media-action:', err);
      }
    }
  );

  // ── Legacy change-video-src (backwards compat) ──────────────────────────
  socket.on(
    SOCKET_EVENTS.CHANGE_VIDEO_SRC,
    async (data: { roomId: string; streamUrl: string }) => {
      const { roomId, streamUrl } = data;
      const cleanRoomId = String(roomId).trim();

      try {
        if (!(await assertCanControl(socket, cleanRoomId))) return;
        console.log(`🎬 Legacy stream source hot-swap in room ${cleanRoomId}: ${streamUrl}`);
        const updated = await RoomRepository.updateRoomState(cleanRoomId, { streamUrl });
        socket.to(cleanRoomId).emit(SOCKET_EVENTS.UPDATE_VIDEO_SRC, streamUrl);
        socket.to(cleanRoomId).emit('sync-state', updated);
      } catch (err) {
        console.error('Error in legacy change-video-src:', err);
      }
    }
  );
};
