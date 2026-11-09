import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import { useAuthSession } from '@/features/auth';
import { getAnonymousUserId } from '@/shared/utils/anonymousUser';
import {
  getPendingRoomInvitations,
  respondToRoomInvitation,
  type RoomInvitationItem,
} from '@/features/theater/api/theaterApi';
import type { AppNotification } from '../types';

export interface SenderEventUpdate {
  type: 'accepted' | 'declined';
  invitationId: string;
  roomId: string;
  recipientId: string;
  recipientUsername?: string;
  timestamp: number;
}

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  refreshNotifications: () => Promise<void>;
  markAsRead: (notificationId: string) => void;
  markAllAsRead: () => void;
  acceptInvitation: (invitationId: string) => Promise<void>;
  declineInvitation: (invitationId: string) => Promise<void>;
  respondingId: string | null;
  respondingAction: 'accept' | 'decline' | null;
  pendingInvitations: RoomInvitationItem[];
  lastSenderUpdate: SenderEventUpdate | null;
  bannerToast: string | null;
}

const NotificationContext = createContext<NotificationContextType>({
  notifications: [],
  unreadCount: 0,
  loading: false,
  error: null,
  refreshNotifications: async () => {},
  markAsRead: () => {},
  markAllAsRead: () => {},
  acceptInvitation: async () => {},
  declineInvitation: async () => {},
  respondingId: null,
  respondingAction: null,
  pendingInvitations: [],
  lastSenderUpdate: null,
  bannerToast: null,
});

export const InvitationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { session, isGuest } = useAuthSession();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [respondingAction, setRespondingAction] = useState<'accept' | 'decline' | null>(null);
  const [bannerToast, setBannerToast] = useState<string | null>(null);
  const [lastSenderUpdate, setLastSenderUpdate] = useState<SenderEventUpdate | null>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Determine current active user identifier
  const getCurrentUserId = useCallback((): string => {
    if (!isGuest && session?.user?.id) return session.user.id;
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('et_anon_user_id');
      if (stored) return stored;
    }
    return getAnonymousUserId();
  }, [session, isGuest]);

  const currentUserId = getCurrentUserId();

  // Helper to get set of read notification IDs for current user
  const getReadNotificationIds = useCallback((): Set<string> => {
    if (typeof window === 'undefined') return new Set();
    try {
      const key = `et_read_notifications_${currentUserId}`;
      const raw = localStorage.getItem(key);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  }, [currentUserId]);

  const saveReadNotificationIds = useCallback(
    (readIds: Set<string>) => {
      if (typeof window === 'undefined') return;
      try {
        const key = `et_read_notifications_${currentUserId}`;
        localStorage.setItem(key, JSON.stringify(Array.from(readIds)));
      } catch (err) {
        console.warn('[NotificationContext] Failed to persist read notification IDs:', err);
      }
    },
    [currentUserId]
  );

  const showToast = useCallback((msg: string) => {
    setBannerToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setBannerToast(null), 4000);
  }, []);

  // Fetch pending invitations and construct notification items
  const refreshNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const invs = await getPendingRoomInvitations();
      const readSet = getReadNotificationIds();

      const invitationNotifications: AppNotification[] = invs
        .filter((inv) => inv.hostId !== currentUserId)
        .map((inv) => {
          const notifId = `inv_${inv.id}`;
        return {
          id: notifId,
          type: 'watch_party_invitation',
          title: 'Watch Party Invitation',
          message: `invited you to Watch Party (${inv.roomId.slice(0, 8)}…)`,
          createdAt: inv.createdAt,
          read: readSet.has(notifId),
          senderId: inv.hostId,
          senderName: inv.hostName,
          senderAvatar: inv.hostAvatar,
          data: {
            invitationId: inv.id,
            roomId: inv.roomId,
            status: inv.status,
            recipientUsername: inv.recipientUsername,
          },
        };
      });

      setNotifications((prev) => {
        // Keep non-invitation notifications (e.g. sender admission updates) and merge invitations
        const otherNotifs = prev.filter((n) => n.type !== 'watch_party_invitation');
        const combined = [...invitationNotifications, ...otherNotifs];
        return combined.sort((a, b) => b.createdAt - a.createdAt);
      });
    } catch (err: any) {
      console.warn('[NotificationContext] refreshNotifications error:', err);
      setError(err.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [getReadNotificationIds]);

  useEffect(() => {
    refreshNotifications();
  }, [refreshNotifications]);

  // Sync cross-tab read notifications via storage event
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === `et_read_notifications_${currentUserId}` && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          const readSet = new Set(Array.isArray(parsed) ? parsed : []);
          setNotifications((prev) =>
            prev.map((n) => ({
              ...n,
              read: readSet.has(n.id) || n.read,
            }))
          );
        } catch {}
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [currentUserId]);

  // Connect global notification socket for real-time delivery
  useEffect(() => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
    const token = session?.access_token;
    const guestId =
      typeof window !== 'undefined'
        ? localStorage.getItem('et_anon_user_id') || getAnonymousUserId()
        : getAnonymousUserId();
    const sessionSecret =
      typeof window !== 'undefined'
        ? localStorage.getItem('et_anon_session_secret') || undefined
        : undefined;

    const socketInstance = io(backendUrl, {
      transports: ['websocket', 'polling'],
      auth: {
        token,
        sessionSecret,
        anonymous: !session?.user?.id,
        guestId,
      },
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
    });

    socketRef.current = socketInstance;

    socketInstance.on('connect', () => {
      console.log('🔔 Connected to global notification socket:', socketInstance.id);
      socketInstance.emit('user:register', { userId: currentUserId, sessionSecret });
    });

    // ── 1. Watch Party Invitation Received ──
    socketInstance.on('room:invitation:received', (invitation: RoomInvitationItem) => {
      console.log('📬 Real-time invitation received:', invitation);
      // The host must NEVER receive notifications for invitations they themselves sent
      if (invitation.hostId === currentUserId) return;
      const notifId = `inv_${invitation.id}`;

      setNotifications((prev) => {
        if (prev.some((item) => item.id === notifId)) return prev;
        const newNotif: AppNotification = {
          id: notifId,
          type: 'watch_party_invitation',
          title: 'Watch Party Invitation',
          message: `invited you to Watch Party (${invitation.roomId.slice(0, 8)}…)`,
          createdAt: invitation.createdAt || Date.now(),
          read: false,
          senderId: invitation.hostId,
          senderName: invitation.hostName,
          senderAvatar: invitation.hostAvatar,
          data: {
            invitationId: invitation.id,
            roomId: invitation.roomId,
            status: invitation.status || 'pending',
            recipientUsername: invitation.recipientUsername,
          },
        };
        return [newNotif, ...prev];
      });

      showToast(`@${invitation.hostName} invited you to a Watch Party!`);
    });

    // ── 2. Sender: Invitation Accepted ──
    socketInstance.on(
      'room:invitation:accepted',
      (data: { invitationId: string; roomId: string; recipientId: string; recipientUsername?: string }) => {
        console.log('🎉 Real-time invitation accepted by recipient:', data);
        const name = data.recipientUsername || 'Guest';

        setLastSenderUpdate({
          type: 'accepted',
          invitationId: data.invitationId,
          roomId: data.roomId,
          recipientId: data.recipientId,
          recipientUsername: data.recipientUsername,
          timestamp: Date.now(),
        });

        setNotifications((prev) => {
          const notifId = `acc_${data.invitationId}_${Date.now()}`;
          const newNotif: AppNotification = {
            id: notifId,
            type: 'room_admission_update',
            title: 'Invitation Accepted',
            message: `@${name} accepted your Watch Party invitation!`,
            createdAt: Date.now(),
            read: false,
            senderName: name,
            data: {
              invitationId: data.invitationId,
              roomId: data.roomId,
              recipientId: data.recipientId,
              status: 'accepted',
            },
          };
          return [newNotif, ...prev];
        });

        showToast(`🎉 @${name} accepted your party invitation!`);
      }
    );

    // ── 3. Sender: Invitation Declined ──
    socketInstance.on(
      'room:invitation:declined',
      (data: { invitationId: string; roomId: string; recipientId: string; recipientUsername?: string }) => {
        console.log('ℹ️ Real-time invitation declined by recipient:', data);
        const name = data.recipientUsername || 'Guest';

        setLastSenderUpdate({
          type: 'declined',
          invitationId: data.invitationId,
          roomId: data.roomId,
          recipientId: data.recipientId,
          recipientUsername: data.recipientUsername,
          timestamp: Date.now(),
        });

        setNotifications((prev) => {
          const notifId = `dec_${data.invitationId}_${Date.now()}`;
          const newNotif: AppNotification = {
            id: notifId,
            type: 'room_admission_update',
            title: 'Invitation Declined',
            message: `@${name} declined the Watch Party invitation.`,
            createdAt: Date.now(),
            read: false,
            senderName: name,
            data: {
              invitationId: data.invitationId,
              roomId: data.roomId,
              recipientId: data.recipientId,
              status: 'declined',
            },
          };
          return [newNotif, ...prev];
        });

        showToast(`ℹ️ @${name} declined the party invitation.`);
      }
    );

    return () => {
      socketInstance.disconnect();
      socketRef.current = null;
    };
  }, [currentUserId, session, showToast]);

  // Mark single notification as read
  const markAsRead = useCallback(
    (notificationId: string) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
      const readSet = getReadNotificationIds();
      readSet.add(notificationId);
      saveReadNotificationIds(readSet);
    },
    [getReadNotificationIds, saveReadNotificationIds]
  );

  // Mark all notifications as read
  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const readSet = getReadNotificationIds();
      prev.forEach((n) => readSet.add(n.id));
      saveReadNotificationIds(readSet);
      return prev.map((n) => ({ ...n, read: true }));
    });
  }, [getReadNotificationIds, saveReadNotificationIds]);

  // Helper: update status of an invitation notification and persist read state
  const updateNotificationStatus = useCallback(
    (invitationId: string, status: 'pending' | 'accepted' | 'declined' | 'expired') => {
      const notifId = `inv_${invitationId}`;
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notifId || n.data?.invitationId === invitationId
            ? {
                ...n,
                read: true,
                data: { ...n.data, status },
              }
            : n
        )
      );
      const readSet = getReadNotificationIds();
      readSet.add(notifId);
      saveReadNotificationIds(readSet);
    },
    [getReadNotificationIds, saveReadNotificationIds]
  );

  // Accept a watch party invitation
  const acceptInvitation = async (invitationId: string) => {
    if (!invitationId || respondingId) return;
    setRespondingId(invitationId);
    setRespondingAction('accept');
    try {
      const res = await respondToRoomInvitation(invitationId, 'accept');

      // Mark notification as accepted and read
      updateNotificationStatus(invitationId, 'accepted');

      // Pre-approve this room for the invited guest so they enter automatically
      if (typeof window !== 'undefined' && res.roomId) {
        sessionStorage.setItem(`et_accepted_room_${res.roomId}`, 'true');
      }

      showToast('Invitation accepted! Entering Watch Party...');
      navigate(`/room/${res.roomId}`);
    } catch (err: any) {
      console.error('Failed to accept invitation:', err);
      const msg = err.response?.data?.message || err.message || 'Failed to accept invitation. Please try again.';
      showToast(msg);

      if (/expired/i.test(msg)) {
        updateNotificationStatus(invitationId, 'expired');
      } else if (/already.*accepted/i.test(msg)) {
        updateNotificationStatus(invitationId, 'accepted');
      } else if (/already.*declined/i.test(msg)) {
        updateNotificationStatus(invitationId, 'declined');
      }
    } finally {
      setRespondingId(null);
      setRespondingAction(null);
    }
  };

  // Decline a watch party invitation
  const declineInvitation = async (invitationId: string) => {
    if (!invitationId || respondingId) return;
    setRespondingId(invitationId);
    setRespondingAction('decline');
    try {
      await respondToRoomInvitation(invitationId, 'decline');

      // Mark notification as declined and read
      updateNotificationStatus(invitationId, 'declined');

      showToast('Invitation declined.');
    } catch (err: any) {
      console.error('Failed to decline invitation:', err);
      const msg = err.response?.data?.message || err.message || 'Failed to decline invitation.';
      showToast(msg);

      if (/expired/i.test(msg)) {
        updateNotificationStatus(invitationId, 'expired');
      } else if (/already.*accepted/i.test(msg)) {
        updateNotificationStatus(invitationId, 'accepted');
      } else if (/already.*declined/i.test(msg)) {
        updateNotificationStatus(invitationId, 'declined');
      }
    } finally {
      setRespondingId(null);
      setRespondingAction(null);
    }
  };

  // Derived: pendingInvitations for backward compatibility
  const pendingInvitations: RoomInvitationItem[] = notifications
    .filter(
      (n) => n.type === 'watch_party_invitation' && n.data?.status === 'pending'
    )
    .map((n) => ({
      id: n.data!.invitationId || n.id.replace('inv_', ''),
      roomId: n.data!.roomId || '',
      hostId: n.senderId || '',
      hostName: n.senderName,
      hostAvatar: n.senderAvatar,
      recipientId: currentUserId,
      recipientUsername: n.data?.recipientUsername,
      status: 'pending',
      createdAt: n.createdAt,
    }));

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        error,
        refreshNotifications,
        markAsRead,
        markAllAsRead,
        acceptInvitation,
        declineInvitation,
        respondingId,
        respondingAction,
        pendingInvitations,
        lastSenderUpdate,
        bannerToast,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => useContext(NotificationContext);
export const useInvitations = () => useContext(NotificationContext);
