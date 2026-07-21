import { Server, Socket } from 'socket.io';
import { registerVideoHandlers } from './video.handler.js';
import { registerChatHandlers } from './chat.handler.js';
import { SOCKET_EVENTS } from '../constants/socketEvents.js';
import { RoomRepository } from '../repositories/room.repository.js';
import { RoomServiceClient } from 'livekit-server-sdk';
import { livekitConfig } from '../config/livekit.js';

interface HostSession {
  userId: string;
  socketId: string;
  disconnectTimeout?: NodeJS.Timeout;
}

// In-memory registry: active hosts and socket metadata
const activeHosts = new Map<string, HostSession>();                                 // roomId → HostSession
const socketInfo  = new Map<string, { roomId: string; userId: string; name: string; isHost: boolean; role: string }>(); // socketId → Info

/** Local JWT decode — no network call, no DNS risk (avoids EAI_AGAIN in Docker). */
function decodeSupabaseJwt(token: string): { sub: string; email: string; name?: string | undefined } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      sub?: string; email?: string; exp?: number; user_metadata?: { full_name?: string; name?: string };
    };
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.sub) return null;
    const name = payload.user_metadata?.full_name || payload.user_metadata?.name;
    return { sub: payload.sub, email: payload.email || payload.sub, name };
  } catch {
    return null;
  }
}

function broadcastActiveUsers(io: Server, roomId: string) {
  const users = Array.from(socketInfo.entries())
    .filter(([_, info]) => info.roomId === roomId)
    .map(([socketId, info]) => ({
      socketId,
      userId: info.userId,
      name: info.name,
      role: info.role,
      isHost: info.isHost,
    }));
  io.to(roomId).emit('room:active-users', users);
}

export const setupSockets = (io: Server): void => {
  // ── Authentication Middleware ──────────────────────────────────────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      // Allow anonymous sockets in non-Supabase / local dev mode
      if (!process.env.SUPABASE_URL) return next();
      console.warn('⚠️ Socket connection rejected: missing authentication token.');
      return next(new Error('Authentication token required'));
    }
    const payload = decodeSupabaseJwt(token);
    if (!payload) {
      console.warn('⚠️ Socket connection rejected: invalid or expired token.');
      return next(new Error('Invalid authentication token'));
    }
    (socket as any).user   = payload;
    (socket as any).userId = payload.sub;
    next();
  });

  io.on(SOCKET_EVENTS.CONNECTION, (socket: Socket) => {
    console.log(`User connected to syncing mesh: ${socket.id}`);

    // ── Room Join ────────────────────────────────────────────────────────────
    socket.on('room:join', async (data: { roomId: string; userId: string }) => {
      const { roomId, userId } = data;
      const cleanRoomId = String(roomId).trim();
      const cleanUserId = (socket as any).user?.id || String(userId).trim();

      socket.join(cleanRoomId);
      console.log(`👥 User ${cleanUserId} (${socket.id}) joined room ${cleanRoomId}`);

      const metadata = await RoomRepository.getRoomMetadata(cleanRoomId);
      const isHost   = cleanUserId === metadata.host_id;

      const role = await RoomRepository.getUserRoomRole(cleanRoomId, cleanUserId);
      const name = (socket as any).user?.name || cleanUserId;

      socketInfo.set(socket.id, { roomId: cleanRoomId, userId: cleanUserId, name, isHost, role });

      if (isHost) {
        const existing = activeHosts.get(cleanRoomId);
        if (existing?.disconnectTimeout) {
          console.log(`🔄 Host reconnected. Clearing teardown timer for room: ${cleanRoomId}`);
          clearTimeout(existing.disconnectTimeout);
        }
        activeHosts.set(cleanRoomId, { userId: cleanUserId, socketId: socket.id });
      }

      const roomState = await RoomRepository.getRoomState(cleanRoomId);
      socket.emit('sync-state', roomState);
      
      // Broadcast active users
      broadcastActiveUsers(io, cleanRoomId);
    });

    // ── Lobby: Guests Knock ──────────────────────────────────────────────────
    socket.on('room:knock', (data: { roomId: string; username: string }) => {
      const { roomId, username } = data;
      const cleanRoomId  = String(roomId).trim();
      const cleanUsername = String(username).trim();
      console.log(`✊ Guest ${cleanUsername} (${socket.id}) is knocking on room ${cleanRoomId}`);

      socketInfo.set(socket.id, {
        roomId:  cleanRoomId,
        userId:  (socket as any).user?.id || 'guest',
        name:    cleanUsername,
        isHost:  false,
        role:    'viewer'
      });

      io.to(cleanRoomId).emit('room:knock-alert', { socketId: socket.id, username: cleanUsername });
    });

    // ── Admission: Approve ───────────────────────────────────────────────────
    socket.on('room:approve-entry', async (data: { guestSocketId: string }) => {
      const { guestSocketId } = data;
      const info = socketInfo.get(socket.id);
      if (!info) return socket.emit('error', 'Room session info not found.');
      const { roomId } = info;

      try {
        const socketUserId = (socket as any).userId || (socket as any).user?.id;
        const role = await RoomRepository.getUserRoomRole(roomId, socketUserId);
        if (role !== 'host' && role !== 'co-host') {
          console.warn(`⚠️ RBAC: ${socketUserId} attempted room:approve-entry without host/co-host role.`);
          return socket.emit('error', 'Unauthorized: only host or co-host can approve admission.');
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
        console.error('Error in room:approve-entry:', err);
        socket.emit('error', 'Internal server error during authorization.');
      }
    });

    // ── Admission: Reject ────────────────────────────────────────────────────
    socket.on('room:reject-entry', async (data: { guestSocketId: string }) => {
      const { guestSocketId } = data;
      const info = socketInfo.get(socket.id);
      if (!info) return socket.emit('error', 'Room session info not found.');
      const { roomId } = info;

      try {
        const socketUserId = (socket as any).userId || (socket as any).user?.id;
        const role = await RoomRepository.getUserRoomRole(roomId, socketUserId);
        if (role !== 'host' && role !== 'co-host') {
          console.warn(`⚠️ RBAC: ${socketUserId} attempted room:reject-entry without host/co-host role.`);
          return socket.emit('error', 'Unauthorized: only host or co-host can reject admission.');
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
        console.error('Error in room:reject-entry:', err);
        socket.emit('error', 'Internal server error during authorization.');
      }
    });

    // ── RBAC: Change Role ────────────────────────────────────────────────────
    socket.on('room:change-role', async (data: { targetUserId: string; newRole: string }) => {
      const { targetUserId, newRole } = data;
      const info = socketInfo.get(socket.id);
      if (!info) return socket.emit('error', 'Room session info not found.');
      const { roomId } = info;
      
      try {
        const socketUserId = (socket as any).userId || (socket as any).user?.id;
        const role = await RoomRepository.getUserRoomRole(roomId, socketUserId);
        if (role !== 'host') {
          return socket.emit('error', 'Unauthorized: only host can change roles.');
        }

        // We should update the role in database or memory. Let's update socketInfo mapping for all sockets of targetUserId.
        let targetFound = false;
        for (const [sId, sInfo] of socketInfo.entries()) {
          if (sInfo.roomId === roomId && sInfo.userId === targetUserId) {
            sInfo.role = newRole;
            targetFound = true;
          }
        }
        
        if (targetFound) {
          // Update DB via RoomRepository
          await RoomRepository.updateUserRoomRole(roomId, targetUserId, newRole as any);
          broadcastActiveUsers(io, roomId);

          // Update LiveKit permissions dynamically
          try {
            const roomService = new RoomServiceClient(
              livekitConfig.serverUrl,
              livekitConfig.apiKey,
              livekitConfig.apiSecret
            );
            const canPublish = newRole === 'host' || newRole === 'co-host';
            await roomService.updateParticipant(roomId, targetUserId, undefined, {
              canPublish,
              canSubscribe: true,
              canPublishData: canPublish,
            });
            console.log(`✅ LiveKit permissions dynamically updated for ${targetUserId} to canPublish=${canPublish}`);
          } catch (lkErr) {
            console.warn(`⚠️ Could not update LiveKit permissions for ${targetUserId}:`, lkErr);
          }
        }
      } catch (err) {
        console.error('Error changing role:', err);
      }
    });

    // ── RBAC: Kick User ──────────────────────────────────────────────────────
    socket.on('room:kick-user', async (data: { targetUserId: string }) => {
      const { targetUserId } = data;
      const info = socketInfo.get(socket.id);
      if (!info) return socket.emit('error', 'Room session info not found.');
      const { roomId } = info;
      
      try {
        const socketUserId = (socket as any).userId || (socket as any).user?.id;
        const role = await RoomRepository.getUserRoomRole(roomId, socketUserId);
        if (role !== 'host' && role !== 'co-host') {
          return socket.emit('error', 'Unauthorized: only host or co-host can kick users.');
        }

        for (const [sId, sInfo] of socketInfo.entries()) {
          if (sInfo.roomId === roomId && sInfo.userId === targetUserId) {
            const targetSocket = io.sockets.sockets.get(sId);
            if (targetSocket) {
              targetSocket.emit('room:kicked');
              targetSocket.disconnect();
            }
          }
        }
      } catch (err) {
        console.error('Error kicking user:', err);
      }
    });

    // ── Emoji Relay ──────────────────────────────────────────────────────────
    socket.on('room:send-emoji', (data: { roomId: string; emoji: string }) => {
      const { roomId, emoji } = data;
      const cleanRoomId = String(roomId).trim();
      console.log(`✨ Emoji relay in room ${cleanRoomId}: ${emoji}`);
      io.to(cleanRoomId).emit('room:receive-emoji', { emoji });
    });

    // ── Legacy join-room ─────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.JOIN_ROOM, async (roomId: string) => {
      const cleanRoomId = String(roomId).trim();
      socket.join(cleanRoomId);
      console.log(`👥 Legacy join-room: ${socket.id} joined room ${cleanRoomId}`);

      const roomState = await RoomRepository.getRoomState(cleanRoomId);
      if (roomState.streamUrl) {
        socket.emit(SOCKET_EVENTS.UPDATE_VIDEO_SRC, roomState.streamUrl);
      }
      socket.emit(SOCKET_EVENTS.SYNC_STATE, roomState);
    });

    // ── Register Sub-handlers ────────────────────────────────────────────────
    registerVideoHandlers(io, socket);
    registerChatHandlers(io, socket);

    // ── Disconnect ───────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.DISCONNECT, async () => {
      console.log(`User decoupled: ${socket.id}`);

      const info = socketInfo.get(socket.id);
      if (!info) return;

      const { roomId, userId, isHost } = info;
      socketInfo.delete(socket.id);
      
      broadcastActiveUsers(io, roomId);

      if (isHost) {
        console.log(`⚠️ Host ${userId} disconnected from room ${roomId}. Starting 60s grace period...`);
        const hostSession = activeHosts.get(roomId);
        if (hostSession && hostSession.socketId === socket.id) {
          const timeout = setTimeout(async () => {
            console.log(`💀 Host grace period expired. Deactivating room: ${roomId}`);
            activeHosts.delete(roomId);
            await RoomRepository.setSessionActiveStatus(roomId, false);
            io.to(roomId).emit('room:host_disconnected_fallback');
          }, 60_000);
          hostSession.disconnectTimeout = timeout;
        }
      }
    });
  });
};
