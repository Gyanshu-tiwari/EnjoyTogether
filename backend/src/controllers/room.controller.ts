import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AppError } from '../utils/appError.js';
import { RoomRepository } from '../repositories/room.repository.js';

export class RoomController {
  // ── Room Lifecycle ─────────────────────────────────────────────────────────

  static async createRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { hostId, movieUrl, mediaName } = req.body;
      const roomId = crypto.randomUUID();
      const actualHostId = req.user?.id || hostId || 'default-host-id';
      const metadata = await RoomRepository.createRoom(
        roomId,
        actualHostId,
        movieUrl || ''
      );

      // If a local media name is provided at creation time, store it
      if (mediaName) {
        await RoomRepository.updateRoomState(roomId, {
          mediaName,
          mediaSourceType: 'local',
        });
      }

      // createRoom() already calls assignRoomHost() internally
      res.status(201).json({ success: true, roomId, metadata });
    } catch (error) {
      next(new AppError('Failed to create a new watch room.', 500));
    }
  }

  static async getMetadata(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      if (!roomId) return next(new AppError('Missing room identifier parameter.', 400));
      const cleanRoomId = (Array.isArray(roomId) ? roomId[0] : roomId) as string;
      const metadata = await RoomRepository.getRoomMetadata(cleanRoomId);
      res.status(200).json({ success: true, metadata });
    } catch (error) {
      next(new AppError('Failed to retrieve room metadata.', 500));
    }
  }

  static async toggleActiveStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId, isActive } = req.body;
      if (!roomId) return next(new AppError('Missing room identifier parameter.', 400));
      if (typeof isActive !== 'boolean') return next(new AppError('Missing or invalid isActive flag.', 400));
      await RoomRepository.setSessionActiveStatus(roomId, isActive);
      res.status(200).json({ success: true, roomId, isActive });
    } catch (error) {
      next(new AppError('Failed to toggle room active status.', 500));
    }
  }
}
