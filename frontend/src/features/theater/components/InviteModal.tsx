import React, { useState, useEffect, useRef } from 'react';
import { X, Link, Copy, Check, Search, Loader2, Users, Send } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { Avatar } from '@/shared/components/ui/Avatar';
import { getFriends, type FriendEntry } from '@/features/friends/api/friendApi';

interface InviteModalProps {
  roomId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const InviteModal: React.FC<InviteModalProps> = ({ roomId, isOpen, onClose }) => {
  const [linkCopied, setLinkCopied] = useState(false);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [search, setSearch] = useState('');
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const roomUrl = `${window.location.origin}/room/${roomId}`;

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  };

  const handleClose = () => {
    setSearch('');
    setInvitedIds(new Set());
    setLinkCopied(false);
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;

    setLoadingFriends(true);
    getFriends()
      .then((data) => { setFriends(data); })
      .catch(() => { setFriends([]); })
      .finally(() => setLoadingFriends(false));
  }, [isOpen]);

  const q = search.toLowerCase().trim();
  const filteredFriends = q ? friends.filter((f) => f.username.toLowerCase().includes(q)) : friends;

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(roomUrl);
    setLinkCopied(true);
    showToast('Room link copied to clipboard!');
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleInviteFriend = async (friend: FriendEntry) => {
    await navigator.clipboard.writeText(roomUrl);
    setInvitedIds((prev) => new Set(prev).add(friend.friendId));
    showToast(`Link copied — invite sent to @${friend.username}!`);
  };

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-9000 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)' }}
      onClick={(e) => { if (e.target === overlayRef.current) handleClose(); }}
    >
      <div className="w-full max-w-md bg-bg-card border border-neutral-800 rounded-2xl shadow-2xl animate-slide-up overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
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

        <div className="p-5 space-y-5">
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

          {/* Section 2: Friend List */}
          <div>
            <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-2">
              Invite Friends
            </p>

            {/* Search within friends */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-600" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter friends…"
                className="w-full pl-9 pr-3 h-9 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-brand/50 transition-all"
              />
            </div>

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
                  const invited = invitedIds.has(friend.friendId);
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
                        variant={invited ? 'secondary' : 'brand'}
                        className={`h-7 px-3 text-xs shrink-0 ${invited ? 'opacity-60' : ''}`}
                        onClick={() => !invited && handleInviteFriend(friend)}
                        disabled={invited}
                      >
                        {invited ? (
                          <><Check className="w-3 h-3 mr-1" />Invited</>
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
          <div className="mx-5 mb-4 flex items-center gap-2 px-3 py-2.5 bg-emerald-950/40 border border-emerald-900/50 text-emerald-400 rounded-xl text-xs font-medium animate-slide-up">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>{toast}</span>
          </div>
        )}
      </div>
    </div>
  );
};
