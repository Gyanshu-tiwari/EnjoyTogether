/**
 * friend_request_eligibility.test.ts
 * Regression tests for Friend Request guest exclusion and registered-user eligibility:
 * 1. Registered user -> registered user succeeds
 * 2. Registered user -> anonymous guest ID rejected
 * 3. Registered user -> guest-prefixed ID without registered profile rejected
 * 4. Unregistered requester (or guest requester) rejected
 * 5. Self-request rejected
 * 6. Duplicate request rejected
 * 7. Impersonation of another requester rejected (HTTP 403)
 * 8. Database unavailable fails safely (503, no records created)
 * 9. Rejected requests leave friendship data unchanged
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { FriendRepository } from '../src/repositories/friend.repository.js';
import { UserRepository } from '../src/repositories/user.repository.js';
import { AppError } from '../src/utils/appError.js';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';

describe('Friend Request Registered-User Eligibility & Guest Exclusion', () => {
  const aliceId = 'reg_alice_' + Date.now();
  const bobId = 'reg_bob_' + Date.now();
  const charlieId = 'reg_charlie_' + Date.now();

  beforeEach(async () => {
    // Reset in-memory states before tests
    FriendRepository.clearInMemoryFriendships();
    UserRepository.clearInMemoryProfiles();

    // Register valid profiles
    await UserRepository.syncProfile(aliceId, { username: 'alice' });
    await UserRepository.syncProfile(bobId, { username: 'bob' });
    await UserRepository.syncProfile(charlieId, { username: 'charlie' });
  });

  it('1. A registered user requests friendship with another registered user: succeeds', async () => {
    const friendship = await FriendRepository.sendFriendRequest(aliceId, bobId);
    assert.ok(friendship.id, 'Friendship should have an ID');
    assert.equal(friendship.requesterId, aliceId);
    assert.equal(friendship.addresseeId, bobId);
    assert.equal(friendship.status, 'PENDING');
  });

  it('2. A registered user targets an anonymous guest ID: rejected with 400', async () => {
    const guestIds = [
      'anon_abc123',
      'guest_xyz789',
      'anonymous-user',
      'guest',
    ];

    for (const guestId of guestIds) {
      await assert.rejects(
        async () => {
          await FriendRepository.sendFriendRequest(aliceId, guestId);
        },
        (err: unknown) => {
          assert.ok(err instanceof AppError, `Expected AppError for ${guestId}`);
          assert.equal(err.statusCode, 400);
          assert.match(err.message, /guest|anonymous/i);
          return true;
        }
      );
    }
  });

  it('3. A registered user targets a guest-prefixed ID without a registered profile: rejected', async () => {
    const unregisteredGuestId = 'guest_unregistered_999';
    await assert.rejects(
      async () => {
        await FriendRepository.sendFriendRequest(aliceId, unregisteredGuestId);
      },
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  it('4. The requester does not have an eligible registered profile: rejected with 400', async () => {
    // 4a. Anonymous guest requester
    await assert.rejects(
      async () => {
        await FriendRepository.sendFriendRequest('anon_guest_sender', bobId);
      },
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Anonymous guests cannot send friend requests/i);
        return true;
      }
    );

    // 4b. Nonexistent non-guest UUID requester
    const unregisteredId = 'nonexistent_uuid_456';
    await assert.rejects(
      async () => {
        await FriendRepository.sendFriendRequest(unregisteredId, bobId);
      },
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Requester account is not a valid registered user profile/i);
        return true;
      }
    );
  });

  it('4c. A registered user targets a nonexistent recipient: rejected with 400', async () => {
    const nonexistentRecipientId = 'nonexistent_bob_999';
    await assert.rejects(
      async () => {
        await FriendRepository.sendFriendRequest(aliceId, nonexistentRecipientId);
      },
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Recipient user does not exist/i);
        return true;
      }
    );
  });

  it('5. A user requests friendship with themselves: rejected with 400', async () => {
    await assert.rejects(
      async () => {
        await FriendRepository.sendFriendRequest(aliceId, aliceId);
      },
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Cannot send a friend request to yourself/i);
        return true;
      }
    );
  });

  it('6. A duplicate request is submitted: rejected with 400', async () => {
    const userA = 'reg_dup_a_' + Date.now();
    const userB = 'reg_dup_b_' + Date.now();
    await UserRepository.syncProfile(userA, { username: 'dup_a' });
    await UserRepository.syncProfile(userB, { username: 'dup_b' });

    // First request succeeds
    await FriendRepository.sendFriendRequest(userA, userB);

    // Duplicate identical request
    await assert.rejects(
      async () => {
        await FriendRepository.sendFriendRequest(userA, userB);
      },
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /already exists/i);
        return true;
      }
    );

    // Reverse duplicate request (userB -> userA while userA -> userB is pending)
    await assert.rejects(
      async () => {
        await FriendRepository.sendFriendRequest(userB, userA);
      },
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /already exists/i);
        return true;
      }
    );
  });

  it('7. The database is unavailable: the request fails safely with 503', async () => {
    // Temporarily mock UserRepository.getProfile to simulate DB outage
    const originalGetProfile = UserRepository.getProfile;
    UserRepository.getProfile = async () => {
      throw new AppError('Authoritative user data store is currently unavailable.', 503);
    };

    try {
      await assert.rejects(
        async () => {
          await FriendRepository.sendFriendRequest(aliceId, bobId);
        },
        (err: unknown) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 503);
          assert.match(err.message, /Authoritative user data store is currently unavailable/i);
          return true;
        }
      );
    } finally {
      UserRepository.getProfile = originalGetProfile;
    }
  });

  it('8. Rejected requests do not create or mutate friendship records', async () => {
    const initialCount = FriendRepository.getInMemoryFriendshipsCount();

    const invalidAttempts = [
      () => FriendRepository.sendFriendRequest(aliceId, 'anon_test'),
      () => FriendRepository.sendFriendRequest(aliceId, aliceId),
      () => FriendRepository.sendFriendRequest('anon_test', bobId),
      () => FriendRepository.sendFriendRequest(aliceId, 'nonexistent_target'),
    ];

    for (const attempt of invalidAttempts) {
      try {
        await attempt();
      } catch {
        // Expected rejection
      }
    }

    const finalCount = FriendRepository.getInMemoryFriendshipsCount();
    assert.equal(finalCount, initialCount, 'Friendship records must not be created or mutated on rejection');
  });

  it('9. HTTP API: Client attempts to impersonate another requester is rejected with 403', async () => {
    try {
      // Authenticated as Charlie via query param, but sends body.requesterId = aliceId
      await axios.post(
        `${BACKEND_URL}/api/friends/request?userId=${charlieId}`,
        {
          requesterId: aliceId,
          addresseeId: bobId,
        }
      );
      assert.fail('Expected HTTP 403 Forbidden for impersonation attempt');
    } catch (err: any) {
      assert.equal(err.response?.status, 403);
      assert.match(err.response?.data?.message, /Cannot send friend request on behalf of another user/i);
    }
  });

  it('10. HTTP API: Anonymous guest trying to send friend request is rejected with 400', async () => {
    try {
      // Authenticated/Defaulted as anonymous-user or anon_...
      await axios.post(
        `${BACKEND_URL}/api/friends/request?userId=anon_random_guest`,
        {
          addresseeId: bobId,
        }
      );
      assert.fail('Expected HTTP 400 Bad Request for anonymous guest');
    } catch (err: any) {
      assert.equal(err.response?.status, 400);
      assert.match(err.response?.data?.message, /Anonymous guests cannot send friend requests/i);
    }
  });

  it('11. HTTP API: Registered user sending request to another registered user succeeds with 201', async () => {
    // Sync profiles on the running server via HTTP
    await axios.patch(`${BACKEND_URL}/api/users/profile?userId=${aliceId}`, {
      username: 'alice_live',
    });
    await axios.patch(`${BACKEND_URL}/api/users/profile?userId=${charlieId}`, {
      username: 'charlie_live',
    });

    const res = await axios.post(
      `${BACKEND_URL}/api/friends/request?userId=${aliceId}`,
      {
        addresseeId: charlieId,
      }
    );
    assert.equal(res.status, 201);
    assert.equal(res.data.status, 'success');
    assert.equal(res.data.data.friendship.requesterId, aliceId);
    assert.equal(res.data.data.friendship.addresseeId, charlieId);
    assert.equal(res.data.data.friendship.status, 'PENDING');
  });
});
