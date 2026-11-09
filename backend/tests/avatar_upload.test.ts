import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AvatarService } from '../src/services/avatar.service.js';
import { FriendCodeRepository } from '../src/repositories/friendCode.repository.js';
import { UserRepository } from '../src/repositories/user.repository.js';
import { AppError } from '../src/utils/appError.js';

describe('Task 3: Persistent User Avatar Uploads & Validation', () => {
  beforeEach(() => {
    FriendCodeRepository.clearInMemoryRegistry();
    UserRepository.clearInMemoryProfiles();
  });

  // Valid image fixture buffers
  const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const validWebpBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

  it('1. Server-side magic byte validation accepts valid JPEG, PNG, and WebP', () => {
    const jpegType = AvatarService.validateImageBuffer(validJpegBuffer);
    assert.equal(jpegType.mime, 'image/jpeg');
    assert.equal(jpegType.ext, 'jpg');

    const pngType = AvatarService.validateImageBuffer(validPngBuffer);
    assert.equal(pngType.mime, 'image/png');
    assert.equal(pngType.ext, 'png');

    const webpType = AvatarService.validateImageBuffer(validWebpBuffer);
    assert.equal(webpType.mime, 'image/webp');
    assert.equal(webpType.ext, 'webp');
  });

  it('2. Disguised files and invalid payloads are rejected with clear errors', () => {
    // Text file pretending to be image
    const textBuffer = Buffer.from('hello this is definitely not a real image file');
    assert.throws(
      () => AvatarService.validateImageBuffer(textBuffer),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /only jpeg, png, and webp/i);
        return true;
      }
    );

    // Empty buffer
    assert.throws(
      () => AvatarService.validateImageBuffer(Buffer.alloc(0)),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  it('3. Oversized files (> 5MB) are strictly rejected', () => {
    const largeBuffer = Buffer.alloc(5 * 1024 * 1024 + 1024);
    // Write valid JPEG header so magic byte check isn't the sole failure
    largeBuffer[0] = 0xff;
    largeBuffer[1] = 0xd8;
    largeBuffer[2] = 0xff;

    assert.throws(
      () => AvatarService.validateImageBuffer(largeBuffer),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /exceeds maximum allowed size of 5 mb/i);
        return true;
      }
    );
  });

  it('4. Registered user avatar upload and retrieval lifecycle', async () => {
    const userId = 'usr_avatar_reg_' + Date.now();
    await UserRepository.syncProfile(userId, { username: 'avatar_user' });

    // Upload
    const avatarUrl = await AvatarService.uploadUserAvatar(userId, validPngBuffer);
    assert.ok(avatarUrl);
    assert.match(avatarUrl, /avatar\./);

    // Verify stored profile has avatarUrl
    const profile = await UserRepository.getProfile(userId);
    assert.ok(profile?.avatarUrl);
    assert.equal(profile.avatarUrl, avatarUrl);

    // Remove avatar
    await AvatarService.removeUserAvatar(userId);
    const updatedProfile = await UserRepository.getProfile(userId);
    assert.equal(updatedProfile?.avatarUrl, '');
  });

  it('5. Guest avatar upload requires session secret proof of ownership', async () => {
    const guestSession = await FriendCodeRepository.getOrCreateGuestSession();

    // Rejection without secret
    await assert.rejects(
      async () => {
        await AvatarService.uploadGuestAvatar(guestSession.guestId, '', validWebpBuffer);
      },
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 403);
        return true;
      }
    );

    // Rejection with invalid/forged secret
    await assert.rejects(
      async () => {
        await AvatarService.uploadGuestAvatar(guestSession.guestId, 'attacker_wrong_secret', validWebpBuffer);
      },
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /invalid guest session credentials/i);
        return true;
      }
    );

    // Success with legitimate proof of ownership
    const avatarUrl = await AvatarService.uploadGuestAvatar(
      guestSession.guestId,
      guestSession.sessionSecret,
      validWebpBuffer
    );
    assert.ok(avatarUrl);
    assert.match(avatarUrl, /avatar\./);

    // Verify guest session has avatar
    const updatedGuest = await FriendCodeRepository.getGuestSession(guestSession.guestId);
    assert.equal(updatedGuest?.avatarUrl, avatarUrl);

    // Remove guest avatar
    await AvatarService.removeGuestAvatar(guestSession.guestId, guestSession.sessionSecret);
    const clearedGuest = await FriendCodeRepository.getGuestSession(guestSession.guestId);
    assert.equal(clearedGuest?.avatarUrl, null);
  });

  it('6. User isolation: Guest A cannot remove Guest B avatar', async () => {
    const guestA = await FriendCodeRepository.getOrCreateGuestSession();
    const guestB = await FriendCodeRepository.getOrCreateGuestSession();

    await AvatarService.uploadGuestAvatar(guestA.guestId, guestA.sessionSecret, validJpegBuffer);

    // Guest B attempts to delete Guest A avatar using Guest B's secret
    await assert.rejects(
      async () => {
        await AvatarService.removeGuestAvatar(guestA.guestId, guestB.sessionSecret);
      },
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 403);
        return true;
      }
    );

    // Guest A avatar must still be intact
    const sessionA = await FriendCodeRepository.getGuestSession(guestA.guestId);
    assert.ok(sessionA?.avatarUrl);
  });
});
