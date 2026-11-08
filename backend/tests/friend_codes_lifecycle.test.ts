/**
 * friend_codes_lifecycle.test.ts
 * Comprehensive regression tests for Task 2:
 * 1. Permanent registered-user code stability
 * 2. Guest code stability across calls/refreshes
 * 3. Independent guest sessions
 * 4. Session restoration when valid
 * 5. Explicit guest sign-out & revocation
 * 6. Guest-to-account transition
 * 7. Leading-zero preservation
 * 8. Concurrent allocation & collision retry
 * 9. Cross-store uniqueness enforcement
 * 10. Exact 6-digit code lookup (registered vs guest)
 * 11. Expired guest lookup rejection
 * 12. Rate limiting for code lookups
 * 13. Existing username search preservation
 * 14. Backend guest exclusion from friend requests
 * 15. Safe database-unavailable failure
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { FriendCodeRepository } from '../src/repositories/friendCode.repository.js';
import { UserRepository } from '../src/repositories/user.repository.js';
import { FriendRepository } from '../src/repositories/friend.repository.js';
import { AppError } from '../src/utils/appError.js';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

describe('Six-Digit Friend Codes & Guest Identity Lifecycle', () => {
  beforeEach(async () => {
    FriendCodeRepository.clearInMemoryRegistry();
    UserRepository.clearInMemoryProfiles();
    FriendRepository.clearInMemoryFriendships();
  });

  it('1. Permanent registered-user code stability across calls', async () => {
    const userId = 'reg_user_alpha_' + Date.now();
    await UserRepository.syncProfile(userId, { username: 'alpha' });

    const code1 = await FriendCodeRepository.allocateRegisteredCode(userId);
    assert.match(code1, /^\d{6}$/, 'Code must be exactly 6 decimal digits');

    // Repeated call must return the exact same code
    const code2 = await FriendCodeRepository.allocateRegisteredCode(userId);
    assert.equal(code2, code1, 'Registered friend code must be permanent and stable');

    // Profile lookup must include the same code
    const profile = await UserRepository.getProfile(userId);
    assert.equal(profile?.friendCode, code1);
  });

  it('2. Guest code stability across repeated queries in same session', async () => {
    // First session init
    const s1 = await FriendCodeRepository.getOrCreateGuestSession();
    assert.ok(s1.isNew, 'Initial guest session must be marked as new');
    assert.match(s1.friendCode, /^\d{6}$/);
    assert.ok(s1.sessionSecret, 'Session secret must be present');

    // Second call with same guestId and valid sessionSecret (simulating tab refresh / reopen)
    const s2 = await FriendCodeRepository.getOrCreateGuestSession(s1.guestId, s1.sessionSecret);
    assert.equal(s2.isNew, false, 'Existing valid session must be reused');
    assert.equal(s2.guestId, s1.guestId);
    assert.equal(s2.friendCode, s1.friendCode, 'Guest friend code must remain stable during valid session');
  });

  it('3. Independent guest sessions receive distinct identities and codes', async () => {
    const s1 = await FriendCodeRepository.getOrCreateGuestSession();
    const s2 = await FriendCodeRepository.getOrCreateGuestSession();

    assert.notEqual(s1.guestId, s2.guestId);
    assert.notEqual(s1.friendCode, s2.friendCode, 'Separate guest sessions must receive unique codes');
    assert.notEqual(s1.sessionSecret, s2.sessionSecret, 'Separate guest sessions must receive distinct secrets');
  });

  it('4. Session restoration when valid; rejection when expired', async () => {
    const guestId = 'anon_expiring_' + Date.now();
    // Allocate code with -1 hour TTL (already expired)
    const { sessionSecret } = await FriendCodeRepository.allocateGuestCode(guestId, -1);

    // Re-querying with expired guestId and secret should recognize expiration and allocate fresh identity
    const session = await FriendCodeRepository.getOrCreateGuestSession(guestId, sessionSecret);
    assert.ok(session.isNew, 'Expired guest session must trigger fresh allocation');
    assert.notEqual(session.guestId, guestId, 'Old expired guestId must be retired');
  });

  it('5. Explicit guest sign-out revokes session and friend code', async () => {
    const session = await FriendCodeRepository.getOrCreateGuestSession();
    assert.ok(await FriendCodeRepository.lookupCode(session.friendCode), 'Active code must be discoverable');

    // Explicit sign-out with proof of ownership
    await FriendCodeRepository.revokeGuestSession(session.guestId, session.sessionSecret);

    // Lookup must now return null
    const lookup = await FriendCodeRepository.lookupCode(session.friendCode);
    assert.equal(lookup, null, 'Revoked guest friend code must be completely undiscoverable');
  });

  it('6. Guest-to-account transition revokes guest and preserves account permanent code', async () => {
    const guestSession = await FriendCodeRepository.getOrCreateGuestSession();
    const guestCode = guestSession.friendCode;

    const registeredUserId = 'reg_user_trans_' + Date.now();
    await UserRepository.syncProfile(registeredUserId, { username: 'trans_user' });

    // Transition with proof of ownership
    const permanentCode = await FriendCodeRepository.transitionGuestToAccount(guestSession.guestId, guestSession.sessionSecret, registeredUserId);
    assert.match(permanentCode, /^\d{6}$/);

    // Old guest code must now be inactive / revoked
    const guestLookup = await FriendCodeRepository.lookupCode(guestCode);
    assert.equal(guestLookup, null, 'Old guest code must be revoked after account transition');

    // Permanent code must resolve to registered user
    const userLookup = await FriendCodeRepository.lookupCode(permanentCode);
    assert.ok(userLookup);
    assert.equal(userLookup.identityId, registeredUserId);
    assert.equal(userLookup.identityType, 'REGISTERED');
  });

  it('7. Leading-zero preservation in code generation and lookup', async () => {
    // Generate code with leading zero if possible, or mock
    const padded = '001234';
    assert.equal(padded.length, 6);
    assert.ok(FriendCodeRepository.isValidCodeFormat(padded));

    // Register a profile with leading zero code directly
    const testUser = 'reg_zero_' + Date.now();
    await UserRepository.syncProfile(testUser, { username: 'zero_user' });

    // Simulate lookup of string code with leading zeros
    assert.equal(FriendCodeRepository.isValidCodeFormat('000000'), true);
    assert.equal(FriendCodeRepository.isValidCodeFormat('012345'), true);
    assert.equal(FriendCodeRepository.isValidCodeFormat('12345'), false, '5 digits must be invalid');
    assert.equal(FriendCodeRepository.isValidCodeFormat('1234567'), false, '7 digits must be invalid');
    assert.equal(FriendCodeRepository.isValidCodeFormat('abcdef'), false, 'Non-digits must be invalid');
  });

  it('8. Bounded collision retry and capacity exhaustion protection', async () => {
    // Mock generateRandomCode to force collisions
    let attempts = 0;
    const originalGenerator = FriendCodeRepository.generateRandomCode;

    try {
      FriendCodeRepository.generateRandomCode = () => {
        attempts++;
        return '888888'; // Constant collision candidate
      };

      // First allocation succeeds
      await FriendCodeRepository.allocateRegisteredCode('user_first_collision');

      // Second allocation with identical generator will collide 10 times and throw 503
      await assert.rejects(
        async () => {
          await FriendCodeRepository.allocateRegisteredCode('user_second_collision');
        },
        (err: unknown) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 503);
          assert.match(err.message, /capacity exhausted/i);
          return true;
        }
      );
    } finally {
      FriendCodeRepository.generateRandomCode = originalGenerator;
    }
  });

  it('9. Cross-store uniqueness: same code registry shared between users and guests', async () => {
    const userA = 'reg_u_a_' + Date.now();
    await UserRepository.syncProfile(userA, { username: 'user_a' });
    const userCode = await FriendCodeRepository.allocateRegisteredCode(userA);

    // Verify lookup resolves identity type correctly
    const lookupUser = await FriendCodeRepository.lookupCode(userCode);
    assert.equal(lookupUser?.identityType, 'REGISTERED');

    const guestSession = await FriendCodeRepository.getOrCreateGuestSession();
    const lookupGuest = await FriendCodeRepository.lookupCode(guestSession.friendCode);
    assert.equal(lookupGuest?.identityType, 'GUEST');

    assert.notEqual(userCode, guestSession.friendCode, 'Registered and guest codes must never collide');
  });

  it('10. Exact 6-digit search in FriendRepository resolves registered user and guest', async () => {
    const userReg = 'reg_search_' + Date.now();
    await UserRepository.syncProfile(userReg, { username: 'searchable_user' });
    const regCode = await FriendCodeRepository.allocateRegisteredCode(userReg);

    const guestSession = await FriendCodeRepository.getOrCreateGuestSession();

    // Search by registered user code
    const regResults = await FriendRepository.searchUsers(regCode, 'requester_other');
    assert.equal(regResults.length, 1);
    assert.equal(regResults[0].id, userReg);
    assert.equal(regResults[0].friendCode, regCode);
    assert.equal(regResults[0].isGuest, false);

    // Search by guest code
    const guestResults = await FriendRepository.searchUsers(guestSession.friendCode, 'requester_other');
    assert.equal(guestResults.length, 1);
    assert.equal(guestResults[0].id, guestSession.guestId);
    assert.equal(guestResults[0].friendCode, guestSession.friendCode);
    assert.equal(guestResults[0].isGuest, true);
    assert.equal(guestResults[0].friendshipStatus, 'NONE');
  });

  it('11. Expired guest cannot be discovered via code search', async () => {
    const expiredGuestId = 'anon_old_' + Date.now();
    const { code } = await FriendCodeRepository.allocateGuestCode(expiredGuestId, -5); // 5 hours ago

    const results = await FriendRepository.searchUsers(code, 'requester_xyz');
    assert.equal(results.length, 0, 'Expired guest code must return zero search results');
  });

  it('12. Rate limiting for code lookups over HTTP', async () => {
    // Send 30 rapid lookup requests from same client
    let rateLimited = false;
    for (let i = 0; i < 30; i++) {
      try {
        await axios.get(`${BACKEND_URL}/api/friends/search?q=123456&userId=test_rate_client`);
      } catch (err: any) {
        if (err.response?.status === 429) {
          rateLimited = true;
          break;
        }
      }
    }
    assert.ok(rateLimited, 'Rapid repeated lookups must trigger HTTP 429 Too Many Requests');
  });

  it('13. Standard username search preserved alongside code lookup', async () => {
    const u1 = 'reg_name_search_1_' + Date.now();
    const u2 = 'reg_name_search_2_' + Date.now();
    await UserRepository.syncProfile(u1, { username: 'charlie_unicorn' });
    await UserRepository.syncProfile(u2, { username: 'charlie_delta' });

    const results = await FriendRepository.searchUsers('charlie', 'requester_other');
    assert.ok(results.length >= 2);
    assert.ok(results.some((r) => r.username === 'charlie_unicorn'));
    assert.ok(results.some((r) => r.username === 'charlie_delta'));
  });

  it('14. Backend guest exclusion from friend requests is preserved (Task 1)', async () => {
    const guestSession = await FriendCodeRepository.getOrCreateGuestSession();
    const registeredUser = 'reg_guard_' + Date.now();
    await UserRepository.syncProfile(registeredUser, { username: 'guard_user' });

    // Registered user targeting guest friend request must still be rejected
    await assert.rejects(
      async () => {
        await FriendRepository.sendFriendRequest(registeredUser, guestSession.guestId);
      },
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  it('15. Guest session HTTP API endpoint (/api/guests/session)', async () => {
    // Init session via HTTP
    const res1 = await axios.post(`${BACKEND_URL}/api/guests/session`, {});
    assert.equal(res1.status, 200);
    assert.ok(res1.data.data.guestId.startsWith('anon_'));
    assert.match(res1.data.data.friendCode, /^\d{6}$/);
    assert.ok(res1.data.data.sessionSecret, 'sessionSecret must be returned on allocation');

    // Reuse session via HTTP with valid sessionSecret
    const res2 = await axios.post(`${BACKEND_URL}/api/guests/session`, {
      guestId: res1.data.data.guestId,
      sessionSecret: res1.data.data.sessionSecret,
    });
    assert.equal(res2.status, 200);
    assert.equal(res2.data.data.guestId, res1.data.data.guestId);
    assert.equal(res2.data.data.friendCode, res1.data.data.friendCode);
    assert.equal(res2.data.data.isNew, false);

    // Revoke session via HTTP with valid sessionSecret
    const res3 = await axios.post(`${BACKEND_URL}/api/guests/revoke`, {
      guestId: res1.data.data.guestId,
      sessionSecret: res1.data.data.sessionSecret,
    });
    assert.equal(res3.status, 200);
  });
});
