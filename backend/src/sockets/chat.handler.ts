import type { Socket, Server } from 'socket.io';
import { ChatRepository } from '../repositories/chat.repository.js';
import { SOCKET_EVENTS } from '../constants/socketEvents.js';

type SocketInfoMap = Map<string, { roomId: string; userId: string; name: string; isHost: boolean; role: string }>;

export const registerChatHandlers = (io: Server, socket: Socket, socketInfo?: SocketInfoMap) => {
  socket.on(
    SOCKET_EVENTS.ROOM_CHAT_MSG,
    async (data: { roomId: string; message: string }) => {
      if (!data || typeof data.roomId !== 'string' || typeof data.message !== 'string') {
        return;
      }

      const cleanRoomId = data.roomId.trim().slice(0, 100);
      const cleanMessage = data.message.trim().slice(0, 1000);
      if (!cleanRoomId || !cleanMessage) return;

      const info = socketInfo?.get(socket.id);
      const userId = (socket as any).userId || (socket as any).user?.id || info?.userId || 'guest';
      const senderPseudonym =
        info?.name ||
        (socket as any).user?.name ||
        ((socket as any).user?.email ? (socket as any).user.email.split('@')[0] : null) ||
        `Peer-${socket.id.substring(0, 4)}`;

      console.log(`💬 Message relayed in ${cleanRoomId} from ${senderPseudonym}: ${cleanMessage}`);

      await ChatRepository.saveMessage(cleanRoomId, senderPseudonym, cleanMessage);

      socket.to(cleanRoomId).emit(SOCKET_EVENTS.UPDATE_ROOM_CHAT, {
        userId,
        user: senderPseudonym,
        text: cleanMessage,
      });
    }
  );
};
