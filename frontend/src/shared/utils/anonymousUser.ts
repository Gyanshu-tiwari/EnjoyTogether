/**
 * Generates and persists a stable anonymous user ID in localStorage.
 * Single source of truth — eliminates duplicated implementations in
 * useRoomSession.ts and useLiveKitRoom.ts.
 */
export function getAnonymousUserId(): string {
  let anonId = localStorage.getItem('et_anon_user_id');
  if (!anonId) {
    anonId = 'anon_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('et_anon_user_id', anonId);
  }
  return anonId;
}
