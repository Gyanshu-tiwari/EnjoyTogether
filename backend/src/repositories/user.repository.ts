import { supabase, isSupabaseDisabled, handleSharedDbError } from '../config/supabase.js';
import { AppError } from '../utils/appError.js';
import { FriendCodeRepository } from './friendCode.repository.js';

export interface UserProfile {
  id: string;
  username?: string;
  avatarUrl?: string;
  friendCode?: string;
  updatedAt?: string;
}

const inMemoryProfiles: Record<string, UserProfile> = {};

export class UserRepository {
  static clearInMemoryProfiles(): void {
    for (const key of Object.keys(inMemoryProfiles)) {
      delete inMemoryProfiles[key];
    }
  }

  static getInMemoryProfilesCount(): number {
    return Object.keys(inMemoryProfiles).length;
  }

  static searchInMemoryProfiles(query: string, excludeId?: string): UserProfile[] {
    const lower = query.trim().toLowerCase();
    if (!lower) return [];
    return Object.values(inMemoryProfiles).filter(
      (p) => p.id !== excludeId && p.username && p.username.toLowerCase().includes(lower)
    );
  }

  static async syncProfile(userId: string, updates: { username?: string; avatarUrl?: string }): Promise<UserProfile> {
    const cleanUserId = userId.trim();
    const existing = inMemoryProfiles[cleanUserId] || { id: cleanUserId };

    // Ensure registered user has a permanent 6-digit friend code
    let friendCode = existing.friendCode;
    if (!friendCode) {
      try {
        friendCode = await FriendCodeRepository.allocateRegisteredCode(cleanUserId);
      } catch (err) {
        console.warn(`[UserRepository] Friend code allocation deferred for ${cleanUserId}:`, err);
      }
    }

    const profile: UserProfile = {
      ...existing,
      ...updates,
      id: cleanUserId,
      ...(friendCode && { friendCode }),
      updatedAt: new Date().toISOString(),
    };
    inMemoryProfiles[cleanUserId] = profile;

    if (supabase && !isSupabaseDisabled()) {
      try {
        const upsertPayload: Record<string, unknown> = {
          id: cleanUserId,
          updated_at: profile.updatedAt,
        };
        if (updates.username !== undefined) upsertPayload['username'] = updates.username;
        if (updates.avatarUrl !== undefined) upsertPayload['avatar_url'] = updates.avatarUrl;
        if (friendCode !== undefined) upsertPayload['friend_code'] = friendCode;

        const { error } = await supabase
          .from('profiles')
          .upsert(upsertPayload, { onConflict: 'id' });
        if (error) throw error;
      } catch (err) {
        handleSharedDbError(err, `syncProfile for user ${cleanUserId}`);
      }
    }
    return profile;
  }

  static async updateProfile(userId: string, avatarUrl: string): Promise<UserProfile> {
    return this.syncProfile(userId, { avatarUrl });
  }

  static async getProfile(userId: string): Promise<UserProfile | null> {
    const cleanUserId = userId.trim();
    if (!cleanUserId) return null;

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, username, avatar_url, friend_code, updated_at')
          .eq('id', cleanUserId)
          .maybeSingle();

        if (error) {
          handleSharedDbError(error, `getProfile for user ${cleanUserId}`);
          throw new AppError('Authoritative user data store is currently unavailable.', 503);
        }

        if (data) {
          let friendCode = data.friend_code;
          if (!friendCode) {
            // Safe backfill for existing registered account
            try {
              friendCode = await FriendCodeRepository.allocateRegisteredCode(cleanUserId);
            } catch (err) {
              console.warn(`[UserRepository] Code backfill deferred for ${cleanUserId}:`, err);
            }
          }

          return {
            id: data.id,
            username: data.username,
            avatarUrl: data.avatar_url,
            friendCode: friendCode || undefined,
            updatedAt: data.updated_at,
          };
        }

        // Profile row does not exist yet for this authenticated registered user.
        // Auto-provision profile with an authoritative 6-digit friend code.
        let friendCode = await FriendCodeRepository.getRegisteredUserCode(cleanUserId);
        if (!friendCode) {
          try {
            friendCode = await FriendCodeRepository.allocateRegisteredCode(cleanUserId);
          } catch (err) {
            console.warn(`[UserRepository] Initial code allocation deferred for ${cleanUserId}:`, err);
          }
        }

        const now = new Date().toISOString();
        const newProfile: UserProfile = {
          id: cleanUserId,
          ...(friendCode && { friendCode }),
          updatedAt: now,
        };

        try {
          await supabase
            .from('profiles')
            .upsert({
              id: cleanUserId,
              friend_code: friendCode || null,
              updated_at: now,
            }, { onConflict: 'id' });
        } catch (upsertErr) {
          console.warn(`[UserRepository] Initial profile upsert deferred for ${cleanUserId}:`, upsertErr);
        }

        return newProfile;
      } catch (err) {
        if (err instanceof AppError) throw err;
        handleSharedDbError(err, `getProfile for user ${cleanUserId}`);
        throw new AppError('Authoritative user data store is currently unavailable.', 503);
      }
    }

    let inMem = inMemoryProfiles[cleanUserId];
    if (!inMem) {
      inMem = { id: cleanUserId };
      inMemoryProfiles[cleanUserId] = inMem;
    }
    if (!inMem.friendCode) {
      try {
        inMem.friendCode = await FriendCodeRepository.allocateRegisteredCode(cleanUserId);
      } catch {
        // ignore in memory
      }
    }
    return inMem;
  }
}
