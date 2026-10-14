/**
 * webrtc.handler.ts
 * ─────────────────
 * WebRTC signaling relay for the local-first watch-together stream.
 *
 * The server acts as a pure signaling relay — it NEVER receives, stores,
 * or processes video bytes. It only routes SDP offers/answers and ICE
 * candidates between the Host and Viewer sockets.
 *
 * Security model:
 * - RBAC validated: only hosts/co-hosts can send HOST_STREAM_READY/ENDED
 * - Message routing validated: targetId must be a valid participant in the room
 * - No file data, no raw video, no base64 video allowed in these messages
 *
 * Architecture:
 *   Host socket → webrtc:offer → server → Viewer socket
 *   Viewer socket → webrtc:answer → server → Host socket
 *   Either → webrtc:ice-candidate → server → Other
 */

import type { Socket, Server } from 'socket.io';
import { WEBRTC_EVENTS } from '../constants/socketEvents.js';
import { RoomRepository } from '../repositories/room.repository.js';

// socketInfo is shared from the parent index.ts
type SocketInfoMap = Map<string, { roomId: string; userId: string; name: string; isHost: boolean; role: string }>;

export function registerWebRTCHandlers(
  io: Server,
  socket: Socket,
  socketInfo: SocketInfoMap
): void {

  // ── Helper: find the host socket ID for a given room ──────────────────────
  function findHostSocketId(roomId: string): string | null {
    for (const [sId, info] of socketInfo.entries()) {
      if (info.roomId === roomId && info.isHost) {
        return sId;
      }
    }
    return null;
  }

  // ── Helper: find all socket IDs for a specific userId in a room ───────────
  function findSocketIdForViewer(roomId: string, viewerId: string): string | null {
    for (const [sId, info] of socketInfo.entries()) {
      if (info.roomId === roomId && info.userId === viewerId) {
        return sId;
      }
    }
    return null;
  }

  // ── Viewer → Server → Host: "I'm ready for a peer connection" ─────────────
  socket.on(WEBRTC_EVENTS.VIEWER_READY, (data: { roomId: string; viewerId: string; connectionId: string }) => {
    const { roomId, viewerId, connectionId } = data;
    const senderInfo = socketInfo.get(socket.id);
    if (!senderInfo) return;

    console.log(`[WebRTC] Viewer ${viewerId} is ready in room ${roomId} (conn: ${connectionId})`);

    const hostSocketId = findHostSocketId(roomId);
    if (!hostSocketId) {
      console.warn(`[WebRTC] No host found in room ${roomId} to relay viewer-ready.`);
      socket.emit('webrtc:error', { message: 'Host not found in room.' });
      return;
    }

    // Relay to host socket
    io.to(hostSocketId).emit(WEBRTC_EVENTS.VIEWER_READY, { viewerId, connectionId, roomId });
  });

  // ── Host → Server → Viewer: SDP Offer ─────────────────────────────────────
  socket.on(WEBRTC_EVENTS.OFFER, async (data: {
    roomId: string;
    targetId: string; // viewerId
    sdp: { type: string; sdp: string };
    connectionId: string;
  }) => {
    const { roomId, targetId, sdp, connectionId } = data;

    // Security: only host/co-host can send offers
    const senderInfo = socketInfo.get(socket.id);
    const userId = senderInfo?.userId;
    if (userId) {
      const role = senderInfo?.role || (await RoomRepository.getUserRoomRole(roomId, userId));
      if (role === 'viewer') {
        console.warn(`[WebRTC] Viewer ${userId} attempted to send offer — blocked.`);
        socket.emit('webrtc:error', { message: 'Viewers cannot initiate WebRTC offers.' });
        return;
      }
    }

    // Security: do not relay raw bytes — SDP must be a proper RTCSessionDescription
    if (!sdp || typeof sdp.sdp !== 'string' || !sdp.type) {
      console.warn('[WebRTC] Invalid SDP offer structure — rejected.');
      return;
    }

    console.log(`[WebRTC] Relaying offer from host to viewer ${targetId} (conn: ${connectionId})`);

    const targetSocketId = findSocketIdForViewer(roomId, targetId);
    if (!targetSocketId) {
      console.warn(`[WebRTC] Target viewer ${targetId} not found in room ${roomId}.`);
      return;
    }

    io.to(targetSocketId).emit(WEBRTC_EVENTS.OFFER, {
      senderId: userId,
      sdp,
      connectionId,
    });
  });

  // ── Viewer → Server → Host: SDP Answer ────────────────────────────────────
  socket.on(WEBRTC_EVENTS.ANSWER, (data: {
    roomId: string;
    targetId: string; // 'host'
    sdp: { type: string; sdp: string };
    connectionId: string;
    senderId: string; // viewerId
  }) => {
    const { roomId, sdp, connectionId, senderId } = data;

    if (!sdp || typeof sdp.sdp !== 'string' || !sdp.type) {
      console.warn('[WebRTC] Invalid SDP answer structure — rejected.');
      return;
    }

    console.log(`[WebRTC] Relaying answer from viewer ${senderId} to host (conn: ${connectionId})`);

    const hostSocketId = findHostSocketId(roomId);
    if (!hostSocketId) {
      console.warn(`[WebRTC] Host not found in room ${roomId} for answer relay.`);
      return;
    }

    io.to(hostSocketId).emit(WEBRTC_EVENTS.ANSWER, {
      senderId,
      sdp,
      connectionId,
    });
  });

  // ── Bidirectional: ICE Candidate Relay ────────────────────────────────────
  socket.on(WEBRTC_EVENTS.ICE_CANDIDATE, (data: {
    roomId: string;
    targetId: string; // viewerId or 'host'
    candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };
    connectionId: string;
    senderId?: string;
  }) => {
    const { roomId, targetId, candidate, connectionId } = data;

    // Basic sanity: candidate must look like an ICE candidate
    if (!candidate || typeof candidate.candidate !== 'string') {
      return;
    }

    const senderInfo = socketInfo.get(socket.id);
    const senderId = senderInfo?.userId || data.senderId;

    let targetSocketId: string | null = null;

    if (targetId === 'host') {
      targetSocketId = findHostSocketId(roomId);
    } else {
      targetSocketId = findSocketIdForViewer(roomId, targetId);
    }

    if (!targetSocketId) {
      // Target may have disconnected — not an error
      return;
    }

    io.to(targetSocketId).emit(WEBRTC_EVENTS.ICE_CANDIDATE, {
      senderId,
      candidate,
      connectionId,
    });
  });

  // ── Host → All Viewers: Stream is starting ─────────────────────────────────
  socket.on(WEBRTC_EVENTS.HOST_STREAM_READY, async (data: {
    roomId: string;
    mediaName: string;
    mediaDuration: number | null;
  }) => {
    const { roomId, mediaName, mediaDuration } = data;

    const hostInfo = socketInfo.get(socket.id);
    const userId = hostInfo?.userId;
    if (userId) {
      const role = hostInfo?.role || (await RoomRepository.getUserRoomRole(roomId, userId));
      if (role === 'viewer') {
        socket.emit('webrtc:error', { message: 'Only host/co-host can signal stream ready.' });
        return;
      }
    }

    console.log(`[WebRTC] Host stream ready in room ${roomId}: "${mediaName}" (${mediaDuration}s)`);

    // Store media metadata in room state (no file bytes)
    await RoomRepository.updateRoomState(roomId, {
      mediaName,
      mediaDuration: mediaDuration ?? undefined,
      mediaSourceType: 'local',
    });

    // Broadcast to all room members
    socket.to(roomId).emit(WEBRTC_EVENTS.HOST_STREAM_READY, {
      mediaName,
      mediaDuration,
    });
  });

  // ── Host → All Viewers: Stream ended ──────────────────────────────────────
  socket.on(WEBRTC_EVENTS.HOST_STREAM_ENDED, async (data: { roomId: string }) => {
    const { roomId } = data;

    const endedInfo = socketInfo.get(socket.id);
    const userId = endedInfo?.userId;
    if (userId) {
      const role = endedInfo?.role || (await RoomRepository.getUserRoomRole(roomId, userId));
      if (role === 'viewer') return;
    }

    console.log(`[WebRTC] Host stream ended in room ${roomId}`);

    // Update room state
    await RoomRepository.updateRoomState(roomId, { isPlaying: false, mediaSourceType: undefined });

    socket.to(roomId).emit(WEBRTC_EVENTS.HOST_STREAM_ENDED, {});
  });
}
