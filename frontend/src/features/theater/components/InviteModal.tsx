import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Link, Copy, Check, Search, Loader2, Users, Send, Clock } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { Avatar } from '@/shared/components/ui/Avatar';
import { getFriends, searchUsers, type FriendEntry, type UserSearchResult } from '@/features/friends/api/friendApi';
import { sendRoomInvitation } from '@/features/theater/api/theaterApi';
import { useNotifications } from '@/features/invitations';
import { useAuthSession } from '@/features/auth';
import { getAnonymousUserId } from '@/shared/utils/anonymousUser';

interface InviteModalProps {
  roomId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const InviteModal: React.FC<InviteModalProps> = ({ roomId, isOpen, onClose }) => {
  const [linkCopied, setLinkCopied] = useState(false);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [codeResults, setCodeResults] = useState<UserSearchResult[]>([]);
  const [search, setSearch] = useState('');
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [searchingCode, setSearchingCode] = useState(false);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [inviteStatuses, setInviteStatuses] = useState<Record<string, 'delivered' | 'offline' | 'accepted' | 'declined'>>({});
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const codeSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { lastSenderUpdate } = useNotifications();
  const { session, isGuest } = useAuthSession();
  const currentUserId = (!isGuest && session?.user?.id)
    ? session.user.id
    : (typeof window !== 'undefined' ? localStorage.getItem('et_anon_user_id') : null) || getAnonymousUserId();

  // Listen to live recipient response updates
  useEffect(() => {
    if (!lastSenderUpdate) return;
    if (lastSenderUpdate.roomId === roomId) {
      setInviteStatuses((prev) => ({
        ...prev,
        [lastSenderUpdate.recipientId]: lastSenderUpdate.type === 'accepted' ? 'accepted' : 'declined',
      }));
    }
  }, [lastSenderUpdate, roomId]);

  const roomUrl = `${window.location.origin}/room/${roomId}`;

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const handleClose = React.useCallback(() => {
    setSearch('');
    setCodeResults([]);
    setInvitedIds(new Set());
    setInviteStatuses({});
    setInvitingId(null);
    setLinkCopied(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    let ignore = false;
    Promise.resolve().then(() => {
      if (ignore) return;
      setLoadingFriends(true);
      getFriends()
        .then((data) => { if (!ignore) setFriends(data); })
        .catch(() => { if (!ignore) setFriends([]); })
        .finally(() => { if (!ignore) setLoadingFriends(false); });
    });
    return () => { ignore = true; };
  }, [isOpen]);

  // Code / User search effect
  useEffect(() => {
    const query = search.trim();
    if (!query) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCodeResults([]);
      return;
    }

    if (codeSearchTimer.current) clearTimeout(codeSearchTimer.current);
    codeSearchTimer.current = setTimeout(async () => {
      if (/^\d{6}$/.test(query)) {
        setSearchingCode(true);
        try {
          const results = await searchUsers(query);
          setCodeResults(results);
        } catch {
          setCodeResults([]);
        } finally {
          setSearchingCode(false);
        }
      } else {
        setCodeResults([]);
      }
    }, 250);

    return () => {
      if (codeSearchTimer.current) clearTimeout(codeSearchTimer.current);
    };
  }, [search]);

  const q = search.toLowerCase().trim();
  const filteredFriends = friends
    .filter((f) => f.friendId !== currentUserId)
    .filter((f) => !q || f.username.toLowerCase().includes(q));
  const filteredCodeResults = codeResults.filter((u) => u.id !== currentUserId);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, handleClose]);

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(roomUrl);
    setLinkCopied(true);
    showToast('Room link copied to clipboard!');
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleInviteFriend = async (friend: FriendEntry) => {
    try {
      setInvitingId(friend.friendId);
      const res = await sendRoomInvitation({
        roomId,
        targetUserId: friend.friendId,
        targetUsername: friend.username,
      });
      setInvitedIds((prev) => new Set(prev).add(friend.friendId));
      setInviteStatuses((prev) => ({
        ...prev,
        [friend.friendId]: res.delivered ? 'delivered' : 'offline',
      }));
      if (res.delivered) {
        showToast(`Invitation delivered to @${friend.username}!`);
      } else {
        showToast(`Invitation sent! @${friend.username} will see it when online.`);
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Failed to send invitation';
      showToast(`Error: ${msg}`);
    } finally {
      setInvitingId(null);
    }
  };

  const handleInviteUser = async (user: UserSearchResult) => {
    try {
      setInvitingId(user.id);
      const res = await sendRoomInvitation({
        roomId,
        targetUserId: user.id,
        targetUsername: user.username,
      });
      setInvitedIds((prev) => new Set(prev).add(user.id));
      setInviteStatuses((prev) => ({
        ...prev,
        [user.id]: res.delivered ? 'delivered' : 'offline',
      }));
      if (res.delivered) {
        showToast(`Invitation delivered to @${user.username}!`);
      } else {
        showToast(`Invitation sent! @${user.username} will see it when online.`);
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Failed to send invitation';
      showToast(`Error: ${msg}`);
    } finally {
      setInvitingId(null);
    }
  };


  if (!isOpen) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(8px)' }}
      onClick={(e) => { if (e.target === overlayRef.current) handleClose(); }}
    >
      <div className="w-full max-w-md max-h-[88vh] bg-bg-card border border-neutral-800 rounded-2xl shadow-2xl animate-slide-up flex flex-col overflow-hidden my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800 shrink-0">
          <div>
            <h2 className="text-base font-extrabold text-white tracking-tight">Invite to Watch Party</h2>
            <p className="text-[10px] text-text-secondary mt-0.5 font-mono">Room: {roomId}</p>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-500 hover:text-white hover:bg-neutral-800 transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar flex-1 min-h-0">
          {/* Section 1: Copy Link */}
          <div>
            <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">
              Share Room Link
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 h-10 px-3 bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden">
                <Link className="w-3.5 h-3.5 text-neutral-600 shrink-0" />
                <input
                  readOnly
                  value={roomUrl}
                  className="flex-1 text-xs text-neutral-400 bg-transparent outline-none select-all font-mono truncate"
                  onFocus={(e) => e.target.select()}
                />
              </div>
              <Button
                variant={linkCopied ? 'emerald' : 'brand'}
                className="h-10 px-4 text-xs font-semibold shrink-0"
                onClick={handleCopyLink}
              >
                {linkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span className="ml-1.5">{linkCopied ? 'Copied!' : 'Copy'}</span>
              </Button>
            </div>
          </div>

          {/* Section 2: Friend List & Code Lookup */}
          <div>
            <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">
              Invite Friends & Guests
            </p>

            {/* Search input supporting username or 6-digit code */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-600" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter friends or enter 6-digit code…"
                className="w-full pl-9 pr-3 h-9 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-brand/50 transition-all"
              />
              {searchingCode && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500 animate-spin" />
              )}
            </div>

            {/* Exact code lookup results */}
            {filteredCodeResults.length > 0 && (
              <div className="mb-3 p-2 bg-neutral-900 border border-brand/30 rounded-xl">
                <p className="text-[9px] font-bold text-brand uppercase tracking-wider mb-1.5 px-1">
                  Found by Friend Code
                </p>
                {filteredCodeResults.map((u) => {
                  const status = inviteStatuses[u.id];
                  const isInvited = invitedIds.has(u.id) || !!status;
                  const isThisInviting = invitingId === u.id;
                  const isDeclined = status === 'declined';
                  const isAccepted = status === 'accepted';
                  const isOffline = status === 'offline';

                  return (
                    <div key={u.id} className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-neutral-800/60 transition-colors">
                      <Avatar
                        src={u.avatarUrl}
                        fallback={u.username.charAt(0).toUpperCase()}
                        size="sm"
                        className="shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-white truncate">@{u.username}</p>
                        <p className="text-[9px] text-neutral-500 font-mono">
                          {u.isGuest ? 'Temporary Guest' : 'Registered User'}
                        </p>
                      </div>
                      <Button
                        variant={isAccepted ? 'emerald' : isInvited && !isDeclined ? 'secondary' : 'brand'}
                        className={`h-6 px-2.5 text-[11px] shrink-0 ${isInvited && !isDeclined && !isAccepted ? 'opacity-80' : ''}`}
                        onClick={() => (!isInvited || isDeclined) && !isThisInviting && handleInviteUser(u)}
                        disabled={isThisInviting || (isInvited && !isDeclined)}
                      >
                        {isThisInviting ? (
                          <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Sending...</>
                        ) : isAccepted ? (
                          <><Check className="w-3 h-3 mr-1 text-emerald-400" />Accepted</>
                        ) : isDeclined ? (
                          <><Send className="w-3 h-3 mr-1" />Re-invite</>
                        ) : isOffline ? (
                          <><Clock className="w-3 h-3 mr-1 text-amber-400" />Offline</>
                        ) : isInvited ? (
                          <><Check className="w-3 h-3 mr-1" />Delivered</>
                        ) : (
                          <><Send className="w-3 h-3 mr-1" />Invite</>
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Friend list */}
            <div className="max-h-52 overflow-y-auto custom-scrollbar space-y-1.5">
              {loadingFriends ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-5 h-5 text-brand animate-spin" />
                </div>
              ) : filteredFriends.length === 0 ? (
                <div className="text-center py-6 text-text-secondary">
                  <Users className="w-7 h-7 mx-auto mb-1.5 opacity-30" />
                  <p className="text-xs">
                    {friends.length === 0 ? 'Add friends to invite them directly.' : `No friends matching "${search}"`}
                  </p>
                </div>
              ) : (
                filteredFriends.map((friend) => {
                  const status = inviteStatuses[friend.friendId];
                  const isInvited = invitedIds.has(friend.friendId) || !!status;
                  const isThisInviting = invitingId === friend.friendId;
                  const isDeclined = status === 'declined';
                  const isAccepted = status === 'accepted';
                  const isOffline = status === 'offline';

                  return (
                    <div
                      key={friend.friendshipId}
                      className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-neutral-800/50 transition-colors"
                    >
                      <Avatar
                        src={friend.avatarUrl}
                        fallback={friend.username.charAt(0).toUpperCase()}
                        size="sm"
                        className="shrink-0"
                      />
                      <span className="flex-1 text-sm font-semibold text-white truncate min-w-0">
                        @{friend.username}
                      </span>
                      <Button
                        variant={isAccepted ? 'emerald' : isInvited && !isDeclined ? 'secondary' : 'brand'}
                        className={`h-7 px-3 text-xs shrink-0 ${isInvited && !isDeclined && !isAccepted ? 'opacity-80' : ''}`}
                        onClick={() => (!isInvited || isDeclined) && !isThisInviting && handleInviteFriend(friend)}
                        disabled={isThisInviting || (isInvited && !isDeclined)}
                      >
                        {isThisInviting ? (
                          <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Sending...</>
                        ) : isAccepted ? (
                          <><Check className="w-3 h-3 mr-1 text-emerald-400" />Accepted</>
                        ) : isDeclined ? (
                          <><Send className="w-3 h-3 mr-1" />Re-invite</>
                        ) : isOffline ? (
                          <><Clock className="w-3 h-3 mr-1 text-amber-400" />Sent (Offline)</>
                        ) : isInvited ? (
                          <><Check className="w-3 h-3 mr-1" />Delivered</>
                        ) : (
                          <><Send className="w-3 h-3 mr-1" />Invite</>
                        )}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Inline Toast */}
        {toast && (
          <div className="mx-5 mb-4 shrink-0 flex items-center gap-2 px-3 py-2.5 bg-emerald-950/40 border border-emerald-900/50 text-emerald-400 rounded-xl text-xs font-medium animate-slide-up">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>{toast}</span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
