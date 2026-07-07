import { supabase, isSupabaseDisabled, handleSharedDbError } from '../config/supabase.js';

export interface RoomState {
  isPlaying: boolean;
  position: number;
  lastUpdated: number;
  streamUrl?: string | undefined;
}

export interface RoomMetadata {
  host_id: string;
  movie_url: string;
  is_active: boolean;
}

// In-memory store fallbacks for localized environment or offline testing
const inMemoryRoomStates: Record<string, RoomState> = {};
const inMemoryRoomMetadata: Record<string, RoomMetadata> = {
  'enjoy-together-main': {
    host_id: 'default-host-id',
    movie_url: 'http://localhost:5000/api/video/hls-local/master_party.m3u8',
    is_active: false,
  },
};

// Startup warning: in-memory state is not persisted across server restarts.
if (!supabase) {
  console.warn('⚠️  [RoomRepository] Running in-memory mode. All room data will be lost on server restart.');
}

export class RoomRepository {
  static async getRoomState(roomId: string): Promise<RoomState> {
    const cleanRoomId = roomId.trim();
    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('rooms')
          .select('is_playing, position, last_updated, stream_url')
          .eq('id', cleanRoomId)
          .single();

        if (error) {
          handleSharedDbError(error, `get room state for ${cleanRoomId}`);
        } else if (data) {
          return {
            isPlaying: data.is_playing,
            position: data.position,
            lastUpdated: new Date(data.last_updated).getTime(),
            streamUrl: data.stream_url || undefined,
          };
        }
      } catch (err) {
        handleSharedDbError(err, `get room state for ${cleanRoomId}`);
      }
    }

    if (!inMemoryRoomStates[cleanRoomId]) {
      const meta = inMemoryRoomMetadata[cleanRoomId];
      inMemoryRoomStates[cleanRoomId] = {
        isPlaying: false,
        position: 0,
        lastUpdated: Date.now(),
        streamUrl: meta ? meta.movie_url : undefined,
      };
    }
    return inMemoryRoomStates[cleanRoomId]!;
  }

  static async updateRoomState(roomId: string, updates: Partial<RoomState>): Promise<RoomState> {
    const cleanRoomId = roomId.trim();
    const currentState = await this.getRoomState(cleanRoomId);
    const updatedState: RoomState = {
      ...currentState,
      ...updates,
      lastUpdated: Date.now(),
    };

    inMemoryRoomStates[cleanRoomId] = updatedState;

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { error } = await supabase
          .from('rooms')
          .upsert({
            id: cleanRoomId,
            is_playing: updatedState.isPlaying,
            position: updatedState.position,
            last_updated: new Date(updatedState.lastUpdated).toISOString(),
            stream_url: updatedState.streamUrl || null,
          });
        if (error) throw error;
      } catch (err) {
        handleSharedDbError(err, `update room state for ${cleanRoomId}`);
      }
    }

    return updatedState;
  }

  static async setSessionActiveStatus(roomId: string, isActive: boolean): Promise<void> {
    const cleanRoomId = roomId.trim();
    console.log(`📡 RoomRepository: Setting room ${cleanRoomId} isActive → ${isActive}`);

    if (!inMemoryRoomMetadata[cleanRoomId]) {
      inMemoryRoomMetadata[cleanRoomId] = {
        host_id: 'default-host-id',
        movie_url: 'http://localhost:5000/api/video/hls-local/master_party.m3u8',
        is_active: isActive,
      };
    } else {
      inMemoryRoomMetadata[cleanRoomId].is_active = isActive;
    }

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { error } = await supabase
          .from('rooms')
          .update({ is_active: isActive })
          .eq('id', cleanRoomId);
        if (error) throw error;
      } catch (err) {
        handleSharedDbError(err, `update is_active for room ${cleanRoomId}`);
      }
    }
  }

  static async getRoomMetadata(roomId: string): Promise<RoomMetadata> {
    const cleanRoomId = roomId.trim();
    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('rooms')
          .select('host_id, movie_url, stream_url, is_active')
          .eq('id', cleanRoomId)
          .single();
        if (error) {
          handleSharedDbError(error, `fetch metadata for room ${cleanRoomId}`);
        } else if (data) {
          return {
            host_id: data.host_id || 'default-host-id',
            movie_url: data.movie_url || data.stream_url || '',
            is_active: !!data.is_active,
          };
        }
      } catch (err) {
        handleSharedDbError(err, `fetch metadata for room ${cleanRoomId}`);
      }
    }

    if (!inMemoryRoomMetadata[cleanRoomId]) {
      inMemoryRoomMetadata[cleanRoomId] = {
        host_id: 'default-host-id',
        movie_url: 'http://localhost:5000/api/video/hls-local/master_party.m3u8',
        is_active: false,
      };
    }
    return inMemoryRoomMetadata[cleanRoomId]!;
  }

  static async createRoom(roomId: string, hostId: string, movieUrl: string): Promise<RoomMetadata> {
    const cleanRoomId = roomId.trim();
    const metadata: RoomMetadata = {
      host_id: hostId || 'default-host-id',
      movie_url: movieUrl || 'http://localhost:5000/api/video/hls-local/master_party.m3u8',
      is_active: false,
    };

    inMemoryRoomMetadata[cleanRoomId] = metadata;

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { error } = await supabase
          .from('rooms')
          .insert({
            id: cleanRoomId,
            host_id: metadata.host_id,
            movie_url: metadata.movie_url,
            stream_url: metadata.movie_url,
            is_active: false,
          });
        if (error) throw error;
      } catch (err) {
        handleSharedDbError(err, `insert new room ${cleanRoomId}`);
      }
    }

    return metadata;
  }
}
