import { supabase, isSupabaseDisabled, handleSharedDbError } from '../config/supabase.js';

export type FriendshipStatus = 'NONE' | 'PENDING' | 'ACCEPTED' | 'REJECTED';
export type FriendshipAction = 'ACCEPT' | 'REJECT';

export interface Friendship {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendshipStatus;
  createdAt?: string;
}

export interface UserSearchResult {
  id: string;
  username: string;
  avatarUrl?: string | undefined;
  friendshipStatus: FriendshipStatus;
  friendshipId?: string | undefined;
}

// ─── In-memory fallback for when Supabase is unavailable ──────────────────────
const inMemoryFriendships: Map<string, Friendship> = new Map();

export class FriendRepository {

  static async searchUsers(query: string, requesterId: string): Promise<UserSearchResult[]> {
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) return [];

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .ilike('username', `%${cleanQuery}%`)
          .neq('id', requesterId)
          .limit(20);

        if (error) throw error;
        if (!data) return [];

        const results: UserSearchResult[] = await Promise.all(
          data.map(async (profile) => {
            const status = await this.getFriendshipStatus(requesterId, profile.id);
            return {
              id: profile.id,
              username: profile.username || profile.id,
              avatarUrl: profile.avatar_url,
              friendshipStatus: status.status,
              friendshipId: status.friendshipId,
            };
          })
        );
        return results;
      } catch (err) {
        handleSharedDbError(err, `searchUsers for query "${cleanQuery}"`);
      }
    }

    // In-memory fallback: no persistent user index, return empty
    return [];
  }

  static async getFriendshipStatus(
    userId: string,
    targetId: string
  ): Promise<{ status: FriendshipStatus; friendshipId?: string }> {
    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('friendships')
          .select('id, status, requester_id, addressee_id')
          .or(
            `and(requester_id.eq.${userId},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${userId})`
          )
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        if (!data) return { status: 'NONE' };

        return { status: data.status as FriendshipStatus, friendshipId: data.id };
      } catch (err) {
        handleSharedDbError(err, `getFriendshipStatus ${userId} ↔ ${targetId}`);
      }
    }

    // In-memory fallback
    for (const f of inMemoryFriendships.values()) {
      if (
        (f.requesterId === userId && f.addresseeId === targetId) ||
        (f.requesterId === targetId && f.addresseeId === userId)
      ) {
        return { status: f.status, friendshipId: f.id };
      }
    }
    return { status: 'NONE' };
  }

  static async sendFriendRequest(requesterId: string, addresseeId: string): Promise<Friendship> {
    if (requesterId === addresseeId) {
      throw new Error('Cannot send a friend request to yourself.');
    }

    const existing = await this.getFriendshipStatus(requesterId, addresseeId);
    if (existing.status !== 'NONE') {
      throw new Error(`Friend request already exists with status: ${existing.status}`);
    }

    const newFriendship: Friendship = {
      id: crypto.randomUUID(),
      requesterId,
      addresseeId,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };

    inMemoryFriendships.set(newFriendship.id, newFriendship);

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('friendships')
          .insert({
            requester_id: requesterId,
            addressee_id: addresseeId,
            status: 'PENDING',
          })
          .select('id, requester_id, addressee_id, status, created_at')
          .single();

        if (error) throw error;
        newFriendship.id = data.id;
        inMemoryFriendships.set(newFriendship.id, newFriendship);
      } catch (err) {
        handleSharedDbError(err, `sendFriendRequest ${requesterId} → ${addresseeId}`);
      }
    }

    return newFriendship;
  }

  static async respondToRequest(
    friendshipId: string,
    userId: string,
    action: FriendshipAction
  ): Promise<Friendship> {
    const newStatus = action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';

    if (supabase && !isSupabaseDisabled()) {
      try {
        // Verify user is the addressee
        const { data: existing, error: fetchErr } = await supabase
          .from('friendships')
          .select('id, requester_id, addressee_id, status')
          .eq('id', friendshipId)
          .eq('addressee_id', userId)
          .single();

        if (fetchErr || !existing) {
          throw new Error('Friendship request not found or you are not authorized to respond.');
        }
        if (existing.status !== 'PENDING') {
          throw new Error(`Cannot respond to a request with status: ${existing.status}`);
        }

        const { data, error } = await supabase
          .from('friendships')
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq('id', friendshipId)
          .select('id, requester_id, addressee_id, status, created_at')
          .single();

        if (error) throw error;

        const updated: Friendship = {
          id: data.id,
          requesterId: data.requester_id,
          addresseeId: data.addressee_id,
          status: data.status as FriendshipStatus,
          createdAt: data.created_at,
        };
        inMemoryFriendships.set(updated.id, updated);
        return updated;
      } catch (err) {
        if (err instanceof Error) throw err;
        handleSharedDbError(err, `respondToRequest ${friendshipId}`);
        throw new Error('Failed to respond to friend request.');
      }
    }

    // In-memory fallback
    const f = inMemoryFriendships.get(friendshipId);
    if (!f) throw new Error('Friendship not found.');
    if (f.addresseeId !== userId) throw new Error('Not authorized to respond to this request.');
    f.status = newStatus as FriendshipStatus;
    return f;
  }

  static async getFriends(userId: string): Promise<Friendship[]> {
    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('friendships')
          .select('id, requester_id, addressee_id, status, created_at')
          .eq('status', 'ACCEPTED')
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

        if (error) throw error;
        return (data || []).map((d) => ({
          id: d.id,
          requesterId: d.requester_id,
          addresseeId: d.addressee_id,
          status: d.status as FriendshipStatus,
          createdAt: d.created_at,
        }));
      } catch (err) {
        handleSharedDbError(err, `getFriends for ${userId}`);
      }
    }

    return Array.from(inMemoryFriendships.values()).filter(
      (f) => f.status === 'ACCEPTED' && (f.requesterId === userId || f.addresseeId === userId)
    );
  }

  static async getPendingRequests(userId: string): Promise<Friendship[]> {
    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('friendships')
          .select('id, requester_id, addressee_id, status, created_at')
          .eq('status', 'PENDING')
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

        if (error) throw error;
        return (data || []).map((d) => ({
          id: d.id,
          requesterId: d.requester_id,
          addresseeId: d.addressee_id,
          status: d.status as FriendshipStatus,
          createdAt: d.created_at,
        }));
      } catch (err) {
        handleSharedDbError(err, `getPendingRequests for ${userId}`);
      }
    }

    return Array.from(inMemoryFriendships.values()).filter(
      (f) => f.status === 'PENDING' && (f.requesterId === userId || f.addresseeId === userId)
    );
  }

  static async deleteFriendship(friendshipId: string, userId: string): Promise<void> {
    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data: existing, error: fetchErr } = await supabase
          .from('friendships')
          .select('id, requester_id, addressee_id')
          .eq('id', friendshipId)
          .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
          .maybeSingle();

        if (fetchErr) throw fetchErr;
        if (!existing) throw new Error('Friendship not found or not authorized.');

        const { error } = await supabase
          .from('friendships')
          .delete()
          .eq('id', friendshipId);

        if (error) throw error;
      } catch (err) {
        if (err instanceof Error) throw err;
        handleSharedDbError(err, `deleteFriendship ${friendshipId}`);
        throw new Error('Failed to delete friendship.');
      }
    }

    const f = inMemoryFriendships.get(friendshipId);
    if (f && (f.requesterId === userId || f.addresseeId === userId)) {
      inMemoryFriendships.delete(friendshipId);
    } else {
      throw new Error('Friendship not found or not authorized.');
    }
  }
}
