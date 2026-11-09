/**
 * media/types.ts
 * ──────────────
 * Clean MediaSource abstraction. Only LocalMediaSource exists for MVP.
 * CloudMediaSource can be added here later without changing any other file.
 */

/** Describes a resolved media source (no raw bytes stored here). */
export interface MediaSourceDescriptor {
  /** 'local' for MVP. Future: 'cloud' */
  type: 'local';
  /** Stable UUID for this session */
  id: string;
  /** Display name (filename for local) */
  name: string;
  /** MIME type e.g. 'video/mp4' */
  mimeType: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Detected video duration in seconds; null if not yet loaded */
  durationSeconds: number | null;
  /** Detected video width; null if not yet loaded */
  width: number | null;
  /** Detected video height; null if not yet loaded */
  height: number | null;
}

/** Possible states of a LocalMediaSource lifecycle */
export type MediaSourceStatus =
  | 'idle'
  | 'loading_metadata'
  | 'ready'
  | 'error'
  | 'destroyed';
