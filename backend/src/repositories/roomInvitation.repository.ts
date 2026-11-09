import crypto from 'crypto';
import { RoomRepository } from './room.repository.js';
import { supabase, isSupabaseDisabled, handleSharedDbError } from '../config/supabase.js';

export interface RoomInvitation {
  id: string;
  roomId: string;
  hostId: string;
  hostName: string;
  hostAvatar?: string | undefined;
  recipientId: string;
  recipientUsername?: string | undefined;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: number;
}

// In-memory registry of invitations
const inMemoryInvitations = new Map<string, RoomInvitation>();

// In-memory set of pre-approved guests per room: `${roomId}:${userId}`
const preApprovedGuests = new Set<string>();

export class RoomInvitationRepository {
  static async createInvitation(params: {
    roomId: string;
    hostId: string;
    hostName: string;
    hostAvatar?: string | undefined;
    recipientId: string;
    recipientUsername?: string | undefined;
    createdAt?: number | undefined;
  }): Promise<RoomInvitation> {
    const id = crypto.randomUUID();
    const invitation: RoomInvitation = {
      id,
      roomId: params.roomId.trim(),
      hostId: params.hostId.trim(),
      hostName: params.hostName.trim() || 'Host',
      hostAvatar: params.hostAvatar,
      recipientId: params.recipientId.trim(),
      recipientUsername: params.recipientUsername,
      status: 'pending',
      createdAt: params.createdAt ?? Date.now(),
    };

    inMemoryInvitations.set(id, invitation);

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { error } = await supabase
          .from('room_invitations')
          .insert({
            id: invitation.id,
            room_id: invitation.roomId,
            host_id: invitation.hostId,
            host_name: invitation.hostName,
            host_avatar: invitation.hostAvatar || null,
            recipient_id: invitation.recipientId,
            recipient_username: invitation.recipientUsername || null,
            status: invitation.status,
            created_at: new Date(invitation.createdAt).toISOString(),
          });
        if (error) {
          console.warn('[RoomInvitationRepository] DB insert room_invitations skipped:', error.message);
        }
      } catch (err) {
        handleSharedDbError(err, 'insert room_invitation');
      }
    }

    return invitation;
  }

  static async getInvitationById(id: string): Promise<RoomInvitation | null> {
    const memory = inMemoryInvitations.get(id);
    if (memory) return memory;

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('room_invitations')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (error) {
          console.warn('[RoomInvitationRepository] DB getInvitationById skipped:', error.message);
        } else if (data) {
          const inv: RoomInvitation = {
            id: data.id,
            roomId: data.room_id,
            hostId: data.host_id,
            hostName: data.host_name,
            hostAvatar: data.host_avatar || undefined,
            recipientId: data.recipient_id,
            recipientUsername: data.recipient_username || undefined,
            status: data.status,
            createdAt: new Date(data.created_at).getTime(),
          };
          inMemoryInvitations.set(inv.id, inv);
          return inv;
        }
      } catch (err) {
        handleSharedDbError(err, 'getInvitationById');
      }
    }

    return null;
  }

  static async getPendingInvitationsForUser(userId: string): Promise<RoomInvitation[]> {
    const cleanId = userId.trim();
    const map = new Map<string, RoomInvitation>();
    const now = Date.now();
    const EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

    // 1. Check database if available
    if (supabase && !isSupabaseDisabled()) {
      try {
        const { data, error } = await supabase
          .from('room_invitations')
          .select('*')
          .eq('recipient_id', cleanId)
          .eq('status', 'pending');

        if (error) {
          console.warn('[RoomInvitationRepository] DB getPendingInvitations skipped:', error.message);
        } else if (data) {
          for (const row of data) {
            const createdAt = new Date(row.created_at).getTime();
            if (now - createdAt > EXPIRY_MS) {
              continue;
            }
            const inv: RoomInvitation = {
              id: row.id,
              roomId: row.room_id,
              hostId: row.host_id,
              hostName: row.host_name,
              hostAvatar: row.host_avatar || undefined,
              recipientId: row.recipient_id,
              recipientUsername: row.recipient_username || undefined,
              status: 'pending',
              createdAt,
            };
            map.set(inv.id, inv);
            inMemoryInvitations.set(inv.id, inv);
          }
        }
      } catch (err) {
        handleSharedDbError(err, 'getPendingInvitations');
      }
    }

    // 2. Overlay in-memory invitations
    for (const inv of inMemoryInvitations.values()) {
      if (inv.recipientId === cleanId && inv.status === 'pending') {
        if (now - inv.createdAt > EXPIRY_MS) {
          inv.status = 'expired';
        } else {
          map.set(inv.id, inv);
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  static async respondToInvitation(
    invitationId: string,
    recipientId: string,
    response: 'accept' | 'decline'
  ): Promise<{ success: boolean; invitation: RoomInvitation }> {
    let inv = await this.getInvitationById(invitationId);
    if (!inv) {
      throw new Error('Invitation not found');
    }

    if (inv.recipientId !== recipientId.trim()) {
      throw new Error('Unauthorized: This invitation was not addressed to you');
    }

    const now = Date.now();
    const EXPIRY_MS = 15 * 60 * 1000;
    if (inv.status === 'expired' || now - inv.createdAt > EXPIRY_MS) {
      inv.status = 'expired';
      inMemoryInvitations.set(inv.id, inv);
      throw new Error('Invitation has expired');
    }

    if (inv.status !== 'pending') {
      throw new Error(`Invitation has already been ${inv.status}`);
    }

    const newStatus = response === 'accept' ? 'accepted' : 'declined';
    inv.status = newStatus;
    inMemoryInvitations.set(inv.id, inv);

    if (response === 'accept') {
      // NOTE: Do not pre-approve guest; guest must knock so host receives join-request approval
      await RoomRepository.updateUserRoomRole(inv.roomId, recipientId, 'viewer');
    }

    if (supabase && !isSupabaseDisabled()) {
      try {
        const { error } = await supabase
          .from('room_invitations')
          .update({
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', inv.id);

        if (error) {
          console.warn('[RoomInvitationRepository] DB update room_invitations status skipped:', error.message);
        }
      } catch (err) {
        handleSharedDbError(err, 'update room_invitations status');
      }
    }

    return { success: true, invitation: inv };
  }

  static preApproveGuest(roomId: string, userId: string): void {
    const key = `${roomId.trim()}:${userId.trim()}`;
    preApprovedGuests.add(key);
  }

  static isGuestPreApproved(roomId: string, userId: string): boolean {
    const key = `${roomId.trim()}:${userId.trim()}`;
    return preApprovedGuests.has(key);
  }

  static clearInMemoryInvitations(): void {
    inMemoryInvitations.clear();
    preApprovedGuests.clear();
  }
}
