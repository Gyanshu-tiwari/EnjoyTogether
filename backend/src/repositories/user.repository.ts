import { supabase, isSupabaseDisabled, handleSharedDbError } from '../config/supabase.js';

export interface UserProfile {
  id: string;
  avatarUrl?: string;
  updatedAt?: string;
}

const inMemoryProfiles: Record<string, UserProfile> = {};

export class UserRepository {
  static async updateProfile(userId: string, avatarUrl: string): Promise<UserProfile> {
    const cleanUserId = userId.trim();
    const profile: UserProfile = {
      id: cleanUserId,
      avatarUrl,
      updatedAt: new Date().toISOString(),
    };

    inMemoryProfiles[cleanUserId] = profile;

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { error } = await supabase
          .from('profiles')
          .upsert({
            id: cleanUserId,
            avatar_url: avatarUrl,
            updated_at: profile.updatedAt,
          }, { onConflict: 'id' });
        if (error) throw error;
      } catch (err) {
        handleSharedDbError(err, `updateProfile for user ${cleanUserId}`);
      }
    }

    return profile;
  }

  static async getProfile(userId: string): Promise<UserProfile | null> {
    const cleanUserId = userId.trim();

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, avatar_url, updated_at')
          .eq('id', cleanUserId)
          .single();

        if (!error && data) {
          return {
            id: data.id,
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
