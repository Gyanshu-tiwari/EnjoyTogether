import type { Request, Response, NextFunction } from 'express';
import { FriendRepository, type FriendshipAction } from '../repositories/friend.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { AppError } from '../utils/appError.js';

export class FriendController {
  /** GET /api/friends/search?q=<username> */
  static async searchUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) return next(new AppError('Unauthorized', 401));

      const q = String(req.query.q || '').trim();
      if (!q) return next(new AppError('Search query is required', 400));

      const results = await FriendRepository.searchUsers(q, userId);
      res.status(200).json({ status: 'success', data: { users: results } });
    } catch (error) {
      next(new AppError('Failed to search users.', 500));
    }
  }

  /** POST /api/friends/request */
  static async sendRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const requesterId = req.user?.id;
      if (!requesterId) return next(new AppError('Unauthorized', 401));

      const { addresseeId } = req.body as { addresseeId: string };
      const friendship = await FriendRepository.sendFriendRequest(requesterId, addresseeId);
      res.status(201).json({ status: 'success', data: { friendship } });
    } catch (error) {
      if (error instanceof Error) {
        return next(new AppError(error.message, 400));
      }
      next(new AppError('Failed to send friend request.', 500));
    }
  }

  /** PATCH /api/friends/respond
   *  Accept or Reject a pending request.
   */
  static async respondToRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) return next(new AppError('Unauthorized', 401));

      const { friendshipId, action } = req.body as { friendshipId: string; action: FriendshipAction };
      const friendship = await FriendRepository.respondToRequest(friendshipId, userId, action);
      res.status(200).json({ status: 'success', data: { friendship } });
    } catch (error) {
      if (error instanceof Error) {
        return next(new AppError(error.message, 400));
      }
      next(new AppError('Failed to respond to friend request.', 500));
    }
  }

  /** GET /api/friends — list accepted friends with their profile info */
  static async getFriends(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) return next(new AppError('Unauthorized', 401));

      const friendships = await FriendRepository.getFriends(userId);

      // Enrich with profile data
      const enriched = await Promise.all(
        friendships.map(async (f) => {
          const friendId = f.requesterId === userId ? f.addresseeId : f.requesterId;
          const profile = await UserRepository.getProfile(friendId);
          return {
            friendshipId: f.id,
            friendId,
            username: profile?.username || friendId,
            avatarUrl: profile?.avatarUrl,
            status: f.status,
          };
        })
      );

      res.status(200).json({ status: 'success', data: { friends: enriched } });
    } catch (error) {
      next(new AppError('Failed to retrieve friends list.', 500));
    }
  }

  /** GET /api/friends/pending — incoming + outgoing pending requests */
  static async getPending(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) return next(new AppError('Unauthorized', 401));

      const pending = await FriendRepository.getPendingRequests(userId);

      const enriched = await Promise.all(
        pending.map(async (f) => {
          const isIncoming = f.addresseeId === userId;
          const otherId = isIncoming ? f.requesterId : f.addresseeId;
          const profile = await UserRepository.getProfile(otherId);
          return {
            friendshipId: f.id,
            userId: otherId,
            username: profile?.username || otherId,
            avatarUrl: profile?.avatarUrl,
            direction: isIncoming ? 'incoming' : 'outgoing',
            status: f.status,
            createdAt: f.createdAt,
          };
        })
      );

      res.status(200).json({ status: 'success', data: { requests: enriched } });
    } catch (error) {
      next(new AppError('Failed to retrieve pending requests.', 500));
    }
  }

  /** DELETE /api/friends/:friendshipId */
  static async deleteFriendship(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) return next(new AppError('Unauthorized', 401));

      const friendshipId = String(req.params['friendshipId'] || '');
      await FriendRepository.deleteFriendship(friendshipId, userId);
      res.status(200).json({ status: 'success', message: 'Friendship removed.' });
    } catch (error) {
      if (error instanceof Error) {
        return next(new AppError(error.message, 400));
      }
      next(new AppError('Failed to remove friendship.', 500));
    }
  }
}
