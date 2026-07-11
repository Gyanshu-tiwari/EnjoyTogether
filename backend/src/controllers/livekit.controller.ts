import type { Request, Response, NextFunction } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { livekitConfig } from '../config/livekit.js';
import { AppError } from '../utils/appError.js';
import { RoomRepository, type WatchPartyRole } from '../repositories/room.repository.js';

export class LiveKitController {
  static async getToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const roomId = req.query.room_id ? String(req.query.room_id) : 'enjoy-together-main';
      const userId = req.query.user_id
        ? String(req.query.user_id)
        : `peer_${Math.random().toString(36).substring(2, 8)}`;
      const userName = req.query.user_name ? String(req.query.user_name) : userId;

      // Guard: room must be active before issuing a token
      const metadata = await RoomRepository.getRoomMetadata(roomId);
      if (!metadata.is_active) {
        return next(new AppError('Cannot join LiveKit room: watch-party session is inactive.', 403));
      }

      // ── RBAC: resolve media grants based on role ────────────────────────────
      const role: WatchPartyRole = await RoomRepository.getUserRoomRole(roomId, userId);
      const canPublish = role === 'host' || role === 'co-host';

      const at = new AccessToken(livekitConfig.apiKey, livekitConfig.apiSecret, {
        identity: userId,
        name: userName,
        // Embed role as metadata so client SDKs can read it
        metadata: JSON.stringify({ role }),
      });

      at.addGrant({
        roomJoin: true,
        room: roomId,
        canPublish,
        canPublishData: canPublish,
        canSubscribe: true,
      });

      const token = await at.toJwt();

      res.status(200).json({
        token,
        serverUrl: livekitConfig.serverUrl,
        role,
      });
    } catch (error) {
      next(new AppError('Failed to generate LiveKit authorization token.', 500));
    }
  }
}
