import { supabase } from '@/shared/lib/supabase';
import { apiClient } from '@/shared/api/apiClient';
import { compressAvatar } from '../utils/compressAvatar';

export interface UserProfile {
  id: string;
  avatarUrl?: string;
  updatedAt?: string;
}

/**
 * Compresses the file, uploads the compressed binary directly to the 'avatars' Supabase Storage bucket,
 * retrieves its public CDN URL, and updates both the Express backend database and local Supabase Auth metadata.
 */
export async function uploadAvatar(file: File, userId: string): Promise<string> {
  if (!userId) {
    throw new Error('User ID is required for avatar upload');
  }

  // 1. Compress the file client-side
  const compressedFile = await compressAvatar(file);

  // 2. Upload directly to Supabase Storage 'avatars' bucket
  const fileKey = `${userId}/avatar.webp`;
  
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(fileKey, compressedFile, {
      cacheControl: '0', // disable caching to make updates immediate
      upsert: true,
      contentType: 'image/webp',
    });

  if (uploadError) {
    console.error('[profileApi] Supabase Storage upload failed:', uploadError);
    throw new Error(`Cloud storage upload failed: ${uploadError.message}. Make sure the 'avatars' bucket exists and is public.`);
  }

  // 3. Retrieve public CDN URL
  const { data } = supabase.storage
    .from('avatars')
    .getPublicUrl(fileKey);

  const publicUrl = data?.publicUrl;
  if (!publicUrl) {
    throw new Error('Failed to retrieve public CDN URL for the uploaded file');
  }

  // 4. Update the Express backend DB via authenticated route
  await apiClient.patch('/api/users/profile', { avatarUrl: publicUrl });

  // 5. Keep Supabase Auth metadata synchronized so frontend updates reactively
  await supabase.auth.updateUser({
    data: { avatar_url: publicUrl },
  });

  return publicUrl;
}

/**
 * Fetches the user profile from the Express backend
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
