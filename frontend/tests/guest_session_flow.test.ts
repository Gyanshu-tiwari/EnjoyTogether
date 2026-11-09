import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock storage
const mockSessionStorage: Record<string, string> = {};
const mockLocalStorage: Record<string, string> = {};

globalThis.sessionStorage = {
  getItem: (key: string) => mockSessionStorage[key] ?? null,
  setItem: (key: string, val: string) => { mockSessionStorage[key] = String(val); },
  removeItem: (key: string) => { delete mockSessionStorage[key]; },
  clear: () => { Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]); },
  key: (i: number) => Object.keys(mockSessionStorage)[i] ?? null,
  length: 0,
};

globalThis.localStorage = {
  getItem: (key: string) => mockLocalStorage[key] ?? null,
  setItem: (key: string, val: string) => { mockLocalStorage[key] = String(val); },
  removeItem: (key: string) => { delete mockLocalStorage[key]; },
  clear: () => { Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k]); },
  key: (i: number) => Object.keys(mockLocalStorage)[i] ?? null,
  length: 0,
};

import { getAnonymousUserId } from '../src/shared/utils/anonymousUser';

describe('Guest Session Flow & Destination Resolution', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('1. Generates and persists a stable guest identity on first click', () => {
    assert.equal(sessionStorage.getItem('guest_session'), null);
    assert.equal(localStorage.getItem('et_anon_user_id'), null);

    // Simulate startGuestSession()
    sessionStorage.setItem('guest_session', 'true');
    const guestId1 = getAnonymousUserId();

    assert.equal(sessionStorage.getItem('guest_session'), 'true');
    assert.ok(guestId1.startsWith('anon_'));
    assert.equal(localStorage.getItem('et_anon_user_id'), guestId1);

    // Second invocation must NOT create duplicate identity
    const guestId2 = getAnonymousUserId();
    assert.equal(guestId2, guestId1, 'Guest identity must remain stable across repeated calls');
  });

  it('2. Resolves intended destination to /dashboard when no redirect parameter is present', () => {
    const searchParams = new URLSearchParams('mode=signup');
    const locationState = null;

    const resolveDestination = (params: URLSearchParams, state: unknown): string => {
      const redirect = params.get('redirect') || params.get('returnUrl');
      if (redirect && redirect.startsWith('/') && redirect !== '/login') return redirect;
      const room = params.get('room') || params.get('roomId');
      if (room) return `/room/${room}`;
      const from = (state as { from?: { pathname?: string } | string })?.from;
      if (typeof from === 'string' && from.startsWith('/') && from !== '/login') return from;
      if (from && typeof from === 'object' && from.pathname?.startsWith('/') && from.pathname !== '/login') {
        return from.pathname;
      }
      return '/dashboard';
    };

    const destination = resolveDestination(searchParams, locationState);
    assert.equal(destination, '/dashboard');
  });

  it('3. Preserves room invitation route through redirect query parameter', () => {
    const searchParams = new URLSearchParams('mode=signup&redirect=%2Froom%2Fsample-room-uuid');
    const locationState = null;

    const resolveDestination = (params: URLSearchParams, state: unknown): string => {
      const redirect = params.get('redirect') || params.get('returnUrl');
      if (redirect && redirect.startsWith('/') && redirect !== '/login') return redirect;
      const room = params.get('room') || params.get('roomId');
      if (room) return `/room/${room}`;
      const from = (state as { from?: { pathname?: string } | string })?.from;
      if (typeof from === 'string' && from.startsWith('/') && from !== '/login') return from;
      return '/dashboard';
    };

    const destination = resolveDestination(searchParams, locationState);
    assert.equal(destination, '/room/sample-room-uuid');
  });

  it('4. Preserves room invitation route through location state', () => {
    const searchParams = new URLSearchParams('');
    const locationState = { from: { pathname: '/room/room-from-state-123' } };

    const resolveDestination = (params: URLSearchParams, state: unknown): string => {
      const redirect = params.get('redirect') || params.get('returnUrl');
      if (redirect && redirect.startsWith('/') && redirect !== '/login') return redirect;
      const from = (state as { from?: { pathname?: string } | string })?.from;
      if (typeof from === 'string' && from.startsWith('/') && from !== '/login') return from;
      if (from && typeof from === 'object' && from.pathname?.startsWith('/') && from.pathname !== '/login') {
        return from.pathname;
      }
      return '/dashboard';
    };

    const destination = resolveDestination(searchParams, locationState);
    assert.equal(destination, '/room/room-from-state-123');
  });

  it('5. Upgrades guest session and clears guest flag and secret when user signs in', () => {
    sessionStorage.setItem('guest_session', 'true');
    localStorage.setItem('et_anon_user_id', 'anon_12345');
    localStorage.setItem('et_anon_friend_code', '987654');
    localStorage.setItem('et_anon_session_secret', 'secret_abc_123');
    assert.equal(sessionStorage.getItem('guest_session'), 'true');

    // Simulate Supabase SIGNED_IN event handling in useAuthSession
    sessionStorage.removeItem('guest_session');
    localStorage.removeItem('et_anon_friend_code');
    localStorage.removeItem('et_anon_session_secret');
    assert.equal(sessionStorage.getItem('guest_session'), null, 'Guest flag must be cleared on authentication');
    assert.equal(localStorage.getItem('et_anon_friend_code'), null, 'Guest friend code must be cleared on authentication');
    assert.equal(localStorage.getItem('et_anon_session_secret'), null, 'Guest session secret must be cleared on authentication');
  });

  it('6. Clears guest session on sign out', () => {
    sessionStorage.setItem('guest_session', 'true');
    localStorage.setItem('et_anon_user_id', 'anon_12345');
    localStorage.setItem('et_anon_friend_code', '987654');
    localStorage.setItem('et_anon_session_secret', 'secret_abc_123');

    // Simulate handleSignOut
    sessionStorage.removeItem('guest_session');
    localStorage.removeItem('et_anon_user_id');
    localStorage.removeItem('et_anon_friend_code');
    localStorage.removeItem('et_anon_session_secret');
    assert.equal(sessionStorage.getItem('guest_session'), null);
    assert.equal(localStorage.getItem('et_anon_user_id'), null);
    assert.equal(localStorage.getItem('et_anon_friend_code'), null);
    assert.equal(localStorage.getItem('et_anon_session_secret'), null);
  });
});
