import React from 'react';
import {
  Check,
  X,
  Loader2,
  Film,
  CheckCheck,
  Bell,
  AlertTriangle,
  Sparkles,
  Clock,
} from 'lucide-react';
import { Avatar } from '@/shared/components/ui/Avatar';
import { Button } from '@/shared/components/ui/Button';
import { useNotifications } from '../context/InvitationContext';
import type { AppNotification } from '../types';

interface NotificationPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  popoverRef: React.RefObject<HTMLDivElement | null>;
}

export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return 'Just now';
  const diff = Date.now() - timestamp;
  if (diff < 30_000) return 'Just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const NotificationPopover: React.FC<NotificationPopoverProps> = ({
  isOpen,
  popoverRef,
}) => {
  const {
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
  } = useNotifications();

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Notifications"
      className="absolute right-0 top-full mt-2.5 w-[360px] max-w-[calc(100vw-32px)] bg-neutral-900/95 backdrop-blur-xl border border-neutral-800 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-[480px] animate-slide-down transition-all"
      style={{
        boxShadow: '0 20px 45px -15px rgba(0, 0, 0, 0.8), 0 0 25px -5px rgba(99, 102, 241, 0.12)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800/80 bg-neutral-900/60">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white tracking-wider uppercase font-mono">
            Notifications
          </span>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-brand/20 text-brand border border-brand/30">
              {unreadCount} new
            </span>
          )}
        </div>

        {unreadCount > 0 && (
          <button
            onClick={markAllAsRead}
            className="text-[11px] font-medium text-neutral-400 hover:text-white transition-colors cursor-pointer flex items-center gap-1 hover:underline"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>Mark all read</span>
          </button>
        )}
      </div>

      {/* ── Content Body ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-neutral-800/40">
        {loading && notifications.length === 0 ? (
          /* Loading skeleton */
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 items-center animate-pulse">
                <div className="w-9 h-9 rounded-full bg-neutral-800 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-neutral-800 rounded w-3/4" />
                  <div className="h-2.5 bg-neutral-850 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : error && notifications.length === 0 ? (
          /* Error state with retry */
          <div className="py-8 px-4 text-center flex flex-col items-center">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-2.5">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <p className="text-xs font-semibold text-neutral-200">Unable to load notifications</p>
            <p className="text-[11px] text-neutral-500 mt-0.5 mb-3">{error}</p>
            <Button
              variant="secondary"
              className="h-7 px-3 text-xs"
              onClick={refreshNotifications}
            >
              Try Again
            </Button>
          </div>
        ) : notifications.length === 0 ? (
          /* Empty state */
          <div className="py-12 px-4 text-center flex flex-col items-center">
            <div className="w-11 h-11 rounded-2xl bg-neutral-800/60 border border-neutral-800 flex items-center justify-center text-neutral-500 mb-3">
              <Bell className="w-5 h-5 opacity-60" />
            </div>
            <p className="text-xs font-bold text-white">No notifications yet</p>
            <p className="text-[11px] text-neutral-400 mt-1 max-w-[210px] leading-relaxed">
              When friends or hosts invite you to Watch Parties, you'll see them right here.
            </p>
          </div>
        ) : (
          /* Notification List */
          notifications.map((item) => {
            const itemInvId =
              item.data?.invitationId || (item.id.startsWith('inv_') ? item.id.slice(4) : item.id);
            const isItemResponding = respondingId === itemInvId;
            return (
              <NotificationItem
                key={item.id}
                notification={item}
                onMarkAsRead={() => markAsRead(item.id)}
                onAcceptInvitation={acceptInvitation}
                onDeclineInvitation={declineInvitation}
                isResponding={isItemResponding}
                respondingAction={isItemResponding ? respondingAction : null}
              />
            );
          })
        )}
      </div>

      {/* ── Footer ── */}
      {notifications.length > 0 && (
        <div className="px-4 py-2 bg-neutral-950/60 border-t border-neutral-800/50 text-center">
          <span className="text-[10px] text-neutral-500 font-mono">
            All notifications caught up
          </span>
        </div>
      )}
    </div>
  );
};

interface NotificationItemProps {
  notification: AppNotification;
  onMarkAsRead: () => void;
  onAcceptInvitation: (invitationId: string) => Promise<void>;
  onDeclineInvitation: (invitationId: string) => Promise<void>;
  isResponding: boolean;
  respondingAction: 'accept' | 'decline' | null;
}

const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  onMarkAsRead,
  onAcceptInvitation,
  onDeclineInvitation,
  isResponding,
  respondingAction,
}) => {
  const isUnread = !notification.read;
  const isWatchParty = notification.type === 'watch_party_invitation';
  const invitationId =
    notification.data?.invitationId || (notification.id.startsWith('inv_') ? notification.id.slice(4) : notification.id);
  const status = notification.data?.status || 'pending';

  return (
    <div
      onClick={onMarkAsRead}
      className={`p-3.5 transition-colors relative cursor-pointer ${
        isUnread
          ? 'bg-neutral-850/60 hover:bg-neutral-800/70'
          : 'bg-transparent hover:bg-neutral-800/40'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <Avatar
          src={notification.senderAvatar}
          fallback={notification.senderName.charAt(0).toUpperCase()}
          size="sm"
          className="shrink-0 ring-1 ring-neutral-700/60 mt-0.5"
        />

        {/* Content Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-bold text-white truncate">
                @{notification.senderName}
              </span>
              {isWatchParty && (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-brand bg-brand/10 border border-brand/20 px-1 rounded">
                  <Film className="w-2.5 h-2.5" />
                  Party
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] text-neutral-500 font-mono">
                {formatRelativeTime(notification.createdAt)}
              </span>
              {isUnread && (
                <span className="w-2 h-2 rounded-full bg-brand shrink-0" title="Unread" />
              )}
            </div>
          </div>

          <p className="text-[11px] text-neutral-300 mt-0.5 leading-snug">
            {notification.message}
          </p>

          {/* ── Actions for Watch Party Invitation ── */}
          {isWatchParty && invitationId && (
            <div className="mt-2.5">
              {status === 'pending' ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    className="h-7 px-3 text-[11px] font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeclineInvitation(invitationId);
                    }}
                    disabled={isResponding}
                    title="Decline invitation"
                  >
                    {isResponding && respondingAction === 'decline' ? (
                      <>
                        <Loader2 className="w-3 h-3 mr-1 animate-spin text-red-400" />
                        <span>Declining…</span>
                      </>
                    ) : (
                      <>
                        <X className="w-3 h-3 mr-1 text-red-400" />
                        <span>Cancel</span>
                      </>
                    )}
                  </Button>

                  <Button
                    variant="brand"
                    className="h-7 px-3.5 text-[11px] font-bold shadow-md shadow-brand/20 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAcceptInvitation(invitationId);
                    }}
                    disabled={isResponding}
                    title="Accept invitation and join party"
                  >
                    {isResponding && respondingAction === 'accept' ? (
                      <>
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        <span>Joining…</span>
                      </>
                    ) : (
                      <>
                        <Film className="w-3 h-3 mr-1" />
                        <span>Join Party</span>
                      </>
                    )}
                  </Button>
                </div>
              ) : status === 'accepted' ? (
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md w-fit">
                  <Check className="w-3 h-3" />
                  <span>Accepted & Pre-approved</span>
                </div>
              ) : status === 'declined' ? (
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-400 bg-neutral-800/50 px-2 py-0.5 rounded-md w-fit">
                  <X className="w-3 h-3 text-neutral-500" />
                  <span>Declined</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-500">
                  <Clock className="w-3 h-3" />
                  <span>Expired</span>
                </div>
              )}
            </div>
          )}

          {/* ── Status for Admission Updates ── */}
          {notification.type === 'room_admission_update' && (
            <div className="flex items-center gap-1 text-[10px] text-brand/90 mt-1 font-mono">
              <Sparkles className="w-3 h-3 text-brand" />
              <span>Room status update</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
