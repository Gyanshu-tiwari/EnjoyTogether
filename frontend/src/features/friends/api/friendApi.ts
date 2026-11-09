import { apiClient } from '@/shared/api/apiClient';

export type FriendshipStatus = 'NONE' | 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface UserSearchResult {
  id: string;
  username: string;
  avatarUrl?: string;
  friendCode?: string;
  identityType?: 'REGISTERED' | 'GUEST';
  isGuest?: boolean;
  friendshipStatus: FriendshipStatus;
  friendshipId?: string;
}

export interface FriendEntry {
  friendshipId: string;
  friendId: string;
  username: string;
  avatarUrl?: string;
  status: FriendshipStatus;
}

export interface PendingRequest {
  friendshipId: string;
  userId: string;
  username: string;
  avatarUrl?: string;
  direction: 'incoming' | 'outgoing';
  status: FriendshipStatus;
  createdAt?: string;
}

export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const res = await apiClient.get<{ data: { users: UserSearchResult[] } }>(
    `/api/friends/search?q=${encodeURIComponent(query)}`
  );
  return res.data?.data?.users ?? [];
}

export async function sendFriendRequest(addresseeId: string): Promise<void> {
  await apiClient.post('/api/friends/request', { addresseeId });
}

export async function respondToRequest(
  friendshipId: string,
  action: 'ACCEPT' | 'REJECT'
): Promise<void> {
  await apiClient.patch('/api/friends/respond', { friendshipId, action });
}

export async function getFriends(): Promise<FriendEntry[]> {
  const res = await apiClient.get<{ data: { friends: FriendEntry[] } }>('/api/friends');
  return res.data?.data?.friends ?? [];
}

export async function getPendingRequests(): Promise<PendingRequest[]> {
  const res = await apiClient.get<{ data: { requests: PendingRequest[] } }>('/api/friends/pending');
  return res.data?.data?.requests ?? [];
}

export async function deleteFriendship(friendshipId: string): Promise<void> {
  await apiClient.delete(`/api/friends/${friendshipId}`);
}

export async function syncGoogleProfile(username: string, avatarUrl?: string): Promise<void> {
  await apiClient.post('/api/users/sync-google', { username, avatarUrl });
}

export async function getUserProfile(): Promise<{ username?: string; avatarUrl?: string; friendCode?: string } | null> {
  try {
    const res = await apiClient.get<{ data: { profile: { username?: string; avatarUrl?: string; friendCode?: string } } }>(
      '/api/users/profile'
    );
    return res.data?.data?.profile ?? null;
  } catch {
    return null;
  }
}

export async function initGuestSession(
  guestId?: string,
  sessionSecret?: string
): Promise<{ guestId: string; friendCode: string; sessionSecret: string; expiresAt: string; isNew: boolean }> {
  const headers: Record<string, string> = {};
  if (sessionSecret) headers['x-guest-secret'] = sessionSecret;

  const res = await apiClient.post<{ data: { guestId: string; friendCode: string; sessionSecret: string; expiresAt: string; isNew: boolean } }>(
    '/api/guests/session',
    { guestId, sessionSecret },
    { headers }
  );
  return res.data.data;
}

export async function revokeGuestSession(guestId: string, sessionSecret?: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (sessionSecret) headers['x-guest-secret'] = sessionSecret;

  await apiClient.post('/api/guests/revoke', { guestId, sessionSecret }, { headers });
}

export async function transitionGuestSession(guestId: string, sessionSecret?: string): Promise<{ friendCode: string }> {
  const headers: Record<string, string> = {};
  if (sessionSecret) headers['x-guest-secret'] = sessionSecret;

  const res = await apiClient.post<{ data: { friendCode: string } }>(
    '/api/guests/transition',
    { guestId, sessionSecret },
    { headers }
  );
  return res.data.data;
}
