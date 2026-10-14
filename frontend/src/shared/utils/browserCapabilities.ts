/**
 * browserCapabilities.ts
 * ──────────────────────
 * Detects browser support for the APIs required by the local-first WebRTC
 * watch-together architecture.
 *
 * Rules:
 * - Never throw; always return a structured report.
 * - Never silently swallow a missing API.
 * - All detection is synchronous so callers can gate UI before any async work.
 */

export interface BrowserCapabilityReport {
  /** Whether HTMLVideoElement.captureStream() exists */
  captureStream: boolean;
  /** Whether RTCPeerConnection exists */
  webrtc: boolean;
  /** Whether MediaStream exists */
  mediaStream: boolean;
  /** Whether the File API (FileReader/URL.createObjectURL) is available */
  fileApi: boolean;
  /** Whether the full local-streaming flow is supported */
  canDoLocalStream: boolean;
  /** Human-readable summary of missing capabilities */
  missingCapabilities: string[];
}

interface VideoElementWithCapture extends HTMLVideoElement {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
}

/**
 * Returns a snapshot of browser capability without throwing.
 * Safe to call at module-load time.
 */
export function detectCapabilities(): BrowserCapabilityReport {
  const missing: string[] = [];

  // captureStream: may be prefixed in some browsers
  const hasCaptureStream = (() => {
    try {
      const el = document.createElement('video') as VideoElementWithCapture;
      return typeof el.captureStream === 'function' ||
             typeof el.mozCaptureStream === 'function';
    } catch {
      return false;
    }
  })();
  if (!hasCaptureStream) missing.push('HTMLVideoElement.captureStream()');

  const hasWebRTC = typeof RTCPeerConnection !== 'undefined';
  if (!hasWebRTC) missing.push('RTCPeerConnection');

  const hasMediaStream = typeof MediaStream !== 'undefined';
  if (!hasMediaStream) missing.push('MediaStream');

  const hasFileApi =
    typeof File !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function';
  if (!hasFileApi) missing.push('File API / URL.createObjectURL');

  return {
    captureStream: hasCaptureStream,
    webrtc: hasWebRTC,
    mediaStream: hasMediaStream,
    fileApi: hasFileApi,
    canDoLocalStream: hasCaptureStream && hasWebRTC && hasMediaStream && hasFileApi,
    missingCapabilities: missing,
  };
}

/**
 * Calls captureStream() accounting for vendor prefixes.
 * Returns null if the video element doesn't support it.
 */
export function captureStreamSafe(video: HTMLVideoElement): MediaStream | null {
  try {
    const el = video as VideoElementWithCapture;
    if (typeof el.captureStream === 'function') {
      return el.captureStream();
    }
    if (typeof el.mozCaptureStream === 'function') {
      return el.mozCaptureStream();
    }
  } catch (err) {
    console.error('[browserCapabilities] captureStream() threw:', err);
  }
  return null;
}

/**
 * Returns a user-friendly error message for an unsupported capability.
 */
export function getCapabilityErrorMessage(report: BrowserCapabilityReport): string {
  if (report.canDoLocalStream) return '';

  const list = report.missingCapabilities.join(', ');
  return (
    `Your browser does not support the following required APIs: ${list}. ` +
    `Please use the latest version of Chrome, Edge, or Firefox to host a local watch party.`
  );
}
