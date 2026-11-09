import { supabase, isSupabaseDisabled, handleSharedDbError } from '../config/supabase.js';
import { UserRepository } from './user.repository.js';
import { FriendCodeRepository } from './friendCode.repository.js';
import { AppError } from '../utils/appError.js';

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
  friendCode?: string | undefined;
  identityType?: 'REGISTERED' | 'GUEST';
  isGuest?: boolean;
  friendshipStatus: FriendshipStatus;
  friendshipId?: string | undefined;
}

// ─── In-memory fallback for when Supabase is unavailable ──────────────────────
const inMemoryFriendships: Map<string, Friendship> = new Map();

export class FriendRepository {
  static getInMemoryFriendshipsCount(): number {
    return inMemoryFriendships.size;
  }

  static clearInMemoryFriendships(): void {
    inMemoryFriendships.clear();
  }

  static async searchUsers(query: string, requesterId: string): Promise<UserSearchResult[]> {
    const rawQuery = (query || '').trim().replace(/^@/, '');
    if (!rawQuery) return [];

    // 1. Exact 6-digit Friend Code lookup (preserves leading zeros)
    if (/^\d{6}$/.test(rawQuery)) {
      const codeRecord = await FriendCodeRepository.lookupCode(rawQuery);
      if (!codeRecord || codeRecord.identityId === requesterId) {
        return [];
      }

      if (codeRecord.identityType === 'REGISTERED') {
        const profile = await UserRepository.getProfile(codeRecord.identityId);
        if (!profile) return [];

        const status = await this.getFriendshipStatus(requesterId, profile.id);
        return [
          {
            id: profile.id,
            username: profile.username || profile.id,
            avatarUrl: profile.avatarUrl,
            friendCode: codeRecord.code,
            identityType: 'REGISTERED',
            isGuest: false,
            friendshipStatus: status.status,
            friendshipId: status.friendshipId,
          },
        ];
      }

      // Guest identity
      const guestSession = await FriendCodeRepository.getGuestSession(codeRecord.identityId);
      return [
        {
          id: codeRecord.identityId,
          username: `Guest_${codeRecord.code}`,
          avatarUrl: guestSession?.avatarUrl || undefined,
          friendCode: codeRecord.code,
          identityType: 'GUEST',
          isGuest: true,
          friendshipStatus: 'NONE',
        },
      ];
    }

    // 2. Standard username search (registered users only)
    const cleanQuery = rawQuery.toLowerCase();
    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, username, avatar_url, friend_code')
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
              friendCode: profile.friend_code,
              identityType: 'REGISTERED' as const,
              isGuest: false,
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

    // In-memory fallback: query registered inMemoryProfiles
    const matchingProfiles = UserRepository.searchInMemoryProfiles(cleanQuery, requesterId);
    const results: UserSearchResult[] = await Promise.all(
      matchingProfiles.map(async (profile) => {
        const status = await this.getFriendshipStatus(requesterId, profile.id);
        return {
          id: profile.id,
          username: profile.username || profile.id,
          avatarUrl: profile.avatarUrl,
          friendCode: profile.friendCode,
          identityType: 'REGISTERED' as const,
          isGuest: false,
          friendshipStatus: status.status,
          friendshipId: status.friendshipId,
        };
      })
    );
    return results;
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
    const cleanRequesterId = (requesterId || '').trim();
    const cleanAddresseeId = (addresseeId || '').trim();

    if (!cleanRequesterId || !cleanAddresseeId) {
      throw new AppError('Both requester and recipient identifiers are required.', 400);
    }

    // 1. Preserve self-request check
    if (cleanRequesterId === cleanAddresseeId) {
      throw new AppError('Cannot send a friend request to yourself.', 400);
    }

    // 2. Explicit format check: reject anonymous/guest formatted IDs immediately
    const isAnonymousGuestId = (id: string): boolean => {
      const lower = id.toLowerCase();
      return (
        lower.startsWith('anon_') ||
        lower.startsWith('guest_') ||
        lower === 'anonymous-user' ||
        lower === 'guest'
      );
    };

    if (isAnonymousGuestId(cleanRequesterId)) {
      throw new AppError('Anonymous guests cannot send friend requests. Please sign in or create an account.', 400);
    }

    if (isAnonymousGuestId(cleanAddresseeId)) {
      throw new AppError('Cannot send friend request to an anonymous guest.', 400);
    }

    // 3. Authoritative verification: both users MUST exist as registered profiles
    const [requesterProfile, addresseeProfile] = await Promise.all([
      UserRepository.getProfile(cleanRequesterId),
      UserRepository.getProfile(cleanAddresseeId),
    ]);

    if (!requesterProfile) {
      throw new AppError('Requester account is not a valid registered user profile.', 400);
    }

    if (!addresseeProfile) {
      throw new AppError('Recipient user does not exist or is not a registered user.', 400);
    }

    // 4. Duplicate request check
    const existing = await this.getFriendshipStatus(cleanRequesterId, cleanAddresseeId);
    if (existing.status !== 'NONE') {
      throw new AppError(`Friend request already exists with status: ${existing.status}`, 400);
    }

    const newFriendship: Friendship = {
      id: crypto.randomUUID(),
      requesterId: cleanRequesterId,
      addresseeId: cleanAddresseeId,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };

    // 5. Database insertion with fail-safe error handling
    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('friendships')
          .insert({
            requester_id: cleanRequesterId,
            addressee_id: cleanAddresseeId,
            status: 'PENDING',
          })
          .select('id, requester_id, addressee_id, status, created_at')
          .single();

        if (error) {
          handleSharedDbError(error, `sendFriendRequest ${cleanRequesterId} → ${cleanAddresseeId}`);
          throw new AppError('Failed to record friendship in database.', 500);
        }

        newFriendship.id = data.id;
        inMemoryFriendships.set(newFriendship.id, newFriendship);
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Database operation failed while recording friend request.', 500);
      }
    } else {
      inMemoryFriendships.set(newFriendship.id, newFriendship);
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
