import { supabase, isSupabaseDisabled, handleSharedDbError } from '../config/supabase.js';

export interface ChatMessage {
  id: string;
  roomId: string;
  user: string;
  text: string;
  timestamp: number;
}

// In-memory fallback for when Supabase is unavailable
const inMemoryChatLogs: Record<string, ChatMessage[]> = {};

export class ChatRepository {
  static async saveMessage(roomId: string, user: string, text: string): Promise<ChatMessage> {
    const cleanRoomId = roomId.trim();
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      roomId: cleanRoomId,
      user,
      text,
      timestamp: Date.now(),
    };

    if (!inMemoryChatLogs[cleanRoomId]) {
      inMemoryChatLogs[cleanRoomId] = [];
    }
    inMemoryChatLogs[cleanRoomId].push(message);

    // Cap in-memory log at 500 messages per room to avoid unbounded memory growth
    if (inMemoryChatLogs[cleanRoomId].length > 500) {
      inMemoryChatLogs[cleanRoomId] = inMemoryChatLogs[cleanRoomId].slice(-500);
    }

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { error } = await supabase
          .from('chats')
          .insert({
            id: message.id,
            room_id: message.roomId,
            user_name: message.user,
            message_text: message.text,
            created_at: new Date(message.timestamp).toISOString(),
          });
        if (error) throw error;
      } catch (err) {
        handleSharedDbError(err, `save chat message in room ${cleanRoomId}`);
      }
    }

    return message;
  }

  static async getMessageHistory(roomId: string): Promise<ChatMessage[]> {
    const cleanRoomId = roomId.trim();

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('chats')
          .select('id, room_id, user_name, message_text, created_at')
          .eq('room_id', cleanRoomId)
          .order('created_at', { ascending: true })
          .limit(500);

        if (error) {
          handleSharedDbError(error, `fetch message history for ${cleanRoomId}`);
        } else if (data) {
          return data.map((d) => ({
            id: d.id,
            roomId: d.room_id,
            user: d.user_name,
            text: d.message_text,
            timestamp: new Date(d.created_at).getTime(),
          }));
        }
      } catch (err) {
        handleSharedDbError(err, `fetch message history for ${cleanRoomId}`);
      }
    }

    return inMemoryChatLogs[cleanRoomId] || [];
  }
}
