import { Server, Socket } from 'socket.io';
import { registerVideoHandlers } from './video.handler.js';
import { registerChatHandlers } from './chat.handler.js';
import { SOCKET_EVENTS } from '../constants/socketEvents.js';
import { RoomRepository } from '../rooms/room.repository.js';
import { supabase } from '../config/supabase.js';

interface HostSession {
  userId: string;
  socketId: string;
  disconnectTimeout?: NodeJS.Timeout;
}

// In-memory registry to manage active hosts and grace-period timers
const activeHosts = new Map<string, HostSession>(); // roomId -> HostSession
const socketInfo = new Map<string, { roomId: string; userId: string; isHost: boolean }>(); // socketId -> Info

export const setupSockets = (io: Server): void => {
  // Use middleware to authenticate sockets if Supabase is enabled
  io.use(async (socket, next) => {
    if (supabase) {
      const token = socket.handshake.auth?.token;
      if (!token) {
        console.warn('⚠️ Socket connection rejected: missing authentication token.');
        return next(new Error('Authentication token required'));
      }
      try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
          console.warn('⚠️ Socket connection rejected: invalid authentication token.', error);
          return next(new Error('Invalid authentication token'));
        }
        (socket as any).user = user;
        (socket as any).userId = user.id;
      } catch (err) {
        console.error('❌ Error during socket token authentication:', err);
        return next(new Error('Authentication server error'));
      }
    }
    next();
  });

  io.on(SOCKET_EVENTS.CONNECTION, (socket: Socket) => {
    console.log(`User connected to syncing mesh: ${socket.id}`);

    // Listen for room:join (the main active session entry event)
    socket.on('room:join', async (data: { roomId: string; userId: string }) => {
      const { roomId, userId } = data;
      const cleanRoomId = String(roomId).trim();
      const cleanUserId = (socket as any).user?.id || String(userId).trim();

      socket.join(cleanRoomId);
      console.log(`👥 User ${cleanUserId} (${socket.id}) joined room ${cleanRoomId}`);

      const metadata = await RoomRepository.getRoomMetadata(cleanRoomId);
      const isHost = cleanUserId === metadata.host_id;

      socketInfo.set(socket.id, { roomId: cleanRoomId, userId: cleanUserId, isHost });

      if (isHost) {
        const existing = activeHosts.get(cleanRoomId);
        if (existing && existing.disconnectTimeout) {
          console.log(`🔄 Host reconnected within grace period. Clearing teardown timer for room: ${cleanRoomId}`);
          clearTimeout(existing.disconnectTimeout);
        }
        
        activeHosts.set(cleanRoomId, {
          userId: cleanUserId,
          socketId: socket.id,
        });
      }

      const roomState = await RoomRepository.getRoomState(cleanRoomId);
      socket.emit('sync-state', roomState);
    });

    // Lobby System: Guests knock
    socket.on('room:knock', (data: { roomId: string; username: string }) => {
      const { roomId, username } = data;
      const cleanRoomId = String(roomId).trim();
      const cleanUsername = String(username).trim();
      console.log(`✊ Guest ${cleanUsername} (${socket.id}) is knocking on room ${cleanRoomId}`);

      socketInfo.set(socket.id, { roomId: cleanRoomId, userId: (socket as any).user?.id || 'guest', isHost: false });

      // Broadcast room:knock-alert to the Host/everyone in cleanRoomId
      io.to(cleanRoomId).emit('room:knock-alert', { socketId: socket.id, username: cleanUsername });
    });

    // Admission Verdicts: Host approves entry
    socket.on('room:approve-entry', async (data: { guestSocketId: string }) => {
      const { guestSocketId } = data;
      const info = socketInfo.get(socket.id);
      if (!info) {
        return socket.emit('error', 'Room session info not found.');
      }
      const roomId = info.roomId;

      try {
        const metadata = await RoomRepository.getRoomMetadata(roomId);
        const socketUserId = (socket as any).userId || (socket as any).user?.id;
        if (!socketUserId || socketUserId !== metadata.host_id) {
          console.warn(`⚠️ Security Alert: Unauthorized user ${socketUserId} attempted room:approve-entry!`);
          return socket.emit('error', 'Unauthorized: Only the host can approve admission.');
        }

        const guestSocket = io.sockets.sockets.get(guestSocketId);
        if (guestSocket) {
          guestSocket.join(roomId);
          console.log(`✅ Host approved guest ${guestSocketId} to join room ${roomId}`);
          guestSocket.emit('room:entry-approved');
        } else {
          console.warn(`⚠️ Guest socket ${guestSocketId} not found for approval.`);
        }
      } catch (err) {
        console.error('Error in room:approve-entry authorization:', err);
        socket.emit('error', 'Internal server error during authorization.');
      }
    });

    // Admission Verdicts: Host rejects entry
    socket.on('room:reject-entry', async (data: { guestSocketId: string }) => {
      const { guestSocketId } = data;
      const info = socketInfo.get(socket.id);
      if (!info) {
        return socket.emit('error', 'Room session info not found.');
      }
      const roomId = info.roomId;

      try {
        const metadata = await RoomRepository.getRoomMetadata(roomId);
        const socketUserId = (socket as any).userId || (socket as any).user?.id;
        if (!socketUserId || socketUserId !== metadata.host_id) {
          console.warn(`⚠️ Security Alert: Unauthorized user ${socketUserId} attempted room:reject-entry!`);
          return socket.emit('error', 'Unauthorized: Only the host can reject admission.');
        }

        const guestSocket = io.sockets.sockets.get(guestSocketId);
        if (guestSocket) {
          console.log(`❌ Host rejected guest ${guestSocketId}`);
          guestSocket.emit('room:entry-rejected');
          guestSocket.disconnect();
        } else {
          console.warn(`⚠️ Guest socket ${guestSocketId} not found for rejection.`);
        }
      } catch (err) {
        console.error('Error in room:reject-entry authorization:', err);
        socket.emit('error', 'Internal server error during authorization.');
      }
    });

    // Emoji Relay
    socket.on('room:send-emoji', (data: { roomId: string; emoji: string }) => {
      const { roomId, emoji } = data;
      const cleanRoomId = String(roomId).trim();
      console.log(`✨ Emoji relay in room ${cleanRoomId}: ${emoji}`);
      io.to(cleanRoomId).emit('room:receive-emoji', { emoji });
    });

    // Support legacy join-room event for backward compatibility
    socket.on(SOCKET_EVENTS.JOIN_ROOM, async (roomId: string) => {
      const cleanRoomId = String(roomId).trim();
      socket.join(cleanRoomId);
      console.log(`👥 Legacy join-room: connection ${socket.id} joined room ${cleanRoomId}`);
      
      const roomState = await RoomRepository.getRoomState(cleanRoomId);
      if (roomState.streamUrl) {
        socket.emit(SOCKET_EVENTS.UPDATE_VIDEO_SRC, roomState.streamUrl);
      }
      socket.emit(SOCKET_EVENTS.SYNC_STATE, roomState);
    });

    // Register sub-handlers (relaying media and chats)
    registerVideoHandlers(io, socket);
    registerChatHandlers(io, socket);

    socket.on(SOCKET_EVENTS.DISCONNECT, async () => {
      console.log(`User decoupled tracking index parameters: ${socket.id}`);
      
      const info = socketInfo.get(socket.id);
      if (!info) return;

      const { roomId, userId, isHost } = info;
      socketInfo.delete(socket.id);

      if (isHost) {
        console.log(`⚠️ Host ${userId} disconnected from room ${roomId}. Starting 10-second grace period...`);
        
        const hostSession = activeHosts.get(roomId);
        if (hostSession && hostSession.socketId === socket.id) {
          const timeout = setTimeout(async () => {
            console.log(`💀 Host grace period expired. Deactivating room: ${roomId}`);
            activeHosts.delete(roomId);
            
            await RoomRepository.setSessionActiveStatus(roomId, false);
            io.to(roomId).emit('room:host_disconnected_fallback');
          }, 10000);
          
          hostSession.disconnectTimeout = timeout;
        }
      }
    });
  });
};
