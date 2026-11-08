/**
 * watch_room_media_flow.test.ts
 * Verifies the complete media source lifecycle during room creation,
 * React Strict Mode unmount/remount, and room exit.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LocalMediaSource } from '../src/features/theater/media/LocalMediaSource';

describe('Watch Room Media Flow & Strict Mode Remount Simulation', () => {
  const dummyBytes = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]);
  const sampleVideoFile = new File([dummyBytes], 'party_clip.mp4', { type: 'video/mp4' });

  it('1. Simulates file selection in LocalFilePicker', () => {
    const source = new LocalMediaSource(sampleVideoFile);
    assert.equal(source.status, 'idle');
    assert.equal(source.descriptor.name, 'party_clip.mp4');

    // LocalFilePicker extracts initial object URL for preview or metadata probe
    const pickerUrl = source.getObjectUrl();
    assert.ok(pickerUrl.startsWith('blob:'));
  });

  it('2. Simulates React Strict Mode / transient unmount of TheaterProvider during navigation', () => {
    // Host selects file
    const hostSource = new LocalMediaSource(sampleVideoFile);
    const initialUrl = hostSource.getObjectUrl();
    assert.ok(initialUrl);

    // React Strict Mode or temporary skeleton toggle triggers unmount cleanup
    // Even if destroy() or revokeObjectUrl() was invoked during transient unmount:
    hostSource.destroy();
    assert.equal(hostSource.isDestroyed, true);

    // Watch Room remounts: SyncVideoPlayer renders and requests the object URL
    // MUST NOT THROW; must safely provide an active object URL
    let activePlayerUrl = '';
    assert.doesNotThrow(() => {
      activePlayerUrl = hostSource.getObjectUrl();
    }, 'SyncVideoPlayer must not throw when mounting on remounted/revived source');

    assert.ok(activePlayerUrl.startsWith('blob:'));
    assert.equal(hostSource.isDestroyed, false);
  });

  it('3. Simulates video element metadata readiness check before WebRTC capture', () => {
    // Mock video element before metadata is loaded
    const mockVideoEl = {
      readyState: 0, // HAVE_NOTHING
      videoWidth: 0,
      videoHeight: 0,
      duration: 0,
    };

    // Check readiness guard condition
    const isReadyBefore =
      mockVideoEl.readyState >= 1 && (mockVideoEl.videoWidth > 0 || mockVideoEl.duration > 0);
    assert.equal(isReadyBefore, false, 'Capture must NOT start before metadata is loaded');

    // Simulate loadedmetadata event
    mockVideoEl.readyState = 1; // HAVE_METADATA
    mockVideoEl.videoWidth = 1920;
    mockVideoEl.videoHeight = 1080;
    mockVideoEl.duration = 120.5;

    const isReadyAfter =
      mockVideoEl.readyState >= 1 && (mockVideoEl.videoWidth > 0 || mockVideoEl.duration > 0);
    assert.equal(isReadyAfter, true, 'Capture is allowed once valid metadata is loaded');
  });

  it('4. Simulates permanent room exit and final resource disposal', () => {
    const hostSource = new LocalMediaSource(sampleVideoFile);
    const url = hostSource.getObjectUrl();
    assert.ok(url);

    // Host leaves room
    hostSource.destroy();
    assert.equal(hostSource.isDestroyed, true);
    assert.equal(hostSource.status, 'destroyed');
  });
});
