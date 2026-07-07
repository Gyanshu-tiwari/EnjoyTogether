import type { Socket, Server } from 'socket.io';
import { RoomRepository } from '../rooms/room.repository.js';
import { SOCKET_EVENTS } from '../constants/socketEvents.js';

export const registerVideoHandlers = (io: Server, socket: Socket) => {
  // 🎬 1. Modern granular event listeners for play, pause, seek
  socket.on('video:play', async (data: { roomId: string; position: number }) => {
    const { roomId, position } = data;
    const cleanRoomId = String(roomId).trim();

    try {
      const metadata = await RoomRepository.getRoomMetadata(cleanRoomId);
      const socketUserId = (socket as any).userId || (socket as any).user?.id;
      if (!socketUserId || socketUserId !== metadata.host_id) {
        console.warn(`⚠️ Security Alert: Unauthorized user ${socketUserId} attempted video:play!`);
        return socket.emit('error', 'Unauthorized: Only the host can control media playback.');
      }

      console.log(`🎬 video:play event received for room ${cleanRoomId} at ${position}s`);
      
      const updated = await RoomRepository.updateRoomState(cleanRoomId, {
        isPlaying: true,
        position,
      });
      
      // Broadcast events down to milliseconds
      socket.to(cleanRoomId).emit('video:play', { position });
      socket.to(cleanRoomId).emit('sync-state', updated);
      // Legacy support trigger
      socket.to(cleanRoomId).emit(SOCKET_EVENTS.SYNC_STATE, updated);
    } catch (err) {
      console.error('Error in video:play authorization:', err);
      socket.emit('error', 'Internal server error during authorization.');
    }
  });

  socket.on('video:pause', async (data: { roomId: string; position: number }) => {
    const { roomId, position } = data;
    const cleanRoomId = String(roomId).trim();

    try {
      const metadata = await RoomRepository.getRoomMetadata(cleanRoomId);
      const socketUserId = (socket as any).userId || (socket as any).user?.id;
      if (!socketUserId || socketUserId !== metadata.host_id) {
        console.warn(`⚠️ Security Alert: Unauthorized user ${socketUserId} attempted video:pause!`);
        return socket.emit('error', 'Unauthorized: Only the host can control media playback.');
      }

      console.log(`🎬 video:pause event received for room ${cleanRoomId} at ${position}s`);
      
      const updated = await RoomRepository.updateRoomState(cleanRoomId, {
        isPlaying: false,
        position,
      });
      
      socket.to(cleanRoomId).emit('video:pause', { position });
      socket.to(cleanRoomId).emit('sync-state', updated);
      // Legacy support trigger
      socket.to(cleanRoomId).emit(SOCKET_EVENTS.SYNC_STATE, updated);
    } catch (err) {
      console.error('Error in video:pause authorization:', err);
      socket.emit('error', 'Internal server error during authorization.');
    }
  });

  socket.on('video:seek', async (data: { roomId: string; position: number }) => {
    const { roomId, position } = data;
    const cleanRoomId = String(roomId).trim();

    try {
      const metadata = await RoomRepository.getRoomMetadata(cleanRoomId);
      const socketUserId = (socket as any).userId || (socket as any).user?.id;
      if (!socketUserId || socketUserId !== metadata.host_id) {
        console.warn(`⚠️ Security Alert: Unauthorized user ${socketUserId} attempted video:seek!`);
        return socket.emit('error', 'Unauthorized: Only the host can seek the media.');
      }

      console.log(`🎬 video:seek event received for room ${cleanRoomId} to ${position}s`);

      const updated = await RoomRepository.updateRoomState(cleanRoomId, { position });

      socket.to(cleanRoomId).emit('video:seek', { position });
      socket.to(cleanRoomId).emit('sync-state', updated);
      socket.to(cleanRoomId).emit(SOCKET_EVENTS.SYNC_STATE, updated);
    } catch (err) {
      console.error('Error in video:seek authorization:', err);
      socket.emit('error', 'Internal server error during seek authorization.');
    }
  });


  // 🎬 2. Legacy Play/Pause/Seek updates (media-action) for backwards compatibility
  socket.on(
    SOCKET_EVENTS.MEDIA_ACTION,
    async (data: { roomId: string; isPlaying: boolean; position: number }) => {
      const { roomId, isPlaying, position } = data;
      const cleanRoomId = String(roomId).trim();

      const updatedState = await RoomRepository.updateRoomState(cleanRoomId, {
        isPlaying,
        position,
      });

      // Broadcast to other peers in the room
      socket.to(cleanRoomId).emit(SOCKET_EVENTS.SYNC_STATE, updatedState);
      socket.to(cleanRoomId).emit('sync-state', updatedState);
    }
  );

  // 🎬 3. Legacy video stream source updates (change-video-src) for backwards compatibility
  socket.on(
    SOCKET_EVENTS.CHANGE_VIDEO_SRC,
    async (data: { roomId: string; streamUrl: string }) => {
      const { roomId, streamUrl } = data;
      const cleanRoomId = String(roomId).trim();

      console.log(`🎬 Legacy Room ${cleanRoomId} stream source hot-swapped to: ${streamUrl}`);

      const updated = await RoomRepository.updateRoomState(cleanRoomId, {
        streamUrl,
      });

      socket.to(cleanRoomId).emit(SOCKET_EVENTS.UPDATE_VIDEO_SRC, streamUrl);
      socket.to(cleanRoomId).emit('sync-state', updated);
    }
  );
};
