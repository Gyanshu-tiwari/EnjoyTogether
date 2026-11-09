import React from 'react';
import { Film, Check, X, Loader2, Bell } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { Avatar } from '@/shared/components/ui/Avatar';
import { useInvitations } from '../context/InvitationContext';

export const InvitationBanner: React.FC = () => {
  const {
    pendingInvitations,
    acceptInvitation,
    declineInvitation,
    respondingId,
    bannerToast,
  } = useInvitations();

  return (
    <div className="fixed top-4 right-4 z-9999 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
      {/* Toast Notification */}
      {bannerToast && (
        <div className="pointer-events-auto bg-neutral-900/95 border border-brand/40 text-neutral-200 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md flex items-center gap-2.5 animate-slide-up text-xs font-medium">
          <Bell className="w-4 h-4 text-brand shrink-0 animate-bounce" />
          <span className="flex-1">{bannerToast}</span>
        </div>
      )}

      {/* Pending Room Invitations */}
      {pendingInvitations.map((inv) => {
        const isResponding = respondingId === inv.id;

        return (
          <div
            key={inv.id}
            className="pointer-events-auto bg-bg-card/95 border border-brand/50 rounded-2xl p-4 shadow-2xl backdrop-blur-lg flex flex-col gap-3 animate-slide-up transition-all"
            style={{
              boxShadow: '0 10px 30px -5px rgba(99, 102, 241, 0.25), 0 0 15px rgba(99, 102, 241, 0.15)',
            }}
          >
            {/* Header / Badge */}
            <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2">
              <div className="flex items-center gap-1.5 text-brand text-xs font-bold tracking-tight">
                <Film className="w-3.5 h-3.5" />
                <span>Watch Party Invitation</span>
              </div>
              <span className="text-[10px] font-mono text-neutral-500">
                {inv.roomId.slice(0, 8)}…
              </span>
            </div>

            {/* Host info & invitation text */}
            <div className="flex items-center gap-3">
              <Avatar
                src={inv.hostAvatar}
                fallback={inv.hostName.charAt(0).toUpperCase()}
                size="md"
                className="shrink-0 ring-2 ring-brand/30"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-white truncate">
                  @{inv.hostName}
                </p>
                <p className="text-[11px] text-text-secondary leading-tight mt-0.5">
                  Invited you to watch together in party room!
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                variant="secondary"
                className="h-8 px-3 text-xs text-neutral-400 hover:text-white hover:bg-neutral-800 cursor-pointer"
                onClick={() => declineInvitation(inv.id)}
                disabled={isResponding}
              >
                <X className="w-3.5 h-3.5 mr-1 text-red-400" />
                <span>Decline</span>
              </Button>
              <Button
                variant="brand"
                className="h-8 px-4 text-xs font-bold shadow-lg shadow-brand/25 cursor-pointer"
                onClick={() => acceptInvitation(inv.id)}
                disabled={isResponding}
              >

                {isResponding ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    <span>Joining…</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5 mr-1" />
                    <span>Accept & Join</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
