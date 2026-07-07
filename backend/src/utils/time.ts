/**
 * Normalizes video player seek timestamps cleanly across clients.
 */
export function normalizeTimestamp(seconds: number): number {
  if (isNaN(seconds) || seconds < 0) return 0;
  // Round to 3 decimal places to prevent sub-millisecond sync jitter
  return Math.round(seconds * 1000) / 1000;
}
