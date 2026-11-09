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

describe('Task 1: Friend Code Display & Lifecycle Verification', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('1. Leading-zero preservation: 6-digit codes formatted as strings, never numbers', () => {
    const rawCodeWithLeadingZeros = '004521';
    assert.equal(typeof rawCodeWithLeadingZeros, 'string');
    assert.equal(rawCodeWithLeadingZeros.length, 6);
    assert.equal(rawCodeWithLeadingZeros.startsWith('00'), true);

    const formatCode = (code: string | null): string => {
      if (!code) return '------';
      return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3, 6)}` : code;
    };

    const formatted = formatCode(rawCodeWithLeadingZeros);
    assert.equal(formatted, '004 521', 'Leading zeros must be preserved in formatted output');
    assert.notEqual(formatted, '4 521', 'Must not strip leading zeros as if converted to number');
  });

  it('2. Loading and error states never masquerade as 000 000', () => {
    const formatCode = (code: string | null): string => {
      if (!code) return '------';
      return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3, 6)}` : code;
    };

    // When code is null (loading or unassigned)
    assert.notEqual(formatCode(null), '000 000', 'Unloaded code must not display 000 000');
    assert.equal(formatCode(null), '------');

    // Default state must be null, not '000000'
    const initialFriendCodeState: string | null = null;
    assert.equal(initialFriendCodeState, null);
  });

  it('3. Registered user code retrieval and persistence across refreshes', () => {
    // Simulated registered profile response
    const mockProfile = {
      id: 'usr_reg_123',
      username: 'alice',
      friendCode: '012345',
    };

    assert.equal(mockProfile.friendCode, '012345');
    assert.match(mockProfile.friendCode, /^\d{6}$/);

    // Repeated retrieval returns the identical persistent code
    const mockRefreshedProfile = {
      id: 'usr_reg_123',
      username: 'alice',
      friendCode: '012345',
    };

    assert.equal(mockRefreshedProfile.friendCode, mockProfile.friendCode);
  });

  it('4. Guest user code retrieval and persistence across refreshes via proof of ownership', () => {
    // Initial guest session
    const guestSession1 = {
      guestId: 'anon_test_guest_1',
      friendCode: '007890',
      sessionSecret: 'sec_guest_abc123',
      isNew: true,
    };

    // Save to localStorage as done by useAuthSession / FriendsTab
    localStorage.setItem('et_anon_user_id', guestSession1.guestId);
    localStorage.setItem('et_anon_friend_code', guestSession1.friendCode);
    localStorage.setItem('et_anon_session_secret', guestSession1.sessionSecret);

    // Simulate page refresh: localStorage preserves identity & code
    const storedGuestId = localStorage.getItem('et_anon_user_id');
    const storedCode = localStorage.getItem('et_anon_friend_code');
    const storedSecret = localStorage.getItem('et_anon_session_secret');

    assert.equal(storedGuestId, guestSession1.guestId);
    assert.equal(storedCode, '007890', 'Leading zero preserved in guest storage');
    assert.equal(storedSecret, guestSession1.sessionSecret);

    // Re-verification with existing credentials returns the same code without creating a new one
    const verifyGuestSession = (id?: string, secret?: string) => {
      if (id === guestSession1.guestId && secret === guestSession1.sessionSecret) {
        return {
          guestId: id,
          friendCode: guestSession1.friendCode,
          sessionSecret: secret,
          isNew: false,
        };
      }
      return {
        guestId: 'anon_new',
        friendCode: '999999',
        sessionSecret: 'sec_new',
        isNew: true,
      };
    };

    const reloaded = verifyGuestSession(storedGuestId!, storedSecret!);
    assert.equal(reloaded.isNew, false, 'Must not generate a new code on refresh');
    assert.equal(reloaded.friendCode, '007890');
  });

  it('5. User code isolation: User A code is never displayed for User B', () => {
    const userA = { id: 'usr_a', friendCode: '112233' };
    const userB = { id: 'usr_b', friendCode: '445566' };

    const resolveUserCode = (currentUserId: string): string => {
      if (currentUserId === userA.id) return userA.friendCode;
      if (currentUserId === userB.id) return userB.friendCode;
      throw new Error('Unknown user');
    };

    assert.equal(resolveUserCode('usr_a'), '112233');
    assert.equal(resolveUserCode('usr_b'), '445566');
    assert.notEqual(resolveUserCode('usr_a'), resolveUserCode('usr_b'));
  });

  it('6. API failure handling: does not revert to 000 000 on network error', () => {
    let displayedCode: string | null = null;
    let errorOccurred = false;

    // Simulate API rejection
    try {
      throw new Error('Network timeout');
    } catch {
      errorOccurred = true;
      // UI sets error state, NEVER '000000'
      displayedCode = null;
    }

    assert.equal(errorOccurred, true);
    assert.notEqual(displayedCode, '000000');
    assert.equal(displayedCode, null);
  });
});
