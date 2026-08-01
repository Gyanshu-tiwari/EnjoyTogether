import type { Request, Response, NextFunction } from 'express';
import { UserRepository } from '../repositories/user.repository.js';
import { AppError } from '../utils/appError.js';

export class UserController {
  static async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) return next(new AppError('Unauthorized: User information not found in token', 401));

      const { avatarUrl, username } = req.body as { avatarUrl?: string; username?: string };
      const profile = await UserRepository.syncProfile(userId, {
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(username !== undefined && { username }),
      });

      res.status(200).json({ status: 'success', data: { profile } });
    } catch (error) {
      next(new AppError('Failed to update user profile.', 500));
    }
  }

  static async syncGoogleProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) return next(new AppError('Unauthorized', 401));

      const { username, avatarUrl } = req.body as { username: string; avatarUrl?: string };

      // Only sync if this user doesn't already have a username set
      const existing = await UserRepository.getProfile(userId);
      if (existing?.username && existing.username.trim() !== '') {
        // Already has a username — don't overwrite manual settings
        res.status(200).json({ status: 'success', data: { profile: existing, skipped: true } });
        return;
      }

      const profile = await UserRepository.syncProfile(userId, {
        username,
        ...(avatarUrl && { avatarUrl }),
      });

      res.status(200).json({ status: 'success', data: { profile } });
    } catch (error) {
      next(new AppError('Failed to sync Google profile.', 500));
    }
  }

  static async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) return next(new AppError('Unauthorized', 401));

      const profile = await UserRepository.getProfile(userId);
      res.status(200).json({ status: 'success', data: { profile } });
    } catch (error) {
      next(new AppError('Failed to retrieve user profile.', 500));
    }
  }
}
