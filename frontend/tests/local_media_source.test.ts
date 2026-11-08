/**
 * local_media_source.test.ts
 * Tests for LocalMediaSource lifecycle, URL creation, caching, revocation,
 * destruction, and remount/revive resilience.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LocalMediaSource } from '../src/features/theater/media/LocalMediaSource';

describe('LocalMediaSource Lifecycle & URL Management', () => {
  const dummyData = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
  const mockFile = new File([dummyData], 'family_trip.mp4', { type: 'video/mp4' });

  it('1. Initializes correctly with idle status and file descriptor', () => {
    const source = new LocalMediaSource(mockFile);
    assert.equal(source.status, 'idle');
    assert.equal(source.isDestroyed, false);
    assert.equal(source.file.name, 'family_trip.mp4');
    assert.equal(source.descriptor.name, 'family_trip.mp4');
    assert.equal(source.descriptor.mimeType, 'video/mp4');
    assert.equal(source.descriptor.sizeBytes, dummyData.length);
    assert.equal(source.descriptor.type, 'local');
    assert.equal(source.descriptor.durationSeconds, null);
  });

  it('2. Creates and caches object URL on repeated calls', () => {
    const source = new LocalMediaSource(mockFile);
    const url1 = source.getObjectUrl();
    assert.ok(url1.startsWith('blob:'), 'URL should be a blob URL');

    const url2 = source.getObjectUrl();
    assert.equal(url1, url2, 'Subsequent getObjectUrl() calls must return cached URL');
  });

  it('3. Revokes object URL without destroying the source', () => {
    const source = new LocalMediaSource(mockFile);
    const url1 = source.getObjectUrl();

    source.revokeObjectUrl();
    assert.equal(source.isDestroyed, false, 'Source should not be marked destroyed after URL revocation');

    const url2 = source.getObjectUrl();
    assert.ok(url2.startsWith('blob:'), 'New URL should be created on demand');
    assert.notEqual(url1, url2, 'New URL should be different from revoked URL');
  });

  it('4. Marks source as destroyed and revokes URL on destroy()', () => {
    const source = new LocalMediaSource(mockFile);
    const url = source.getObjectUrl();
    assert.ok(url);

    source.destroy();
    assert.equal(source.status, 'destroyed');
    assert.equal(source.isDestroyed, true);

    // Multiple destroy calls must be idempotent
    source.destroy();
    assert.equal(source.status, 'destroyed');
  });

  it('5. Auto-revives and creates fresh URL when getObjectUrl() is called on destroyed source', () => {
    const source = new LocalMediaSource(mockFile);
    source.destroy();
    assert.equal(source.isDestroyed, true);

    // In React Strict Mode / remount, component may request URL from a transiently destroyed source
    // LocalMediaSource should auto-revive using its retained File reference without throwing
    const revivedUrl = source.getObjectUrl();
    assert.ok(revivedUrl.startsWith('blob:'), 'Should produce a valid blob URL');
    assert.equal(source.isDestroyed, false, 'Source should no longer be in destroyed state');
  });

  it('6. Explicit revive() restores source status and enables normal operation', () => {
    const source = new LocalMediaSource(mockFile);
    source.destroy();
    assert.equal(source.isDestroyed, true);

    source.revive();
    assert.equal(source.isDestroyed, false);
    assert.equal(source.status, 'idle');

    const url = source.getObjectUrl();
    assert.ok(url.startsWith('blob:'));
  });

  it('7. captureStream auto-revives destroyed source safely', () => {
    const source = new LocalMediaSource(mockFile);
    source.destroy();
    assert.equal(source.isDestroyed, true);

    // Mock video element
    const mockVideoEl = {} as HTMLVideoElement;
    const stream = source.captureStream(mockVideoEl);
    // In Node environment captureStreamSafe returns null, but should not throw or stay destroyed
    assert.equal(stream, null);
    assert.equal(source.isDestroyed, false, 'captureStream should revive destroyed source');
  });
});
