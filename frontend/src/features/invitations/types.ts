import type { RoomInvitationItem } from '@/features/theater/api/theaterApi';

export type NotificationType =
  | 'watch_party_invitation'
  | 'friend_request'
  | 'room_admission_update';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: number;
  read: boolean;
  senderId?: string;
  senderName: string;
  senderAvatar?: string;
  data?: {
    invitationId?: string;
    roomId?: string;
    status?: 'pending' | 'accepted' | 'declined' | 'expired';
    recipientId?: string;
    recipientUsername?: string;
    friendshipId?: string;
  };
}

export type { RoomInvitationItem };
