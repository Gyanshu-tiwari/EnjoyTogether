import crypto from 'crypto';
import { supabase, isSupabaseDisabled, handleSharedDbError } from '../config/supabase.js';
import { AppError } from '../utils/appError.js';

export type IdentityType = 'REGISTERED' | 'GUEST';

export interface FriendCodeRecord {
  code: string;
  identityId: string;
  identityType: IdentityType;
  createdAt: string;
  expiresAt: string | null;
  isActive: boolean;
  revokedAt: string | null;
}

export interface GuestSessionRecord {
  id: string; // anon_...
  friendCode: string;
  secretHash: string; // SHA-256 hash of secret
  avatarUrl?: string | null;
  createdAt: string;
  expiresAt: string;
  isActive: boolean;
  revokedAt: string | null;
}

// Configurable guest TTL (default 24 hours)
export const DEFAULT_GUEST_TTL_HOURS = Number(process.env.GUEST_SESSION_TTL_HOURS) || 24;
const MAX_ALLOCATION_RETRIES = 10;

// Unified In-memory registries (synchronously enforcing cross-store uniqueness in localized mode)
const inMemoryFriendCodes: Map<string, FriendCodeRecord> = new Map();
const inMemoryGuestSessions: Map<string, GuestSessionRecord> = new Map();

export class FriendCodeRepository {
  /** Test inspection helper */
  static clearInMemoryRegistry(): void {
    inMemoryFriendCodes.clear();
    inMemoryGuestSessions.clear();
  }

  /** Test count helper */
  static getInMemoryCodesCount(): number {
    return inMemoryFriendCodes.size;
  }

  /** Cryptographic secret helpers */
  static generateSessionSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  static hashSecret(secret: string): string {
    return crypto.createHash('sha256').update(secret).digest('hex');
  }

  static verifySecret(secret: string | undefined, secretHash: string | undefined): boolean {
    if (!secret || !secretHash) return false;
    const computed = this.hashSecret(secret);
    try {
      const a = Buffer.from(computed, 'hex');
      const b = Buffer.from(secretHash, 'hex');
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /** Exactly 6 decimal digits with leading zeros preserved */
  static isValidCodeFormat(code: string): boolean {
    return /^\d{6}$/.test((code || '').trim());
  }

  /** Generate random 6-digit decimal string [000000 - 999999] */
  static generateRandomCode(): string {
    return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  }

  /**
   * Allocate permanent 6-digit code for a registered user.
   * Concurrency-safe, idempotent, with bounded collision retries.
   */
  static async allocateRegisteredCode(userId: string): Promise<string> {
    const cleanUserId = userId.trim();
    if (!cleanUserId) {
      throw new AppError('Valid user identifier required for friend code allocation.', 400);
    }

    // 1. Check if user already owns an active code
    const existingCode = await this.getRegisteredUserCode(cleanUserId);
    if (existingCode) return existingCode;

    // Fail closed in production if authoritative store is offline
    if (process.env.NODE_ENV === 'production' && (!supabase || isSupabaseDisabled())) {
      throw new AppError('Authoritative friend code service unavailable.', 503);
    }

    // 2. Bounded collision retry allocation loop
    for (let attempt = 1; attempt <= MAX_ALLOCATION_RETRIES; attempt++) {
      const candidateCode = this.generateRandomCode();

      if (supabase && !isSupabaseDisabled()) {
        try {
          // Atomic reservation in unified friend_codes registry
          const now = new Date().toISOString();
          const { error: insertErr } = await supabase
            .from('friend_codes')
            .insert({
              code: candidateCode,
              identity_id: cleanUserId,
              identity_type: 'REGISTERED',
              expires_at: null,
              is_active: true,
              created_at: now,
            });

          if (insertErr) {
            // PostgreSQL partial unique violation: code 23505 (code already active)
            if (insertErr.code === '23505' || insertErr.message?.includes('duplicate key') || insertErr.message?.includes('unique')) {
              continue; // Collision detected, retry
            }
            handleSharedDbError(insertErr, `allocateRegisteredCode insert ${candidateCode}`);
            throw insertErr;
          }

          // Upsert profiles table with allocated friend code
          const { error: profileErr } = await supabase
            .from('profiles')
            .upsert({ id: cleanUserId, friend_code: candidateCode, updated_at: now }, { onConflict: 'id' });

          if (profileErr) {
            handleSharedDbError(profileErr, `allocateRegisteredCode upsert profile ${cleanUserId}`);
          }

          // Cache in memory
          inMemoryFriendCodes.set(candidateCode, {
            code: candidateCode,
            identityId: cleanUserId,
            identityType: 'REGISTERED',
            createdAt: now,
            expiresAt: null,
            isActive: true,
            revokedAt: null,
          });

          return candidateCode;
        } catch (err) {
          if (err instanceof AppError) throw err;
          handleSharedDbError(err, `allocateRegisteredCode attempt ${attempt} for ${cleanUserId}`);
          if (attempt === MAX_ALLOCATION_RETRIES) {
            throw new AppError('Friend code namespace capacity exhausted. Please retry.', 503);
          }
          if (process.env.NODE_ENV === 'production') {
            throw new AppError('Authoritative friend code service unavailable.', 503);
          }
        }
      }

      // In-memory fallback (only for non-production development/tests)
      if (process.env.NODE_ENV === 'production') {
        throw new AppError('Authoritative friend code service unavailable.', 503);
      }
      const existing = inMemoryFriendCodes.get(candidateCode);
      if (existing && existing.isActive) {
        // If expired, lazily deactivate so it can be recycled
        if (existing.expiresAt && new Date(existing.expiresAt).getTime() <= Date.now()) {
          existing.isActive = false;
          existing.revokedAt = new Date().toISOString();
        } else {
          continue; // Active collision, retry
        }
      }

      const record: FriendCodeRecord = {
        code: candidateCode,
        identityId: cleanUserId,
        identityType: 'REGISTERED',
        createdAt: new Date().toISOString(),
        expiresAt: null,
        isActive: true,
        revokedAt: null,
      };
      inMemoryFriendCodes.set(candidateCode, record);
      return candidateCode;
    }

    throw new AppError('Friend code namespace capacity exhausted. Please retry.', 503);
  }

  /**
   * Get existing code for registered user if already assigned.
   */
  static async getRegisteredUserCode(userId: string): Promise<string | null> {
    const cleanUserId = userId.trim();
    if (!cleanUserId) return null;

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('friend_codes')
          .select('code')
          .eq('identity_id', cleanUserId)
          .eq('identity_type', 'REGISTERED')
          .eq('is_active', true)
          .maybeSingle();

        if (error) {
          handleSharedDbError(error, `getRegisteredUserCode for ${cleanUserId}`);
          if (process.env.NODE_ENV === 'production') {
            throw new AppError('Authoritative friend code service unavailable.', 503);
          }
        } else if (data?.code) {
          return data.code;
        }

        // Fallback: check profiles table directly in case friend_codes row synchronization was pending
        const { data: pData } = await supabase
          .from('profiles')
          .select('friend_code')
          .eq('id', cleanUserId)
          .maybeSingle();

        if (pData?.friend_code) {
          return pData.friend_code;
        }
      } catch (err) {
        if (err instanceof AppError) throw err;
        handleSharedDbError(err, `getRegisteredUserCode exception for ${cleanUserId}`);
        if (process.env.NODE_ENV === 'production') {
          throw new AppError('Authoritative friend code service unavailable.', 503);
        }
      }
    }

    if (process.env.NODE_ENV === 'production') {
      throw new AppError('Authoritative friend code service unavailable.', 503);
    }

    // In-memory lookup
    for (const record of inMemoryFriendCodes.values()) {
      if (record.identityId === cleanUserId && record.identityType === 'REGISTERED' && record.isActive) {
        return record.code;
      }
    }
    return null;
  }

  /**
   * Allocate a temporary 6-digit code for a guest session with an unpredictable sessionSecret.
   */
  static async allocateGuestCode(
    guestId: string,
    ttlHours: number = DEFAULT_GUEST_TTL_HOURS
  ): Promise<{ code: string; expiresAt: string; sessionSecret: string }> {
    const cleanGuestId = guestId.trim();
    if (!cleanGuestId) {
      throw new AppError('Valid guest identifier required.', 400);
    }

    // Fail closed in production if authoritative store is offline
    if (process.env.NODE_ENV === 'production' && (!supabase || isSupabaseDisabled())) {
      throw new AppError('Authoritative friend code service unavailable.', 503);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlHours * 3600 * 1000).toISOString();
    const nowIso = now.toISOString();

    const sessionSecret = this.generateSessionSecret();
    const secretHash = this.hashSecret(sessionSecret);

    for (let attempt = 1; attempt <= MAX_ALLOCATION_RETRIES; attempt++) {
      const candidateCode = this.generateRandomCode();

      if (supabase && !isSupabaseDisabled()) {
        try {
          const { error: codeErr } = await supabase
            .from('friend_codes')
            .insert({
              code: candidateCode,
              identity_id: cleanGuestId,
              identity_type: 'GUEST',
              expires_at: expiresAt,
              is_active: true,
              created_at: nowIso,
            });

          if (codeErr) {
            // Active partial index collision (code already active)
            if (codeErr.code === '23505' || codeErr.message?.includes('duplicate key') || codeErr.message?.includes('unique')) {
              continue; // Collision, retry
            }
            handleSharedDbError(codeErr, `allocateGuestCode insert ${candidateCode}`);
            throw codeErr;
          }

          const { error: sessionErr } = await supabase
            .from('guest_sessions')
            .upsert({
              id: cleanGuestId,
              friend_code: candidateCode,
              secret_hash: secretHash,
              created_at: nowIso,
              expires_at: expiresAt,
              is_active: true,
              revoked_at: null,
            });

          if (sessionErr) {
            handleSharedDbError(sessionErr, `allocateGuestCode session upsert ${cleanGuestId}`);
          }

          // Cache in memory
          inMemoryFriendCodes.set(candidateCode, {
            code: candidateCode,
            identityId: cleanGuestId,
            identityType: 'GUEST',
            createdAt: nowIso,
            expiresAt,
            isActive: true,
            revokedAt: null,
          });

          inMemoryGuestSessions.set(cleanGuestId, {
            id: cleanGuestId,
            friendCode: candidateCode,
            secretHash,
            createdAt: nowIso,
            expiresAt,
            isActive: true,
            revokedAt: null,
          });

          return { code: candidateCode, expiresAt, sessionSecret };
        } catch (err) {
          if (err instanceof AppError) throw err;
          handleSharedDbError(err, `allocateGuestCode attempt ${attempt} for ${cleanGuestId}`);
          if (attempt === MAX_ALLOCATION_RETRIES) {
            throw new AppError('Friend code namespace capacity exhausted. Please retry.', 503);
          }
          if (process.env.NODE_ENV === 'production') {
            throw new AppError('Authoritative friend code service unavailable.', 503);
          }
        }
      }

      // In-memory fallback (development/testing)
      if (process.env.NODE_ENV === 'production') {
        throw new AppError('Authoritative friend code service unavailable.', 503);
      }
      const existing = inMemoryFriendCodes.get(candidateCode);
      if (existing && existing.isActive) {
        if (existing.expiresAt && new Date(existing.expiresAt).getTime() <= Date.now()) {
          existing.isActive = false;
          existing.revokedAt = nowIso;
        } else {
          continue; // Active collision
        }
      }

      const codeRecord: FriendCodeRecord = {
        code: candidateCode,
        identityId: cleanGuestId,
        identityType: 'GUEST',
        createdAt: nowIso,
        expiresAt,
        isActive: true,
        revokedAt: null,
      };

      const sessionRecord: GuestSessionRecord = {
        id: cleanGuestId,
        friendCode: candidateCode,
        secretHash,
        createdAt: nowIso,
        expiresAt,
        isActive: true,
        revokedAt: null,
      };

      inMemoryFriendCodes.set(candidateCode, codeRecord);
      inMemoryGuestSessions.set(cleanGuestId, sessionRecord);
      return { code: candidateCode, expiresAt, sessionSecret };
    }

    throw new AppError('Friend code namespace capacity exhausted. Please retry.', 503);
  }

  /**
   * Get or create a guest session:
   * - If existing guestId and valid sessionSecret provided, reuse it if active & unexpired.
   * - If credentials invalid: REJECT with 403 Forbidden (prevent session hijacking).
   * - If expired: lazily revoke and provision brand-new identity.
   * - If no guestId provided: allocate a fresh guest identity and secret.
   */
  static async getOrCreateGuestSession(
    existingGuestId?: string,
    sessionSecret?: string
  ): Promise<{
    guestId: string;
    friendCode: string;
    sessionSecret: string;
    expiresAt: string;
    avatarUrl?: string | null;
    isNew: boolean;
  }> {
    if (existingGuestId) {
      const cleanGuestId = existingGuestId.trim();
      const existing = await this.getGuestSession(cleanGuestId);

      if (existing && existing.isActive) {
        // Enforce proof of ownership
        if (!this.verifySecret(sessionSecret, existing.secretHash)) {
          throw new AppError('Forbidden: Invalid guest session credentials.', 403);
        }

        const isExpired = new Date(existing.expiresAt).getTime() <= Date.now();
        if (!isExpired) {
          return {
            guestId: cleanGuestId,
            friendCode: existing.friendCode,
            sessionSecret: sessionSecret!,
            expiresAt: existing.expiresAt,
            avatarUrl: existing.avatarUrl || null,
            isNew: false,
          };
        }
        // If expired, revoke the old session before creating new
        await this.revokeGuestSession(cleanGuestId, sessionSecret, true);
      }
    }

    // Allocate brand-new guest identity
    const newGuestId = 'anon_' + crypto.randomBytes(8).toString('hex');
    const { code, expiresAt, sessionSecret: newSecret } = await this.allocateGuestCode(newGuestId);
    return {
      guestId: newGuestId,
      friendCode: code,
      sessionSecret: newSecret,
      expiresAt,
      avatarUrl: null,
      isNew: true,
    };
  }

  /**
   * Fetch a guest session by ID.
   */
  static async getGuestSession(guestId: string): Promise<GuestSessionRecord | null> {
    const cleanGuestId = guestId.trim();
    if (!cleanGuestId) return null;

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('guest_sessions')
          .select('id, friend_code, secret_hash, created_at, expires_at, is_active, revoked_at, avatar_url')
          .eq('id', cleanGuestId)
          .maybeSingle();

        if (error) {
          handleSharedDbError(error, `getGuestSession for ${cleanGuestId}`);
          const inMem = inMemoryGuestSessions.get(cleanGuestId);
          if (inMem) return inMem;
          if (isSupabaseDisabled()) return null;
          if (process.env.NODE_ENV === 'production') {
            throw new AppError('Authoritative guest session service unavailable.', 503);
          }
        } else if (data) {
          const inMem = inMemoryGuestSessions.get(cleanGuestId);
          return {
            id: data.id,
            friendCode: data.friend_code,
            secretHash: data.secret_hash,
            createdAt: data.created_at,
            expiresAt: data.expires_at,
            isActive: data.is_active,
            revokedAt: data.revoked_at,
            avatarUrl: (data as any).avatar_url || inMem?.avatarUrl || null,
          };
        }
      } catch (err) {
        if (err instanceof AppError) throw err;
        handleSharedDbError(err, `getGuestSession exception for ${cleanGuestId}`);
        const inMem = inMemoryGuestSessions.get(cleanGuestId);
        if (inMem) return inMem;
        if (isSupabaseDisabled()) return null;
        if (process.env.NODE_ENV === 'production') {
          throw new AppError('Authoritative guest session service unavailable.', 503);
        }
      }
    }

    if (process.env.NODE_ENV === 'production') {
      return null;
    }

    return inMemoryGuestSessions.get(cleanGuestId) || null;
  }

  /**
   * Update guest session avatar in-memory
   */
  static updateGuestAvatar(guestId: string, avatarUrl: string | null): void {
    const cleanGuestId = guestId.trim();
    const existing = inMemoryGuestSessions.get(cleanGuestId);
    if (existing) {
      existing.avatarUrl = avatarUrl;
    }
  }

  /**
   * Revoke a guest session explicitly.
   * Requires valid sessionSecret unless bypassSecretCheck is true (e.g. internal server expiry).
   */
  static async revokeGuestSession(
    guestId: string,
    sessionSecret?: string,
    bypassSecretCheck = false
  ): Promise<void> {
    const cleanGuestId = guestId.trim();
    if (!cleanGuestId) return;

    const session = await this.getGuestSession(cleanGuestId);
    if (!session) return;

    if (!bypassSecretCheck) {
      if (!this.verifySecret(sessionSecret, session.secretHash)) {
        throw new AppError('Forbidden: Invalid guest session credentials for revocation.', 403);
      }
    }

    const nowIso = new Date().toISOString();

    if (supabase && !isSupabaseDisabled()) {
      try {
        await supabase
          .from('guest_sessions')
          .update({ is_active: false, revoked_at: nowIso })
          .eq('id', cleanGuestId);

        if (session.friendCode) {
          await supabase
            .from('friend_codes')
            .update({ is_active: false, revoked_at: nowIso })
            .eq('code', session.friendCode);
        }
      } catch (err) {
        handleSharedDbError(err, `revokeGuestSession for ${cleanGuestId}`);
        if (process.env.NODE_ENV === 'production') {
          throw new AppError('Authoritative guest session service unavailable.', 503);
        }
      }
    }

    if (process.env.NODE_ENV === 'production') {
      return;
    }

    // In-memory revocation
    const inMemSession = inMemoryGuestSessions.get(cleanGuestId);
    if (inMemSession) {
      inMemSession.isActive = false;
      inMemSession.revokedAt = nowIso;
      const inMemCode = inMemoryFriendCodes.get(inMemSession.friendCode);
      if (inMemCode) {
        inMemCode.isActive = false;
        inMemCode.revokedAt = nowIso;
      }
    }
  }

  /**
   * Transition policy: When an anonymous guest signs in or creates an account,
   * verify guest session ownership, deactivate their old guest session and temporary code,
   * and allocate or return the registered user's permanent code.
   */
  static async transitionGuestToAccount(
    guestId: string,
    sessionSecret: string,
    registeredUserId: string
  ): Promise<string> {
    const cleanGuestId = (guestId || '').trim();
    if (cleanGuestId && cleanGuestId.startsWith('anon_')) {
      const session = await this.getGuestSession(cleanGuestId);
      if (session && session.isActive) {
        if (!this.verifySecret(sessionSecret, session.secretHash)) {
          throw new AppError('Forbidden: Invalid guest session credentials for account transition.', 403);
        }
        await this.revokeGuestSession(cleanGuestId, sessionSecret, true);
      }
    }
    // Return or allocate the registered user's permanent code
    return this.allocateRegisteredCode(registeredUserId);
  }

  /**
   * Exact 6-digit friend code lookup.
   * Returns active, unexpired record or null.
   */
  static async lookupCode(code: string): Promise<FriendCodeRecord | null> {
    const cleanCode = (code || '').trim();
    if (!this.isValidCodeFormat(cleanCode)) return null;

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('friend_codes')
          .select('code, identity_id, identity_type, created_at, expires_at, is_active, revoked_at')
          .eq('code', cleanCode)
          .eq('is_active', true)
          .maybeSingle();

        if (error) {
          handleSharedDbError(error, `lookupCode for ${cleanCode}`);
          throw new AppError('Authoritative friend code service unavailable.', 503);
        }

        if (data) {
          // Verify expiration
          if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
            // Auto-deactivate expired record
            await this.revokeGuestSession(data.identity_id, undefined, true);
            return null;
          }

          return {
            code: data.code,
            identityId: data.identity_id,
            identityType: data.identity_type as IdentityType,
            createdAt: data.created_at,
            expiresAt: data.expires_at,
            isActive: data.is_active,
            revokedAt: data.revoked_at,
          };
        }
        return null;
      } catch (err) {
        if (err instanceof AppError) throw err;
        handleSharedDbError(err, `lookupCode exception for ${cleanCode}`);
        throw new AppError('Authoritative friend code service unavailable.', 503);
      }
    }

    if (process.env.NODE_ENV === 'production') {
      throw new AppError('Authoritative friend code service unavailable.', 503);
    }

    // In-memory lookup
    const record = inMemoryFriendCodes.get(cleanCode);
    if (!record || !record.isActive) return null;

    if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
      record.isActive = false;
      record.revokedAt = new Date().toISOString();
      return null;
    }

    return record;
  }
}
