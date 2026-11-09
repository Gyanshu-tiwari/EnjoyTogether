import type { Request, Response, NextFunction } from 'express';
import { FriendCodeRepository } from '../repositories/friendCode.repository.js';
import { AvatarService } from '../services/avatar.service.js';
import { AppError } from '../utils/appError.js';

export class GuestController {
  /**
   * POST /api/guests/session
   * Validates or allocates an anonymous guest identity with temporary 6-digit friend code and secret.
   * If existing guestId is submitted, requires sessionSecret proof of ownership to restore.
   */
  static async handleSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { guestId, sessionSecret } = (req.body || {}) as { guestId?: string; sessionSecret?: string };
      const secret = sessionSecret || (req.headers['x-guest-secret'] as string) || undefined;

      const session = await FriendCodeRepository.getOrCreateGuestSession(guestId, secret);
      res.status(200).json({
        status: 'success',
        data: session,
      });
    } catch (error) {
      if (error instanceof AppError) return next(error);
      next(new AppError('Failed to initialize guest session.', 500));
    }
  }

  /**
   * POST /api/guests/revoke
   * Revokes a guest session explicitly on sign-out, freeing the temporary code.
   * Requires proof of ownership (sessionSecret).
   */
  static async handleRevoke(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { guestId, sessionSecret } = (req.body || {}) as { guestId?: string; sessionSecret?: string };
      const secret = sessionSecret || (req.headers['x-guest-secret'] as string) || undefined;

      if (!guestId) {
        return next(new AppError('Guest identifier is required for revocation.', 400));
      }
      if (!secret) {
        return next(new AppError('Session secret is required for revocation proof of ownership.', 400));
      }

      await FriendCodeRepository.revokeGuestSession(guestId, secret);
      res.status(200).json({
        status: 'success',
        message: 'Guest session and friend code revoked.',
      });
    } catch (error) {
      if (error instanceof AppError) return next(error);
      next(new AppError('Failed to revoke guest session.', 500));
    }
  }

  /**
   * POST /api/guests/transition
   * Deactivates guest session when user upgrades / signs in to a registered account.
   * Requires authenticated registered user AND proof of ownership of the guest session.
   */
  static async handleTransition(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) return next(new AppError('Unauthorized', 401));

      const { guestId, sessionSecret } = (req.body || {}) as { guestId?: string; sessionSecret?: string };
      const secret = sessionSecret || (req.headers['x-guest-secret'] as string) || undefined;

      if (!guestId) {
        return next(new AppError('Guest identifier is required for transition.', 400));
      }
      if (!secret) {
        return next(new AppError('Session secret is required for transition proof of ownership.', 400));
      }

      const permanentCode = await FriendCodeRepository.transitionGuestToAccount(guestId, secret, userId);
      res.status(200).json({
        status: 'success',
        data: { friendCode: permanentCode },
      });
    } catch (error) {
      if (error instanceof AppError) return next(error);
      next(new AppError('Failed to transition guest session.', 500));
    }
  }

  /**
   * POST /api/guests/avatar
   * Uploads an avatar image for an active guest session using proof-of-ownership.
   */
  static async uploadAvatar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const guestId = (req.body?.guestId as string) || (req.headers['x-guest-id'] as string);
      const secret = (req.headers['x-guest-secret'] as string) || (req.body?.sessionSecret as string);

      if (!guestId) return next(new AppError('Guest identifier is required.', 400));
      if (!secret) return next(new AppError('Session secret is required for guest avatar upload.', 403));
      if (!req.file || !req.file.buffer) {
        return next(new AppError('No avatar file uploaded. Please select an image.', 400));
      }

      const avatarUrl = await AvatarService.uploadGuestAvatar(guestId, secret, req.file.buffer);
      res.status(200).json({ status: 'success', data: { avatarUrl } });
    } catch (error) {
      if (error instanceof AppError) return next(error);
      next(new AppError('Failed to upload guest avatar.', 500));
    }
  }

  /**
   * DELETE /api/guests/avatar
   * Removes avatar image for an active guest session using proof-of-ownership.
   */
  static async removeAvatar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const guestId = (req.body?.guestId as string) || (req.headers['x-guest-id'] as string);
      const secret = (req.headers['x-guest-secret'] as string) || (req.body?.sessionSecret as string);

      if (!guestId) return next(new AppError('Guest identifier is required.', 400));
      if (!secret) return next(new AppError('Session secret is required for guest avatar removal.', 403));

      await AvatarService.removeGuestAvatar(guestId, secret);
      res.status(200).json({ status: 'success', message: 'Guest avatar removed successfully.' });
    } catch (error) {
      if (error instanceof AppError) return next(error);
      next(new AppError('Failed to remove guest avatar.', 500));
    }
  }
}
