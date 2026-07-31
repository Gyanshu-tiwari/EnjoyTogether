import type { Request, Response, NextFunction } from 'express';
import { UserRepository } from '../repositories/user.repository.js';
import { AppError } from '../utils/appError.js';

export class UserController {
  static async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return next(new AppError('Unauthorized: User information not found in token', 401));
      }

      const { avatarUrl } = req.body;
      if (!avatarUrl) {
        return next(new AppError('Validation Error: avatarUrl is required', 400));
      }

      const profile = await UserRepository.updateProfile(userId, avatarUrl);

      res.status(200).json({
        status: 'success',
        data: {
          profile,
        },
      });
    } catch (error) {
      next(new AppError('Failed to update user profile in database.', 500));
    }
  }

  static async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return next(new AppError('Unauthorized: User information not found in token', 401));
      }

      const profile = await UserRepository.getProfile(userId);

      res.status(200).json({
        status: 'success',
        data: {
          profile,
        },
      });
    } catch (error) {
      next(new AppError('Failed to retrieve user profile.', 500));
    }
  }
}
