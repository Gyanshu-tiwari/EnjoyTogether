import type { Request, Response, NextFunction } from 'express';
import { RoomInvitationRepository } from '../repositories/roomInvitation.repository.js';
import { RoomRepository } from '../repositories/room.repository.js';
import { UserRepository } from '../repositories/user.repository.js';
import { FriendCodeRepository } from '../repositories/friendCode.repository.js';
import { emitToUser } from '../sockets/index.js';
import { AppError } from '../utils/appError.js';
import { supabase } from '../config/supabase.js';

export class RoomInvitationController {
  /**
   * Helper: extract caller identity (registered user UUID or authenticated guest ID)
   */
  private static async resolveCallerId(req: Request): Promise<{ id: string; isGuest: boolean } | null> {
    if (req.user?.id) {
      return { id: req.user.id, isGuest: false };
    }

    // 1. Check Authorization header for registered user Bearer JWT
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token) {
        if (supabase) {
          try {
            const { data: { user }, error } = await supabase.auth.getUser(token);
            if (user && !error) {
              req.user = { id: user.id, email: user.email || user.id };
              return { id: user.id, isGuest: false };
            }
          } catch {}
        }
        // Local token decode fallback (for test JWTs or offline environments)
        try {
          const parts = token.split('.');
          if (parts.length === 3 && parts[1]) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            if (payload.sub && (!payload.exp || payload.exp > Math.floor(Date.now() / 1000))) {
              req.user = { id: payload.sub, email: payload.email || payload.sub };
              return { id: payload.sub, isGuest: false };
            }
          }
        } catch {}
      }
    }

    // 2. Check Guest Session Proof of Ownership
    const guestId = (req.headers['x-guest-id'] as string) || (req.body?.guestId as string) || (req.query?.guestId as string);
    const guestSecret = (req.headers['x-guest-secret'] as string) || (req.body?.sessionSecret as string) || (req.query?.sessionSecret as string);

    if (guestId) {
      const cleanGuestId = String(guestId).trim();
      const guestSession = await FriendCodeRepository.getGuestSession(cleanGuestId);
      if (guestSession) {
        if (!guestSession.isActive || new Date(guestSession.expiresAt).getTime() <= Date.now()) {
          throw new AppError('Unauthorized: Guest session has expired or is inactive', 401);
        }
        if (!guestSecret || !FriendCodeRepository.verifySecret(guestSecret, guestSession.secretHash)) {
          throw new AppError('Unauthorized: Invalid guest session secret', 401);
        }
        return { id: cleanGuestId, isGuest: true };
      } else if (guestSecret) {
        throw new AppError('Unauthorized: Invalid guest session credentials', 401);
      } else if (cleanGuestId.startsWith('anon_') || cleanGuestId.startsWith('guest_')) {
        return { id: cleanGuestId, isGuest: true };
      }
    }

    return null;
  }

  /**
   * POST /api/rooms/:roomId/invite
   * Host sends a room-specific invitation to a target guest or registered user.
   */
  static async sendInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caller = await RoomInvitationController.resolveCallerId(req);
      if (!caller) return next(new AppError('Unauthorized: Authentication required', 401));

      const { roomId } = req.params;
      const { targetUserId, targetUsername } = req.body as { targetUserId: string; targetUsername?: string };

      if (!roomId) return next(new AppError('Missing roomId parameter', 400));
      if (!targetUserId) return next(new AppError('Missing targetUserId parameter', 400));

      const cleanRoomId = (Array.isArray(roomId) ? roomId[0] : roomId) as string;
      const cleanTargetId = String(targetUserId).trim();

      if (cleanTargetId === caller.id) {
        return next(new AppError('Cannot invite yourself to a watch party', 400));
      }

      // Verify caller is room host or co-host
      const metadata = await RoomRepository.getRoomMetadata(cleanRoomId);
      const role = await RoomRepository.getUserRoomRole(cleanRoomId, caller.id);

      if (metadata.host_id !== caller.id && role !== 'host' && role !== 'co-host') {
        return next(new AppError('Unauthorized: Only room host can send party invitations', 403));
      }

      // Fetch host display profile
      let hostName = req.user?.email ? req.user.email.split('@')[0] : 'Host';
      let hostAvatar: string | undefined = undefined;

      if (!caller.isGuest) {
        const profile = await UserRepository.getProfile(caller.id);
        if (profile?.username) hostName = profile.username;
        if (profile?.avatarUrl) hostAvatar = profile.avatarUrl;
      } else {
        const guestSession = await FriendCodeRepository.getGuestSession(caller.id);
        if (guestSession?.friendCode) hostName = `Guest_${guestSession.friendCode}`;
        if (guestSession?.avatarUrl) hostAvatar = guestSession.avatarUrl;
      }

      const invitation = await RoomInvitationRepository.createInvitation({
        roomId: cleanRoomId,
        hostId: caller.id,
        hostName: hostName || 'Host',
        hostAvatar,
        recipientId: cleanTargetId,
        recipientUsername: targetUsername,
      });

      // Attempt real-time delivery via Socket.IO
      const delivered = emitToUser(cleanTargetId, 'room:invitation:received', invitation);

      res.status(201).json({
        status: 'success',
        data: {
          delivered,
          invitation,
        },
      });
    } catch (error) {
      if (error instanceof AppError) return next(error);
      if (error instanceof Error) return next(new AppError(error.message, 400));
      next(new AppError('Failed to send room invitation.', 500));
    }
  }

  /**
   * GET /api/rooms/invitations/pending
   * Returns all pending room invitations for the caller.
   */
  static async getPendingInvitations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caller = await RoomInvitationController.resolveCallerId(req);
      if (!caller) return next(new AppError('Unauthorized: Authentication required', 401));

      const invitations = await RoomInvitationRepository.getPendingInvitationsForUser(caller.id);

      res.status(200).json({
        status: 'success',
        data: {
          invitations,
        },
      });
    } catch (error) {
      if (error instanceof AppError) return next(error);
      next(new AppError('Failed to fetch pending invitations.', 500));
    }
  }

  /**
   * POST /api/rooms/invitations/:invitationId/respond
   * Guest accepts or declines an invitation.
   */
  static async respondToInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const caller = await RoomInvitationController.resolveCallerId(req);
      if (!caller) return next(new AppError('Unauthorized: Authentication required', 401));

      const { invitationId } = req.params;
      const { response } = req.body as { response: 'accept' | 'decline' };

      if (!invitationId) return next(new AppError('Missing invitationId parameter', 400));
      if (response !== 'accept' && response !== 'decline') {
        return next(new AppError('Invalid response: must be "accept" or "decline"', 400));
      }

      const cleanInvId = (Array.isArray(invitationId) ? invitationId[0] : invitationId) as string;

      const result = await RoomInvitationRepository.respondToInvitation(cleanInvId, caller.id, response);
      const inv = result.invitation;

      // Notify host via Socket.IO
      emitToUser(inv.hostId, response === 'accept' ? 'room:invitation:accepted' : 'room:invitation:declined', {
        invitationId: inv.id,
        roomId: inv.roomId,
        recipientId: caller.id,
        recipientUsername: inv.recipientUsername,
      });

      res.status(200).json({
        status: 'success',
        data: {
          invitation: inv,
          roomId: inv.roomId,
        },
      });
    } catch (error) {
      if (error instanceof AppError) return next(error);
      if (error instanceof Error) {
        if (error.message.includes('Unauthorized')) {
          return next(new AppError(error.message, 403));
        }
        if (error.message.includes('not found')) {
          return next(new AppError(error.message, 404));
        }
        return next(new AppError(error.message, 400));
      }
      next(new AppError('Failed to respond to invitation.', 500));
    }
  }
}
