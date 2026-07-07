import type { Request, Response, NextFunction } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { livekitConfig } from '../config/livekit.js';
import { AppError } from '../utils/AppError.js';
import { RoomRepository } from '../rooms/room.repository.js';

export class LiveKitController {
  static async getToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const roomId = req.query.room_id ? String(req.query.room_id) : 'enjoy-together-main';
      const userId = req.query.user_id ? String(req.query.user_id) : `peer_${Math.random().toString(36).substring(2, 8)}`;
      
      const metadata = await RoomRepository.getRoomMetadata(roomId);
      if (!metadata.is_active) {
        return next(new AppError('Cannot join LiveKit room: watch-party session is inactive.', 403));
      }

      const at = new AccessToken(livekitConfig.apiKey, livekitConfig.apiSecret, {
        identity: userId,
      });
      
      at.addGrant({
        roomJoin: true,
        room: roomId,
        canPublish: true,
        canSubscribe: true,
      });
      
      const token = await at.toJwt();
      
      // ✨ FIX: Return BOTH token and serverUrl to the React frontend client
      res.status(200).json({ 
        token,
        serverUrl: livekitConfig.serverUrl 
      });
    } catch (error) {
      next(new AppError('Failed to generate LiveKit authorization token.', 500));
    }
  }
}