import type { Socket, Server } from 'socket.io';
import { ChatRepository } from '../repositories/chat.repository.js';
import { SOCKET_EVENTS } from '../constants/socketEvents.js';

export const registerChatHandlers = (io: Server, socket: Socket) => {
  socket.on(
    SOCKET_EVENTS.ROOM_CHAT_MSG,
    async (data: { roomId: string; message: string }) => {
      const { roomId, message } = data;
      const cleanRoomId = String(roomId).trim();
      const userId = (socket as any).userId || (socket as any).user?.id || 'guest';
      const senderPseudonym = (socket as any).user?.name || `Peer-${socket.id.substring(0, 4)}`;

      console.log(`💬 Message relayed in ${cleanRoomId} from ${senderPseudonym}: ${message}`);

      await ChatRepository.saveMessage(cleanRoomId, senderPseudonym, message);

      socket.to(cleanRoomId).emit(SOCKET_EVENTS.UPDATE_ROOM_CHAT, {
        userId,
        user: senderPseudonym,
        text: message,
      });
    }
  );
};
