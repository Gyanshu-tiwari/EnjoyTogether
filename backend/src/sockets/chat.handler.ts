import type { Socket, Server } from 'socket.io';
import { ChatRepository } from '../repositories/chat.repository.js';
import { SOCKET_EVENTS } from '../constants/socketEvents.js';

export const registerChatHandlers = (io: Server, socket: Socket) => {
  // 💬 Listen for new watch-party messages
  socket.on(
    SOCKET_EVENTS.ROOM_CHAT_MSG,
    async (data: { roomId: string; message: string }) => {
      const { roomId, message } = data;
      const cleanRoomId = String(roomId).trim();
      const senderPseudonym = `Peer-${socket.id.substring(0, 4)}`;

      console.log(`💬 Message relayed in ${cleanRoomId}: ${message}`);

      // Save message in repository
      await ChatRepository.saveMessage(cleanRoomId, senderPseudonym, message);

      // Ship the comment out to all peer clients in the room
      socket.to(cleanRoomId).emit(SOCKET_EVENTS.UPDATE_ROOM_CHAT, {
        user: senderPseudonym,
        text: message,
      });
    }
  );
};
