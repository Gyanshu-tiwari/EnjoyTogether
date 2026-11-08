import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, UserPlus, UserCheck, UserX, Loader2, Users, AlertCircle, Copy, CheckCircle2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { Avatar } from '@/shared/components/ui/Avatar';
import { Badge } from '@/shared/components/ui/Badge';
import { supabase } from '@/shared/lib/supabase';
import { useAuthSession } from '@/features/auth';
import { getAnonymousUserId } from '@/shared/utils/anonymousUser';
import {
  searchUsers,
  sendFriendRequest,
  respondToRequest,
  getFriends,
  getPendingRequests,
  getUserProfile,
  initGuestSession,
  type UserSearchResult,
  type FriendEntry,
  type PendingRequest,
} from '../api/friendApi';

export const FriendsTab: React.FC = () => {
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { session } = useAuthSession();
  const [friendCode, setFriendCode] = useState<string | null>(() => {
    if (typeof window !== 'undefined' && !session?.user?.id) {
      return localStorage.getItem('et_anon_friend_code') || null;
    }
    return null;
  });
  const [codeLoading, setCodeLoading] = useState<boolean>(true);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [accountInfo, setAccountInfo] = useState<{
    displayName: string;
    avatarUrl?: string | null;
    isGuest: boolean;
  }>({
    displayName: 'My Account',
    isGuest: false,
  });
  const [copied, setCopied] = useState(false);

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const fetchIdentityAndCode = useCallback(async () => {
    setCodeLoading(true);
    setCodeError(null);

    try {
      // 1. Authoritative registered user identity
      const { data: sessionData } = await supabase.auth.getSession();
      const currentSession = sessionData.session || session;

      if (currentSession?.user?.id) {
        const meta = currentSession.user.user_metadata;
        const initialName = meta?.username || meta?.full_name || currentSession.user.email?.split('@')[0] || 'User';
        const initialAvatar = meta?.avatar_url || null;

        setAccountInfo({
          displayName: initialName,
          avatarUrl: initialAvatar,
          isGuest: false,
        });

        const profile = await getUserProfile();
        if (profile) {
          if (profile.username) {
            setAccountInfo((prev) => ({
              ...prev,
              displayName: profile.username || prev.displayName,
              avatarUrl: profile.avatarUrl !== undefined ? profile.avatarUrl : prev.avatarUrl,
            }));
          }
          if (profile.friendCode) {
            setFriendCode(profile.friendCode);
            setCodeLoading(false);
            return;
          }
        }

        setCodeError('Friend code not available.');
        setCodeLoading(false);
        return;
      }

      // 2. Anonymous guest user identity
      setAccountInfo({
        displayName: 'Guest User',
        avatarUrl: null,
        isGuest: true,
      });

      const guestId = (typeof window !== 'undefined' ? localStorage.getItem('et_anon_user_id') : null) || getAnonymousUserId();
      const existingSecret = typeof window !== 'undefined' ? (localStorage.getItem('et_anon_session_secret') || undefined) : undefined;
      const cachedCode = typeof window !== 'undefined' ? localStorage.getItem('et_anon_friend_code') : null;

      if (cachedCode && cachedCode.length === 6 && existingSecret) {
        setFriendCode(cachedCode);
      }

      const guestSession = await initGuestSession(guestId, existingSecret);
      if (guestSession?.friendCode) {
        if (typeof window !== 'undefined') {
          localStorage.setItem('et_anon_user_id', guestSession.guestId);
          localStorage.setItem('et_anon_friend_code', guestSession.friendCode);
          localStorage.setItem('et_anon_session_secret', guestSession.sessionSecret);
        }
        setFriendCode(guestSession.friendCode);
        setCodeLoading(false);
      } else if (cachedCode) {
        setFriendCode(cachedCode);
        setCodeLoading(false);
      } else {
        setCodeError('Failed to allocate guest friend code.');
        setCodeLoading(false);
      }
    } catch (err) {
      console.error('[FriendsTab] Failed to resolve friend code:', err);
      const cached = typeof window !== 'undefined' ? localStorage.getItem('et_anon_friend_code') : null;
      if (cached && cached.length === 6) {
        setFriendCode(cached);
        setCodeLoading(false);
      } else {
        setCodeError('Unable to load friend code.');
        setCodeLoading(false);
      }
    }
  }, [session]);

  useEffect(() => {
    fetchIdentityAndCode();
  }, [fetchIdentityAndCode]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fData, pData] = await Promise.all([
        getFriends(),
        getPendingRequests()
      ]);
      setFriends(fData);
      setPending(pData);
    } catch {
      setError('Failed to load friends data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults([]);
      return;
    }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchUsers(searchQuery);
        setSearchResults(results);
      } catch {
        setError('Search failed.');
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [searchQuery]);

  const handleSendRequest = async (userId: string) => {
    setActionLoading(userId);
    try {
      await sendFriendRequest(userId);
      setSearchResults((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, friendshipStatus: 'PENDING' } : u))
      );
    } catch {
      setError('Failed to send request.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRespond = async (friendshipId: string, action: 'ACCEPT' | 'REJECT') => {
    setActionLoading(friendshipId);
    try {
      await respondToRequest(friendshipId, action);
      await loadData(); // Reload both lists
    } catch {
      setError('Failed to respond to request.');
    } finally {
      setActionLoading(null);
    }
  };

  const copyFriendCode = () => {
    if (!friendCode) return;
    navigator.clipboard.writeText(friendCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formattedCode = friendCode && friendCode.length === 6 ? `${friendCode.slice(0, 3)} ${friendCode.slice(3, 6)}` : friendCode;

  return (
    <div className="w-full max-w-6xl animate-fade-in grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 items-start mx-auto mt-4">
      {/* Left Column: Actions & Search */}
      <div className="flex flex-col gap-6">

        {/* Friend Code & Pending Card */}
        <div className="bg-[#111214] border border-white/5 rounded-[24px] p-6 shadow-2xl">
           <div className="flex items-center gap-3 mb-6">
              <Avatar
                src={accountInfo.avatarUrl || undefined}
                fallback={accountInfo.displayName.charAt(0).toUpperCase()}
                size="lg"
                className="border-neutral-800"
              />
              <div className="flex flex-col min-w-0">
                 <span className="text-base font-bold text-white truncate">{accountInfo.displayName}</span>
                 {friendCode ? (
                   <span className="text-xs text-neutral-500 font-mono">#{friendCode}</span>
                 ) : (
                   <span className="text-xs text-neutral-500 font-mono">
                     {accountInfo.isGuest ? 'Guest Session' : 'Account'}
                   </span>
                 )}
              </div>
           </div>

           <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 mb-2 relative overflow-hidden group">
              <div className="flex justify-between items-center mb-3 relative z-10">
                 <h4 className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">YOUR FRIEND CODE</h4>
                 {friendCode && (
                   <button
                     onClick={copyFriendCode}
                     className="text-[10px] font-bold flex items-center gap-1.5 text-neutral-400 hover:text-white transition-colors cursor-pointer"
                   >
                     {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                     {copied ? 'Copied' : 'Copy'}
                   </button>
                 )}
              </div>

              {codeLoading && !friendCode ? (
                <div className="flex items-center gap-3 py-3 relative z-10">
                  <Loader2 className="w-6 h-6 animate-spin text-brand" />
                  <span className="text-xs text-neutral-400 font-mono animate-pulse">Loading friend code...</span>
                </div>
              ) : codeError && !friendCode ? (
                <div className="py-2 relative z-10">
                  <p className="text-xs text-red-400 mb-2 font-medium">{codeError}</p>
                  <button
                    onClick={fetchIdentityAndCode}
                    className="text-[11px] font-semibold text-brand hover:underline cursor-pointer"
                  >
                    Retry loading code
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-3xl font-black text-white tracking-[0.2em] mb-2 font-mono relative z-10">
                    {formattedCode || '------'}
                  </p>
                  <p className="text-[11px] text-neutral-500 font-medium relative z-10">
                    {accountInfo.isGuest
                      ? 'Temporary 6-digit code for this guest session'
                      : 'Share your permanent 6-digit code with friends'}
                  </p>
                </>
              )}
           </div>

           {/* Pending Requests */}
           {pending.length > 0 && (
             <div className="mt-4 pt-4 border-t border-white/5">
                <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-3">Pending Invitations ({pending.length})</h4>
                <div className="flex flex-col gap-2">
                   {pending.map((req) => (
                     <div key={req.friendshipId} className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-800 rounded-xl">
                        <Avatar src={req.avatarUrl} fallback={req.username.charAt(0).toUpperCase()} size="sm" className="shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">@{req.username}</p>
                          <p className="text-[10px] text-brand font-medium">{req.direction === 'incoming' ? 'Sent you a request' : 'Request sent'}</p>
                        </div>
                        {req.direction === 'incoming' && (
                          <div className="flex gap-1.5 shrink-0">
                            <button
                              onClick={() => handleRespond(req.friendshipId, 'ACCEPT')}
                              disabled={actionLoading === req.friendshipId}
                              className="w-8 h-8 rounded-lg bg-brand/20 hover:bg-brand/30 text-brand flex items-center justify-center transition-colors cursor-pointer"
                            >
                              {actionLoading === req.friendshipId ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => handleRespond(req.friendshipId, 'REJECT')}
                              disabled={actionLoading === req.friendshipId}
                              className="w-8 h-8 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 flex items-center justify-center transition-colors cursor-pointer"
                            >
                              {actionLoading === req.friendshipId ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
                            </button>
                          </div>
                        )}
                     </div>
                   ))}
                </div>
             </div>
           )}
        </div>

        {/* Find People Card */}
        <div className="bg-[#111214] border border-white/5 rounded-[24px] p-6 shadow-2xl">
           <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-400 shrink-0">
                 <UserPlus className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-white tracking-tight">Find People</h3>
           </div>

           <p className="text-xs text-neutral-400 mb-6">
              Search by exact 6-digit <span className="font-bold text-white">Friend Code</span> or username.
           </p>

           <div className="relative mb-6">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="e.g. 042918 or john"
                className="w-full pl-10 pr-4 h-11 bg-neutral-900 border border-neutral-800 rounded-xl text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-brand/50 transition-all font-medium"
              />
              {searching && (
                <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 animate-spin" />
              )}
           </div>

           {error && (
             <div className="flex items-center gap-2 mb-4 p-3 bg-red-950/30 border border-red-900/50 text-red-400 rounded-xl text-[11px] font-medium">
               <AlertCircle className="w-4 h-4 shrink-0" />
               <span>{error}</span>
             </div>
           )}

           {searchQuery.trim() && searchResults.length > 0 && (
              <div className="flex flex-col gap-2 mb-4">
                 {searchResults.map((user) => (
                    <div key={user.id} className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-800 rounded-xl">
                       <Avatar src={user.avatarUrl} fallback={user.username.charAt(0).toUpperCase()} size="sm" className="shrink-0" />
                       <div className="flex-1 min-w-0">
                         <p className="text-sm font-semibold text-white truncate">@{user.username}</p>
                         {user.friendCode && (
                           <p className="text-[10px] text-neutral-500 font-mono">#{user.friendCode}</p>
                         )}
                       </div>
                       <div className="shrink-0">
                         {user.isGuest ? (
                           <div className="flex flex-col items-end">
                             <Badge variant="warning" className="text-[10px] text-amber-400 border-amber-500/30">Guest</Badge>
                             <span className="text-[9px] text-neutral-500 mt-0.5">Watch Party only</span>
                           </div>
                         ) : user.friendshipStatus === 'ACCEPTED' ? (
                           <Badge variant="success">Friends</Badge>
                         ) : user.friendshipStatus === 'PENDING' ? (
                           <Badge variant="warning">Pending</Badge>
                         ) : (
                           <Button
                             variant="brand"
                             className="h-8 px-4 text-xs font-bold"
                             onClick={() => handleSendRequest(user.id)}
                             disabled={actionLoading === user.id}
                           >
                             {actionLoading === user.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Add'}
                           </Button>
                         )}
                       </div>
                    </div>
                 ))}
              </div>
           )}

           <div className="flex items-center gap-2 text-[11px] text-neutral-500 font-medium">
              <span className="text-brand text-sm leading-none">✨</span>
              Click a user to view their profile.
           </div>
        </div>
      </div>

      {/* Right Column: Connections Panel */}
      <div className="bg-[#111214] border border-white/5 rounded-[24px] p-6 shadow-2xl flex flex-col min-h-150 relative overflow-hidden">
         <div className="flex items-center justify-between mb-8 pb-4 border-b border-white/5">
            <h2 className="text-3xl font-black text-white tracking-tight">Connections</h2>
            <button
              onClick={() => {
                searchInputRef.current?.focus();
              }}
              className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl text-xs font-bold transition-all cursor-pointer text-white flex items-center gap-2"
            >
              <UserPlus className="w-3.5 h-3.5" />
              + Add
            </button>
         </div>

         {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 text-brand animate-spin" />
            </div>
         ) : friends.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 text-neutral-500">
               <Users className="w-12 h-12 mb-4 opacity-20" />
               <p className="text-sm font-medium">You don't have any connections yet.</p>
               <p className="text-xs mt-1">Use the search panel to find your friends.</p>
            </div>
         ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {friends.map((f) => (
                 <div key={f.friendshipId} className="bg-[#0a0a0a] border border-neutral-800 rounded-2xl p-4 flex items-center gap-4 group hover:border-neutral-700 transition-colors">
                    <div className="relative shrink-0">
                       <Avatar src={f.avatarUrl} fallback={f.username.charAt(0).toUpperCase()} size="lg" className="border-neutral-800" />
                       <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-[#0a0a0a] rounded-full"></div>
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                       <span className="text-base font-bold text-white truncate">{f.username}</span>
                       <span className="text-xs text-green-500 font-semibold font-mono">Online</span>
                    </div>
                    <button className="text-[10px] font-bold text-neutral-500 hover:text-white transition-colors flex items-center gap-1 opacity-0 group-hover:opacity-100 cursor-pointer pr-2">
                       View profile <span className="text-brand">→</span>
                    </button>
                 </div>
               ))}
            </div>
         )}
      </div>
    </div>
  );
};
