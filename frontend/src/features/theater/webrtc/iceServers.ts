/**
 * iceServers.ts
 * ─────────────
 * Builds the RTCIceServer[] configuration from environment variables.
 * Falls back to Google's public STUN servers when nothing is configured.
 *
 * For production: set VITE_STUN_URLS and optionally VITE_TURN_URL,
 * VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL in the frontend .env.
 */

export function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [];

  // ── STUN ──────────────────────────────────────────────────────────────────
  const stunUrls =
    import.meta.env.VITE_STUN_URLS ||
    'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302';

  const stunList = stunUrls
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  if (stunList.length > 0) {
    servers.push({ urls: stunList });
  }

  // ── TURN ──────────────────────────────────────────────────────────────────
  const turnUrl = import.meta.env.VITE_TURN_URL || '';
  const turnUsername = import.meta.env.VITE_TURN_USERNAME || '';
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL || '';

  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      ...(turnUsername && { username: turnUsername }),
      ...(turnCredential && { credential: turnCredential }),
    });
  }

  return servers;
}
