import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, UserPlus, UserCheck, UserX, Loader2, Clock, Users, AlertCircle } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { Avatar } from '@/shared/components/ui/Avatar';
import { Badge } from '@/shared/components/ui/Badge';
import {
  searchUsers,
  sendFriendRequest,
  respondToRequest,
  getFriends,
  getPendingRequests,
  deleteFriendship,
  type UserSearchResult,
  type FriendEntry,
  type PendingRequest,
} from '../api/friendApi';

type SubTab = 'friends' | 'pending' | 'find';

export const FriendsTab: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SubTab>('friends');
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // tracks which id is loading
  const [error, setError] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFriends = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getFriends();
      setFriends(data);
    } catch {
      setError('Failed to load friends list.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getPendingRequests();
      setPending(data);
    } catch {
      setError('Failed to load pending requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'friends') loadFriends();
    if (activeTab === 'pending') loadPending();
    if (activeTab === 'find') {
      setSearchResults([]);
      setSearchQuery('');
    }
  }, [activeTab, loadFriends, loadPending]);

  // Debounced search
  useEffect(() => {
    if (activeTab !== 'find') return;
    if (!searchQuery.trim()) {
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
  }, [searchQuery, activeTab]);

  const handleSendRequest = async (userId: string) => {
    setActionLoading(userId);
    try {
      await sendFriendRequest(userId);
      setSearchResults((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, friendshipStatus: 'PENDING' } : u))
      );
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to send request.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRespond = async (friendshipId: string, action: 'ACCEPT' | 'REJECT') => {
    setActionLoading(friendshipId);
    try {
      await respondToRequest(friendshipId, action);
      await loadPending();
      if (action === 'ACCEPT') await loadFriends();
    } catch {
      setError('Failed to respond to request.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnfriend = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    try {
      await deleteFriendship(friendshipId);
      setFriends((prev) => prev.filter((f) => f.friendshipId !== friendshipId));
    } catch {
      setError('Failed to remove friend.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelRequest = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    try {
      await deleteFriendship(friendshipId);
      setPending((prev) => prev.filter((p) => p.friendshipId !== friendshipId));
    } catch {
      setError('Failed to cancel request.');
    } finally {
      setActionLoading(null);
    }
  };

  const TABS: { key: SubTab; label: string; icon: React.ReactNode }[] = [
    { key: 'friends', label: 'My Friends', icon: <Users className="w-3.5 h-3.5" /> },
    { key: 'pending', label: 'Pending', icon: <Clock className="w-3.5 h-3.5" /> },
    { key: 'find', label: 'Find Users', icon: <Search className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="mt-6">
      <h2 className="text-base font-extrabold text-white mb-4 tracking-tight">Friends</h2>

      {/* Sub-tab bar */}
      <div className="flex gap-1 p-1 bg-neutral-950 border border-neutral-800 rounded-xl mb-5">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setError(null); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-all duration-200 cursor-pointer ${
              activeTab === tab.key
                ? 'bg-bg-card text-white border border-neutral-800 shadow-sm'
                : 'text-text-secondary hover:text-white'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error alert */}
      {error && (
        <div className="flex items-center gap-2 mb-4 p-3 bg-red-950/30 border border-red-900/50 text-red-400 rounded-xl text-xs font-medium">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-500 hover:text-red-300 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── My Friends ───────────────────────────────────────────── */}
      {activeTab === 'friends' && (
        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 text-brand animate-spin" />
            </div>
          ) : friends.length === 0 ? (
            <div className="text-center py-10 text-text-secondary">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No friends yet. Use Find Users to connect!</p>
            </div>
          ) : (
            friends.map((f) => (
              <div
                key={f.friendshipId}
                className="flex items-center gap-3 p-3 bg-neutral-950 border border-neutral-800 rounded-xl"
              >
                <Avatar
                  src={f.avatarUrl}
                  fallback={f.username.charAt(0).toUpperCase()}
                  size="md"
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">@{f.username}</p>
                  <Badge variant="success" className="mt-0.5">Friends</Badge>
                </div>
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-red-400 hover:border-red-900/50 shrink-0"
                  onClick={() => handleUnfriend(f.friendshipId)}
                  disabled={actionLoading === f.friendshipId}
                >
                  {actionLoading === f.friendshipId ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <><UserX className="w-3.5 h-3.5 mr-1" />Unfriend</>
                  )}
                </Button>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Pending Requests ─────────────────────────────────────── */}
      {activeTab === 'pending' && (
        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 text-brand animate-spin" />
            </div>
          ) : pending.length === 0 ? (
            <div className="text-center py-10 text-text-secondary">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No pending requests.</p>
            </div>
          ) : (
            pending.map((req) => (
              <div
                key={req.friendshipId}
                className="flex items-center gap-3 p-3 bg-neutral-950 border border-neutral-800 rounded-xl"
              >
                <Avatar
                  src={req.avatarUrl}
                  fallback={req.username.charAt(0).toUpperCase()}
                  size="md"
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">@{req.username}</p>
                  <Badge variant={req.direction === 'incoming' ? 'warning' : 'default'} className="mt-0.5">
                    {req.direction === 'incoming' ? 'Incoming' : 'Sent'}
                  </Badge>
                </div>
                <div className="flex gap-2 shrink-0">
                  {req.direction === 'incoming' ? (
                    <>
                      <Button
                        variant="secondary"
                        className="h-8 px-3 text-xs bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-red-400"
                        onClick={() => handleRespond(req.friendshipId, 'REJECT')}
                        disabled={actionLoading === req.friendshipId}
                      >
                        {actionLoading === req.friendshipId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><UserX className="w-3.5 h-3.5 mr-1" />Reject</>}
                      </Button>
                      <Button
                        variant="brand"
                        className="h-8 px-3 text-xs"
                        onClick={() => handleRespond(req.friendshipId, 'ACCEPT')}
                        disabled={actionLoading === req.friendshipId}
                      >
                        {actionLoading === req.friendshipId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><UserCheck className="w-3.5 h-3.5 mr-1" />Accept</>}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      className="h-8 px-3 text-xs bg-neutral-900 border-neutral-800 text-neutral-400"
                      onClick={() => handleCancelRequest(req.friendshipId)}
                      disabled={actionLoading === req.friendshipId}
                    >
                      {actionLoading === req.friendshipId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Cancel'}
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Find Users ───────────────────────────────────────────── */}
      {activeTab === 'find' && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-600" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by username…"
              className="w-full pl-10 pr-4 h-10 bg-neutral-950 border border-neutral-800 rounded-xl text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-brand/50 transition-all"
            />
            {searching && (
              <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 animate-spin" />
            )}
          </div>

          <div className="space-y-2">
            {!searchQuery.trim() && (
              <p className="text-center text-xs text-text-secondary py-6">
                Type a username to search for people.
              </p>
            )}
            {searchQuery.trim() && !searching && searchResults.length === 0 && (
              <p className="text-center text-xs text-text-secondary py-6">No users found for "{searchQuery}"</p>
            )}
            {searchResults.map((user) => (
              <div
                key={user.id}
                className="flex items-center gap-3 p-3 bg-neutral-950 border border-neutral-800 rounded-xl"
              >
                <Avatar
                  src={user.avatarUrl}
                  fallback={user.username.charAt(0).toUpperCase()}
                  size="md"
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">@{user.username}</p>
                </div>
                <div className="shrink-0">
                  {user.friendshipStatus === 'ACCEPTED' ? (
                    <Badge variant="success">Friends</Badge>
                  ) : user.friendshipStatus === 'PENDING' ? (
                    <Badge variant="warning">Pending</Badge>
                  ) : (
                    <Button
                      variant="brand"
                      className="h-8 px-3 text-xs"
                      onClick={() => handleSendRequest(user.id)}
                      disabled={actionLoading === user.id}
                    >
                      {actionLoading === user.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <><UserPlus className="w-3.5 h-3.5 mr-1" />Add</>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
