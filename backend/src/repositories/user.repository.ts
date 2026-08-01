import { supabase, isSupabaseDisabled, handleSharedDbError } from '../config/supabase.js';

export interface UserProfile {
  id: string;
  username?: string;
  avatarUrl?: string;
  updatedAt?: string;
}

const inMemoryProfiles: Record<string, UserProfile> = {};

export class UserRepository {
  static async syncProfile(userId: string, updates: { username?: string; avatarUrl?: string }): Promise<UserProfile> {
    const cleanUserId = userId.trim();
    const existing = inMemoryProfiles[cleanUserId] || { id: cleanUserId };
    const profile: UserProfile = {
      ...existing,
      ...updates,
      id: cleanUserId,
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

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, username, avatar_url, updated_at')
          .eq('id', cleanUserId)
          .single();

        if (!error && data) {
          return {
            id: data.id,
            username: data.username,
            avatarUrl: data.avatar_url,
            updatedAt: data.updated_at,
          };
        }
      } catch (err) {
        handleSharedDbError(err, `getProfile for user ${cleanUserId}`);
      }
    }
    return inMemoryProfiles[cleanUserId] || null;
  }
}
