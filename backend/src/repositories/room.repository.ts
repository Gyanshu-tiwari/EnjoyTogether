import { supabase, isSupabaseDisabled, handleSharedDbError } from '../config/supabase.js';

// ─── Type Definitions ──────────────────────────────────────────────────────
export type WatchPartyRole = 'host' | 'co-host' | 'viewer';

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

// ─── In-memory fallbacks (offline / no-Supabase mode) ─────────────────────
const inMemoryRoomStates: Record<string, RoomState> = {};
const inMemoryRoomMetadata: Record<string, RoomMetadata> = {
  'enjoy-together-main': {
    host_id: 'default-host-id',
    movie_url: `${process.env.BACKEND_URL || ''}/api/video/hls-local/master_party.m3u8`,
    is_active: false,
  },
};
/** In-memory role store: { [roomId:userId]: role } */
const inMemoryRoleStore: Record<string, WatchPartyRole> = {};

if (!supabase) {
  console.warn('⚠️  [RoomRepository] Running in-memory mode. All room data will be lost on server restart.');
}

// ─── RoomRepository ─────────────────────────────────────────────────────────
export class RoomRepository {

  // ── RBAC ──────────────────────────────────────────────────────────────────

  /**
   * Assign the 'host' role to a user for a given room.
   * Called immediately after a room is created / a video is uploaded.
   */
  static async assignRoomHost(roomId: string, userId: string): Promise<void> {
    const cleanRoomId = roomId.trim();
    const cleanUserId = userId.trim();
    const key = `${cleanRoomId}:${cleanUserId}`;
    inMemoryRoleStore[key] = 'host';

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { error } = await supabase
          .from('room_members')
          .upsert(
            { room_id: cleanRoomId, user_id: cleanUserId, role: 'host' },
            { onConflict: 'room_id,user_id' }
          );
        if (error) throw error;
      } catch (err) {
        handleSharedDbError(err, `assignRoomHost for room ${cleanRoomId}, user ${cleanUserId}`);
      }
    }
  }

  /**
   * Update the RBAC role for a user within a room.
   */
  static async updateUserRoomRole(roomId: string, userId: string, newRole: WatchPartyRole): Promise<void> {
    const cleanRoomId = roomId.trim();
    const cleanUserId = userId.trim();
    const key = `${cleanRoomId}:${cleanUserId}`;
    inMemoryRoleStore[key] = newRole;

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { error } = await supabase
          .from('room_members')
          .update({ role: newRole })
          .eq('room_id', cleanRoomId)
          .eq('user_id', cleanUserId);
        
        if (error) {
          // If update fails because record doesn't exist, we can try to insert it (upsert)
          const { error: upsertError } = await supabase
            .from('room_members')
            .upsert(
              { room_id: cleanRoomId, user_id: cleanUserId, role: newRole },
              { onConflict: 'room_id,user_id' }
            );
          if (upsertError) throw upsertError;
        }
      } catch (err) {
        handleSharedDbError(err, `updateUserRoomRole for room ${cleanRoomId}, user ${cleanUserId}`);
      }
    }
  }

  /**
   * Retrieve the RBAC role for a user within a room.
   * Secure fallback: always returns 'viewer' when no record is found.
   */
  static async getUserRoomRole(roomId: string, userId: string): Promise<WatchPartyRole> {
    const cleanRoomId = roomId.trim();
    const cleanUserId = userId.trim();

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('room_members')
          .select('role')
          .eq('room_id', cleanRoomId)
          .eq('user_id', cleanUserId)
          .single();

        if (!error && data?.role) {
          return data.role as WatchPartyRole;
        }
      } catch (err) {
        handleSharedDbError(err, `getUserRoomRole for room ${cleanRoomId}, user ${cleanUserId}`);
      }
    }

    // In-memory fallback: check role store, then compare to host_id as safety net
    const key = `${cleanRoomId}:${cleanUserId}`;
    if (inMemoryRoleStore[key]) return inMemoryRoleStore[key]!;

    const meta = inMemoryRoomMetadata[cleanRoomId];
    if (meta && meta.host_id === cleanUserId) return 'host';

    return 'viewer';
  }

  // ── Room State ─────────────────────────────────────────────────────────────

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

  // ── Room Metadata & Lifecycle ──────────────────────────────────────────────

  static async setSessionActiveStatus(roomId: string, isActive: boolean): Promise<void> {
    const cleanRoomId = roomId.trim();
    console.log(`📡 RoomRepository: Setting room ${cleanRoomId} isActive → ${isActive}`);

    if (!inMemoryRoomMetadata[cleanRoomId]) {
      inMemoryRoomMetadata[cleanRoomId] = {
        host_id: 'default-host-id',
        movie_url: `${process.env.BACKEND_URL || ''}/api/video/hls-local/master_party.m3u8`,
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
        movie_url: `${process.env.BACKEND_URL || ''}/api/video/hls-local/master_party.m3u8`,
        is_active: false,
      };
    }
    return inMemoryRoomMetadata[cleanRoomId]!;
  }

  static async createRoom(roomId: string, hostId: string, movieUrl: string): Promise<RoomMetadata> {
    const cleanRoomId = roomId.trim();
    const cleanHostId = hostId.trim() || 'default-host-id';
    const metadata: RoomMetadata = {
      host_id: cleanHostId,
      movie_url: movieUrl || `${process.env.BACKEND_URL || ''}/api/video/hls-local/master_party.m3u8`,
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

    // Always assign host role on creation
    await this.assignRoomHost(cleanRoomId, cleanHostId);

    return metadata;
  }
}
