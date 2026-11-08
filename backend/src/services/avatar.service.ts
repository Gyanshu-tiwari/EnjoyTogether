import path from 'path';
import fs from 'fs';
import { supabase, isSupabaseDisabled, handleSharedDbError } from '../config/supabase.js';
import { AppError } from '../utils/appError.js';
import { UserRepository } from '../repositories/user.repository.js';
import { FriendCodeRepository } from '../repositories/friendCode.repository.js';

export interface ImageTypeResult {
  mime: string;
  ext: string;
}

export class AvatarService {
  private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

  /**
   * Validates image magic bytes server-side. Rejects disguised non-images or invalid formats.
   */
  static detectImageType(buffer: Buffer): ImageTypeResult | null {
    if (!buffer || buffer.length < 12) return null;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { mime: 'image/jpeg', ext: 'jpg' };
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return { mime: 'image/png', ext: 'png' };
    }

    // WebP: RIFF [4 bytes] WEBP
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return { mime: 'image/webp', ext: 'webp' };
    }

    return null;
  }

  /**
   * Validates file size and server-side magic byte signatures.
   */
  static validateImageBuffer(buffer: Buffer): ImageTypeResult {
    if (!buffer || buffer.length === 0) {
      throw new AppError('No image file provided.', 400);
    }
    if (buffer.length > this.MAX_FILE_SIZE) {
      throw new AppError(`File exceeds maximum allowed size of 5 MB (${(buffer.length / (1024 * 1024)).toFixed(2)} MB uploaded).`, 400);
    }

    const type = this.detectImageType(buffer);
    if (!type) {
      throw new AppError('Invalid image file content. Only JPEG, PNG, and WebP images are permitted.', 400);
    }

    return type;
  }

  /**
   * Stores avatar binary in Supabase Storage or local static fallback.
   */
  private static async persistToStorage(key: string, buffer: Buffer, mime: string): Promise<string> {
    if (supabase && !isSupabaseDisabled()) {
      try {
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(key, buffer, {
            upsert: true,
            contentType: mime,
            cacheControl: '0',
          });

        if (uploadError) {
          // If bucket didn't exist, try creating it and re-uploading
          if (uploadError.message?.includes('Bucket not found') || (uploadError as any).statusCode === 404) {
            await supabase.storage.createBucket('avatars', { public: true });
            const { error: retryError } = await supabase.storage
              .from('avatars')
              .upload(key, buffer, { upsert: true, contentType: mime, cacheControl: '0' });
            if (retryError) throw retryError;
          } else {
            throw uploadError;
          }
        }

        const { data } = supabase.storage.from('avatars').getPublicUrl(key);
        if (data?.publicUrl) {
          return `${data.publicUrl}?t=${Date.now()}`;
        }
      } catch (err) {
        handleSharedDbError(err, `persistToStorage for ${key}`);
      }
    }

    // Local static fallback for isolated development or when storage is unavailable
    const localDir = path.join(process.cwd(), 'public', 'avatars');
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    const safeFilename = key.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const localPath = path.join(localDir, safeFilename);
    fs.writeFileSync(localPath, buffer);

    return `/api/avatars/local/${safeFilename}?t=${Date.now()}`;
  }

  /**
   * Deletes avatar from storage.
   */
  private static async deleteFromStorage(key: string): Promise<void> {
    if (supabase && !isSupabaseDisabled()) {
      try {
        await supabase.storage.from('avatars').remove([key]);
      } catch (err) {
        handleSharedDbError(err, `deleteFromStorage for ${key}`);
      }
    }

    const localDir = path.join(process.cwd(), 'public', 'avatars');
    const safeFilename = key.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const localPath = path.join(localDir, safeFilename);
    if (fs.existsSync(localPath)) {
      try {
        fs.unlinkSync(localPath);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Uploads and persists avatar for an authenticated registered user.
   */
  static async uploadUserAvatar(userId: string, buffer: Buffer): Promise<string> {
    const cleanUserId = userId.trim();
    if (!cleanUserId) throw new AppError('Valid user identifier required.', 400);

    const { mime, ext } = this.validateImageBuffer(buffer);
    const key = `users/${cleanUserId}/avatar.${ext}`;
    const avatarUrl = await this.persistToStorage(key, buffer, mime);

    // Persist to profiles
    await UserRepository.syncProfile(cleanUserId, { avatarUrl });
    return avatarUrl;
  }

  /**
   * Removes avatar for an authenticated registered user.
   */
  static async removeUserAvatar(userId: string): Promise<void> {
    const cleanUserId = userId.trim();
    if (!cleanUserId) throw new AppError('Valid user identifier required.', 400);

    for (const ext of ['webp', 'png', 'jpg']) {
      await this.deleteFromStorage(`users/${cleanUserId}/avatar.${ext}`);
    }

    await UserRepository.syncProfile(cleanUserId, { avatarUrl: '' });
  }

  /**
   * Uploads and persists avatar for an authenticated guest session (with secret proof of ownership).
   */
  static async uploadGuestAvatar(guestId: string, secret: string, buffer: Buffer): Promise<string> {
    const cleanGuestId = guestId.trim();
    if (!cleanGuestId) throw new AppError('Valid guest identifier required.', 400);
    if (!secret) throw new AppError('Guest session secret required for proof of ownership.', 403);

    const session = await FriendCodeRepository.getGuestSession(cleanGuestId);
    if (!session || !session.isActive) {
      throw new AppError('Guest session not found or inactive.', 404);
    }
    if (!FriendCodeRepository.verifySecret(secret, session.secretHash)) {
      throw new AppError('Forbidden: Invalid guest session credentials.', 403);
    }

    const { mime, ext } = this.validateImageBuffer(buffer);
    const key = `guests/${cleanGuestId}/avatar.${ext}`;
    const avatarUrl = await this.persistToStorage(key, buffer, mime);

    FriendCodeRepository.updateGuestAvatar(cleanGuestId, avatarUrl);

    if (supabase && !isSupabaseDisabled()) {
      try {
        await supabase
          .from('guest_sessions')
          .update({ avatar_url: avatarUrl })
          .eq('id', cleanGuestId);
      } catch (err) {
        console.warn(`[AvatarService] guest_sessions avatar_url column update deferred for ${cleanGuestId}:`, err);
      }
    }

    return avatarUrl;
  }

  /**
   * Removes avatar for an authenticated guest session.
   */
  static async removeGuestAvatar(guestId: string, secret: string): Promise<void> {
    const cleanGuestId = guestId.trim();
    if (!cleanGuestId) throw new AppError('Valid guest identifier required.', 400);
    if (!secret) throw new AppError('Guest session secret required for proof of ownership.', 403);

    const session = await FriendCodeRepository.getGuestSession(cleanGuestId);
    if (!session || !session.isActive) {
      throw new AppError('Guest session not found or inactive.', 404);
    }
    if (!FriendCodeRepository.verifySecret(secret, session.secretHash)) {
      throw new AppError('Forbidden: Invalid guest session credentials.', 403);
    }

    for (const ext of ['webp', 'png', 'jpg']) {
      await this.deleteFromStorage(`guests/${cleanGuestId}/avatar.${ext}`);
    }

    FriendCodeRepository.updateGuestAvatar(cleanGuestId, null);

    if (supabase && !isSupabaseDisabled()) {
      try {
        await supabase
          .from('guest_sessions')
          .update({ avatar_url: null })
          .eq('id', cleanGuestId);
      } catch {
        // ignore
      }
    }
  }
}
