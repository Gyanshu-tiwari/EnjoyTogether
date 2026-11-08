import { supabase } from '@/shared/lib/supabase';
import { apiClient } from '@/shared/api/apiClient';
import { compressAvatar } from '../utils/compressAvatar';

export interface UserProfile {
  id: string;
  username?: string;
  avatarUrl?: string;
  friendCode?: string;
  updatedAt?: string;
}

/**
 * Uploads an avatar image for either a registered user or a guest.
 * Performs client-side image compression, sends to the backend's authorized endpoint
 * (which validates magic bytes and file limits server-side and persists into Supabase Storage),
 * and syncs local session metadata.
 */
export async function uploadAvatar(
  file: File,
  identity: { userId?: string; guestId?: string; sessionSecret?: string }
): Promise<string> {
  // 1. Client-side compression to WebP (max 400x400)
  const compressedFile = await compressAvatar(file);

  const formData = new FormData();
  formData.append('avatar', compressedFile);

  if (identity.guestId && identity.sessionSecret) {
    // Guest avatar upload endpoint with secret proof of ownership
    formData.append('guestId', identity.guestId);
    const headers: Record<string, string> = {
      'x-guest-secret': identity.sessionSecret,
      'Content-Type': 'multipart/form-data',
    };

    const res = await apiClient.post<{ status: string; data: { avatarUrl: string } }>(
      '/api/guests/avatar',
      formData,
      { headers }
    );
    const avatarUrl = res.data.data.avatarUrl;
    if (typeof window !== 'undefined') {
      localStorage.setItem('et_anon_avatar_url', avatarUrl);
    }
    return avatarUrl;
  }

  // Registered user avatar upload endpoint (authenticated via Bearer JWT in apiClient)
  const res = await apiClient.post<{ status: string; data: { avatarUrl: string } }>(
    '/api/users/avatar',
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    }
  );

  const avatarUrl = res.data.data.avatarUrl;

  // Sync Supabase Auth metadata so components reactively re-render
  try {
    await supabase.auth.updateUser({
      data: { avatar_url: avatarUrl },
    });
  } catch {
    // Non-fatal if Supabase Auth metadata sync deferred
  }

  return avatarUrl;
}

/**
 * Removes the avatar for registered user or guest.
 */
export async function removeAvatar(
  identity: { guestId?: string; sessionSecret?: string }
): Promise<void> {
  if (identity.guestId && identity.sessionSecret) {
    const headers: Record<string, string> = {
      'x-guest-secret': identity.sessionSecret,
    };
    await apiClient.delete('/api/guests/avatar', {
      headers,
      data: { guestId: identity.guestId },
    });
    if (typeof window !== 'undefined') {
      localStorage.removeItem('et_anon_avatar_url');
    }
    return;
  }

  await apiClient.delete('/api/users/avatar');
  try {
    await supabase.auth.updateUser({
      data: { avatar_url: '' },
    });
  } catch {
    // Non-fatal
  }
}

/**
 * Updates editable display name for registered profile.
 */
export async function updateUsername(username: string): Promise<void> {
  await apiClient.patch('/api/users/profile', { username });
  try {
    await supabase.auth.updateUser({
      data: { username },
    });
  } catch {
    // Non-fatal
  }
}

/**
 * Fetches authoritative user profile from Express backend.
 */
export async function fetchProfile(): Promise<UserProfile | null> {
  try {
    const response = await apiClient.get<{ status: string; data: { profile: UserProfile } }>('/api/users/profile');
    return response.data?.data?.profile || null;
  } catch (error) {
    console.error('[profileApi] Failed to fetch profile:', error);
    return null;
  }
}
