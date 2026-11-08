/**
 * LocalMediaSource.ts
 * ───────────────────
 * Manages the lifecycle of a browser-local video File used as a watch-party source.
 *
 * Responsibilities:
 * - Accept a File object from the browser File API
 * - Create / revoke an object URL safely
 * - Load metadata (duration, resolution) via a hidden <video> element
 * - Expose captureStream() for WebRTC transmission
 * - Destroy all resources cleanly on end-of-life
 *
 * Rules:
 * - NEVER uploads the file
 * - NEVER exposes the local filesystem path
 * - NEVER stores raw video bytes in memory
 * - NEVER sends the File object over any network channel
 */

import { captureStreamSafe } from '../../../shared/utils/browserCapabilities';
import type { MediaSourceDescriptor, MediaSourceStatus } from './types';

export class LocalMediaSource {
  private _file: File;
  private _objectUrl: string | null = null;
  private _descriptor: MediaSourceDescriptor;
  private _status: MediaSourceStatus = 'idle';
  private _metadataProbeVideo: HTMLVideoElement | null = null;

  constructor(file: File) {
    this._file = file;

    const id = crypto.randomUUID();
    this._descriptor = {
      type: 'local',
      id,
      name: file.name,
      mimeType: file.type || 'video/mp4',
      sizeBytes: file.size,
      durationSeconds: null,
      width: null,
      height: null,
    };

    console.log(`[LocalMediaSource] Created for file: "${file.name}" (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  }

  get status(): MediaSourceStatus {
    return this._status;
  }

  get isDestroyed(): boolean {
    return this._status === 'destroyed';
  }

  get file(): File {
    return this._file;
  }

  get descriptor(): Readonly<MediaSourceDescriptor> {
    return { ...this._descriptor };
  }

  /**
   * Explicitly revives a destroyed source using its retained File reference.
   * Useful when React remounts or re-renders before permanent disposal.
   */
  revive(): void {
    if (this._status === 'destroyed') {
      this._status = this._descriptor.durationSeconds !== null ? 'ready' : 'idle';
      console.log(`[LocalMediaSource] Source revived for "${this._file.name}".`);
    }
  }

  /**
   * Revokes the active object URL without destroying the file reference.
   * A new URL can be generated on demand via getObjectUrl().
   */
  revokeObjectUrl(): void {
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
      console.log(`[LocalMediaSource] Object URL revoked for "${this._file.name}".`);
    }
  }

  /**
   * Creates an object URL for the file.
   * Call this before attaching to a <video> element.
   * Safe to call multiple times — only creates one URL.
   * If called after a transient destroy, revives the source automatically.
   */
  getObjectUrl(): string {
    if (this._status === 'destroyed') {
      if (this._file) {
        console.warn(`[LocalMediaSource] getObjectUrl called on destroyed source for "${this._file.name}". Auto-reviving from retained File.`);
        this.revive();
      } else {
        throw new Error('[LocalMediaSource] Cannot get URL: source has been destroyed.');
      }
    }
    if (!this._objectUrl) {
      this._objectUrl = URL.createObjectURL(this._file);
      console.log('[LocalMediaSource] Object URL created.');
    }
    return this._objectUrl;
  }

  /**
   * Loads video metadata (duration, width, height) by probing a hidden
   * <video> element. Resolves when metadata is available.
   * Safe to call multiple times — caches result.
   */
  async loadMetadata(): Promise<MediaSourceDescriptor> {
    if (this._status === 'destroyed') {
      if (this._file) {
        console.warn(`[LocalMediaSource] loadMetadata called on destroyed source for "${this._file.name}". Auto-reviving from retained File.`);
        this.revive();
      } else {
        throw new Error('[LocalMediaSource] Cannot load metadata: source has been destroyed.');
      }
    }
    if (this._descriptor.durationSeconds !== null) {
      // Already loaded
      return this.descriptor;
    }

    this._status = 'loading_metadata';

    return new Promise<MediaSourceDescriptor>((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      this._metadataProbeVideo = video;

      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onMeta);
        video.removeEventListener('error', onError);
        video.src = '';
        video.load();
        this._metadataProbeVideo = null;
      };

      const onMeta = () => {
        cleanup();
        this._descriptor = {
          ...this._descriptor,
          durationSeconds: isFinite(video.duration) ? video.duration : null,
          width: video.videoWidth || null,
          height: video.videoHeight || null,
        };
        this._status = 'ready';
        console.log(`[LocalMediaSource] Metadata loaded: ${this._descriptor.durationSeconds?.toFixed(1)}s @ ${this._descriptor.width}x${this._descriptor.height}`);
        resolve(this.descriptor);
      };

      const onError = () => {
        cleanup();
        this._status = 'error';
        const err = new Error(
          `[LocalMediaSource] Cannot load metadata for "${this._file.name}". ` +
          `The file may be corrupt or an unsupported format (type: ${this._file.type || 'unknown'}).`
        );
        reject(err);
      };

      video.addEventListener('loadedmetadata', onMeta, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.src = this.getObjectUrl();
      video.load();
    });
  }

  /**
   * Calls captureStream() on the provided <video> element (which must be
   * playing or have played this source). Returns null if unsupported.
   *
   * IMPORTANT: Do NOT call captureStream() on the probe video — call it on
   * the actual player <video> element that the user is watching.
   */
  captureStream(videoElement: HTMLVideoElement): MediaStream | null {
    if (this._status === 'destroyed') {
      if (this._file) {
        console.warn(`[LocalMediaSource] captureStream called on destroyed source for "${this._file.name}". Auto-reviving.`);
        this.revive();
      } else {
        console.error('[LocalMediaSource] Cannot capture stream: source destroyed.');
        return null;
      }
    }
    const stream = captureStreamSafe(videoElement);
    if (!stream) {
      console.error('[LocalMediaSource] captureStream() returned null — browser may not support it.');
    } else {
      console.log(`[LocalMediaSource] captureStream() succeeded: ${stream.getTracks().length} track(s).`);
    }
    return stream;
  }

  /**
   * Releases all resources:
   * - Revokes the object URL
   * - Clears the metadata probe video
   * - Marks this instance as destroyed
   *
   * After calling destroy(), this instance must not be used again.
   */
  destroy(): void {
    if (this._status === 'destroyed') return;

    console.log(`[LocalMediaSource] Destroying source for "${this._file.name}".`);

    // Clean up metadata probe if still active
    if (this._metadataProbeVideo) {
      this._metadataProbeVideo.removeAttribute('src');
      this._metadataProbeVideo.load();
      this._metadataProbeVideo = null;
    }

    // Revoke object URL to free browser memory
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
      console.log('[LocalMediaSource] Object URL revoked.');
    }

    this._status = 'destroyed';
  }
}
