import { Server, Socket } from 'socket.io';
import { registerVideoHandlers } from './video.handler.js';
import { registerChatHandlers } from './chat.handler.js';
import { registerWebRTCHandlers, flushPendingViewerSignals } from './webrtc.handler.js';
import { SOCKET_EVENTS } from '../constants/socketEvents.js';
import { RoomRepository } from '../repositories/room.repository.js';
import { FriendCodeRepository } from '../repositories/friendCode.repository.js';
import { RoomInvitationRepository } from '../repositories/roomInvitation.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
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

// Global socket server & user identity to socket mappings (for notifications & invitations)
let globalIo: Server | null = null;
const userSockets = new Map<string, Set<string>>(); // userId/guestId → Set of socketId
const socketUser  = new Map<string, string>();       // socketId → userId/guestId

export function registerSocketUser(socketId: string, userId: string): void {
  const cleanId = userId.trim();
  socketUser.set(socketId, cleanId);
  let set = userSockets.get(cleanId);
  if (!set) {
    set = new Set<string>();
    userSockets.set(cleanId, set);
  }
  set.add(socketId);
}

export function unregisterSocketUser(socketId: string): void {
  const userId = socketUser.get(socketId);
  if (userId) {
    socketUser.delete(socketId);
    const set = userSockets.get(userId);
    if (set) {
      set.delete(socketId);
      if (set.size === 0) userSockets.delete(userId);
    }
  }
}

export function emitToUser(userId: string, event: string, data: any): boolean {
  if (!globalIo) return false;
  const sockets = userSockets.get(userId.trim());
  if (!sockets || sockets.size === 0) return false;
  for (const socketId of sockets) {
    globalIo.to(socketId).emit(event, data);
  }
  return true;
}

export function isUserOnline(userId: string): boolean {
  const sockets = userSockets.get(userId.trim());
  return Boolean(sockets && sockets.size > 0);
}

export function getIO(): Server | null {
  return globalIo;
}

/** Local JWT decode — no network call, no DNS risk (avoids EAI_AGAIN in Docker). */
function decodeSupabaseJwt(token: string): { sub: string; email: string; name?: string | undefined } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      sub?: string; email?: string; exp?: number; user_metadata?: { username?: string; full_name?: string; name?: string };
    };
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.sub) return null;
    const name = payload.user_metadata?.username || payload.user_metadata?.full_name || payload.user_metadata?.name;
    return { sub: payload.sub, email: payload.email || payload.sub, name };
  } catch {
    return null;
  }
}

function broadcastActiveUsers(io: Server, roomId: string) {
  const userMap = new Map<string, { socketId: string; userId: string; name: string; role: string; isHost: boolean }>();
  for (const [socketId, info] of socketInfo.entries()) {
    if (info.roomId === roomId) {
      const key = (info.userId && info.userId !== 'guest') ? info.userId : (info.name || socketId);
      const existing = userMap.get(key);
      // Keep or prioritize host/co-host role if user has multiple sockets
      if (!existing || info.isHost || info.role === 'host') {
        userMap.set(key, {
          socketId,
          userId: info.userId,
          name: info.name,
          role: info.role,
          isHost: info.isHost,
        });
      }
    }
  }
  io.to(roomId).emit('room:active-users', Array.from(userMap.values()));
}

export const setupSockets = (io: Server): void => {
  globalIo = io;

  // ── Authentication Middleware ──────────────────────────────────────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      // Unauthenticated sockets are welcomed as anonymous guests / viewers
      return next();
    }
    const payload = decodeSupabaseJwt(token);
    if (!payload) {
      console.warn('⚠️ Socket connection token invalid or expired. Continuing as unverified socket.');
      return next();
    }
    (socket as any).user   = payload;
    (socket as any).userId = payload.sub;
    next();
  });

  io.on(SOCKET_EVENTS.CONNECTION, (socket: Socket) => {
    console.log(`User connected to syncing mesh: ${socket.id}`);

    // Automatically register verified JWT user for target notifications
    if ((socket as any).userId) {
      registerSocketUser(socket.id, (socket as any).userId);
    }

    // ── Global User Registration (for notifications & invitations) ───────────
    socket.on('user:register', async (data: { userId?: string; sessionSecret?: string }) => {
      try {
        const verifiedUserId = (socket as any).userId || (socket as any).user?.sub;
        let cleanUserId: string;

        if (verifiedUserId) {
          cleanUserId = verifiedUserId;
        } else {
          const requestedId = typeof data?.userId === 'string' ? data.userId.trim() : '';
          if (requestedId.startsWith('anon_') || requestedId.startsWith('guest_')) {
            cleanUserId = requestedId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50);
          } else {
            cleanUserId = `anon_${socket.id.substring(0, 8)}`;
          }

          const secret = data?.sessionSecret || (typeof socket.handshake.auth?.sessionSecret === 'string' ? socket.handshake.auth.sessionSecret.trim() : undefined);
          try {
            const guestSession = await FriendCodeRepository.getGuestSession(cleanUserId);
            if (guestSession) {
              if (!guestSession.isActive || new Date(guestSession.expiresAt).getTime() <= Date.now()) {
                console.warn(`[Socket] Guest session expired/inactive for ${cleanUserId}`);
              } else if (secret && !FriendCodeRepository.verifySecret(secret, guestSession.secretHash)) {
                return socket.emit('error', 'Forbidden: Invalid guest session credentials.');
              }
            }
          } catch (sessionErr) {
            console.warn(`[Socket] Non-fatal guest session lookup error in user:register for ${cleanUserId}:`, sessionErr);
          }
        }

        (socket as any).userId = cleanUserId;
        registerSocketUser(socket.id, cleanUserId);
        socket.emit('user:registered', { userId: cleanUserId });
        console.log(`📡 Registered global notification socket ${socket.id} for user ${cleanUserId}`);
      } catch (err: any) {
        console.error('❌ Error in user:register handler:', err?.message || err);
        socket.emit('error', err?.message || 'Failed to register socket user.');
      }
    });

    // ── Room Join ────────────────────────────────────────────────────────────
    socket.on('room:join', async (data: { roomId: string; userId: string; sessionSecret?: string }) => {
      try {
        const { roomId, userId, sessionSecret } = data;
        const cleanRoomId = String(roomId || '').trim();
        if (!cleanRoomId) return socket.emit('error', 'Room identifier is required');

        // Security: If the socket presents a verified JWT, bind to that verified identity.
        // Do not allow client payload to spoof registered user accounts.
        const verifiedUserId = (socket as any).userId || (socket as any).user?.sub || (socket as any).user?.id;
        let cleanUserId: string;

        if (verifiedUserId) {
          cleanUserId = verifiedUserId;
        } else {
          const requestedId = typeof userId === 'string' ? userId.trim() : '';
          // Unauthenticated guests must have an anon_ or guest_ prefix to prevent claiming registered UUIDs
          if (requestedId.startsWith('anon_') || requestedId.startsWith('guest_')) {
            cleanUserId = requestedId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50);
          } else {
            cleanUserId = `anon_${socket.id.substring(0, 8)}`;
          }

          // Validate guest session validity and expiration server-side gracefully
          const secret = (typeof sessionSecret === 'string' && sessionSecret.trim())
            || (typeof socket.handshake.auth?.sessionSecret === 'string' && socket.handshake.auth.sessionSecret.trim())
            || undefined;

          try {
            const guestSession = await FriendCodeRepository.getGuestSession(cleanUserId);

            if (guestSession) {
              if (!guestSession.isActive) {
                console.warn(`[Socket] Guest session inactive for ${cleanUserId}, continuing as guest.`);
              } else if (new Date(guestSession.expiresAt).getTime() <= Date.now()) {
                await FriendCodeRepository.revokeGuestSession(cleanUserId, undefined, true);
                console.warn(`[Socket] Guest session expired for ${cleanUserId}, continuing as guest.`);
              } else if (secret && !FriendCodeRepository.verifySecret(secret, guestSession.secretHash)) {
                return socket.emit('error', 'Forbidden: Invalid guest session credentials.');
              }
            }
          } catch (sessionErr) {
            console.warn(`[Socket] Guest session lookup non-fatal error for ${cleanUserId}:`, sessionErr);
          }
        }
        (socket as any).userId = cleanUserId;
        registerSocketUser(socket.id, cleanUserId);

        socket.join(cleanRoomId);
        console.log(`👥 User ${cleanUserId} (${socket.id}) joined room ${cleanRoomId}`);

        const metadata = await RoomRepository.getRoomMetadata(cleanRoomId);
        // Security: An anonymous socket can only be host if the room's host_id was explicitly an anonymous ID matching theirs.
        // Registered hosts require a verified JWT.
        const isHost = verifiedUserId
          ? cleanUserId === metadata.host_id
          : metadata.host_id.startsWith('anon_') && cleanUserId === metadata.host_id;

        const role = isHost ? 'host' : await RoomRepository.getUserRoomRole(cleanRoomId, cleanUserId);

        let name = (socket as any).user?.name;
        if (!name && (socket as any).user?.email) {
          name = (socket as any).user.email.split('@')[0];
        }
        if (!name) {
          name = cleanUserId;
        }

        socketInfo.set(socket.id, { roomId: cleanRoomId, userId: cleanUserId, name, isHost, role });

        if (isHost) {
          const existing = activeHosts.get(cleanRoomId);
          if (existing?.disconnectTimeout) {
            console.log(`🔄 Host reconnected. Clearing teardown timer for room: ${cleanRoomId}`);
            clearTimeout(existing.disconnectTimeout);
          }
          activeHosts.set(cleanRoomId, { userId: cleanUserId, socketId: socket.id });
          flushPendingViewerSignals(io, cleanRoomId, socket.id);
        }

        const roomState = await RoomRepository.getRoomState(cleanRoomId);
        socket.emit('sync-state', roomState);

        // If host is actively streaming a local video, catch up the newly joined viewer immediately
        if (roomState.mediaSourceType === 'local' && !isHost) {
          console.log(`📡 Catching up new viewer ${cleanUserId} on active local host stream in room ${cleanRoomId}`);
          socket.emit('webrtc:host-stream-ready', {
            mediaName: roomState.mediaName || 'Host Stream',
            mediaDuration: roomState.mediaDuration ?? null,
          });

          const hostSocketId = activeHosts.get(cleanRoomId)?.socketId;
          if (hostSocketId && hostSocketId !== socket.id) {
            io.to(hostSocketId).emit('webrtc:viewer-joined', {
              viewerId: cleanUserId,
              roomId: cleanRoomId,
            });
          }
        }

        // Broadcast active users
        broadcastActiveUsers(io, cleanRoomId);
      } catch (err: any) {
        console.error('❌ Error in room:join handler:', err?.message || err);
        socket.emit('error', err?.message || 'Failed to join room.');
      }
    });

    // ── Watch Party Room Invitation Relay ────────────────────────────────────
    socket.on('room:invite:send', async (data: { roomId: string; targetUserId: string; targetUsername?: string }, ack?: (res: any) => void) => {
      try {
        const { roomId, targetUserId, targetUsername } = data || {};
        const callerUserId = (socket as any).userId;
        if (!callerUserId) {
          const errRes = { success: false, error: 'Unauthorized: Authentication required to invite' };
          if (ack) ack(errRes);
          return socket.emit('error', errRes.error);
        }

        const cleanRoomId = String(roomId || '').trim();
        const cleanTargetId = String(targetUserId || '').trim();
        if (!cleanRoomId || !cleanTargetId) {
          const errRes = { success: false, error: 'Missing roomId or targetUserId' };
          if (ack) ack(errRes);
          return socket.emit('error', errRes.error);
        }

        if (cleanTargetId === callerUserId) {
          const errRes = { success: false, error: 'Cannot invite yourself to a watch party' };
          if (ack) ack(errRes);
          return socket.emit('error', errRes.error);
        }

        const metadata = await RoomRepository.getRoomMetadata(cleanRoomId);
        const role = await RoomRepository.getUserRoomRole(cleanRoomId, callerUserId);
        if (metadata.host_id !== callerUserId && role !== 'host' && role !== 'co-host') {
          const errRes = { success: false, error: 'Unauthorized: Only room host can send invitations' };
          if (ack) ack(errRes);
          return socket.emit('error', errRes.error);
        }

        let hostName = (socket as any).user?.name;
        let hostAvatar: string | undefined = undefined;
        if (!hostName) {
          const profile = await UserRepository.getProfile(callerUserId);
          hostName = profile?.username || callerUserId;
          hostAvatar = profile?.avatarUrl;
        }

        const invitation = await RoomInvitationRepository.createInvitation({
          roomId: cleanRoomId,
          hostId: callerUserId,
          hostName: hostName || 'Host',
          hostAvatar,
          recipientId: cleanTargetId,
          recipientUsername: targetUsername,
        });

        const delivered = emitToUser(cleanTargetId, 'room:invitation:received', invitation);
        console.log(`📨 [Socket] Invitation ${invitation.id} from ${callerUserId} to ${cleanTargetId} in ${cleanRoomId} (delivered: ${delivered})`);

        const resPayload = { success: true, delivered, invitation };
        if (ack) ack(resPayload);
        socket.emit('room:invite:sent', resPayload);
      } catch (err: any) {
        console.error('Error in room:invite:send:', err);
        if (ack) ack({ success: false, error: err.message || 'Internal error' });
      }
    });

    socket.on('room:invite:respond', async (data: { invitationId: string; response: 'accept' | 'decline' }, ack?: (res: any) => void) => {
      try {
        const { invitationId, response } = data || {};
        const callerUserId = (socket as any).userId;
        if (!callerUserId) {
          const errRes = { success: false, error: 'Unauthorized: Authentication required to respond' };
          if (ack) ack(errRes);
          return socket.emit('error', errRes.error);
        }

        if (response !== 'accept' && response !== 'decline') {
          const errRes = { success: false, error: 'Invalid response: must be "accept" or "decline"' };
          if (ack) ack(errRes);
          return socket.emit('error', errRes.error);
        }

        const result = await RoomInvitationRepository.respondToInvitation(invitationId, callerUserId, response);
        const inv = result.invitation;

        emitToUser(inv.hostId, response === 'accept' ? 'room:invitation:accepted' : 'room:invitation:declined', {
          invitationId: inv.id,
          roomId: inv.roomId,
          recipientId: callerUserId,
          recipientUsername: inv.recipientUsername,
        });

        const resPayload = { success: true, response, roomId: inv.roomId, invitation: inv };
        if (ack) ack(resPayload);
        socket.emit('room:invite:responded', resPayload);
      } catch (err: any) {
        console.error('Error in room:invite:respond:', err);
        if (ack) ack({ success: false, error: err.message || 'Internal error' });
      }
    });


    // ── Lobby: Guests Knock ──────────────────────────────────────────────────
    socket.on('room:knock', (data: { roomId: string; username: string }) => {
      const { roomId, username } = data;
      const cleanRoomId = String(roomId || '').trim();
      const rawUsername = typeof username === 'string' ? username.trim() : '';
      const cleanUsername = rawUsername.slice(0, 50) || `Guest-${socket.id.substring(0, 4)}`;
      if (!cleanRoomId) return;

      console.log(`✊ Guest ${cleanUsername} (${socket.id}) is knocking on room ${cleanRoomId}`);

      socketInfo.set(socket.id, {
        roomId:  cleanRoomId,
        userId:  (socket as any).user?.id || `guest_${socket.id.substring(0, 8)}`,
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
        const socketUserId = (socket as any).userId || (socket as any).user?.sub || (socket as any).user?.id || info.userId;
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
        const socketUserId = (socket as any).userId || (socket as any).user?.sub || (socket as any).user?.id || info.userId;
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
        const socketUserId = (socket as any).userId || (socket as any).user?.sub || (socket as any).user?.id || info.userId;
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
        const socketUserId = (socket as any).userId || (socket as any).user?.sub || (socket as any).user?.id || info.userId;
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
    registerVideoHandlers(io, socket, socketInfo);
    registerChatHandlers(io, socket, socketInfo);
    registerWebRTCHandlers(io, socket, socketInfo, activeHosts);

    // ── Disconnect ───────────────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.DISCONNECT, async () => {
      console.log(`User decoupled: ${socket.id}`);
      unregisterSocketUser(socket.id);

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
            // Broadcast fallback to viewers in room only, never back to the host
            socket.to(roomId).emit('room:host_disconnected_fallback');
          }, 60_000);
          timeout.unref?.();
          hostSession.disconnectTimeout = timeout;
        }
      }
    });
  });
};
