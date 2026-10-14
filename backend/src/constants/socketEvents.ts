export const SOCKET_EVENTS = {
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
  JOIN_ROOM: 'join-room',
  MEDIA_ACTION: 'media-action',
  SYNC_STATE: 'sync-state',
  ROOM_CHAT_MSG: 'room-chat-msg',
  UPDATE_ROOM_CHAT: 'update-room-chat',
  CHANGE_VIDEO_SRC: 'change-video-src',
  UPDATE_VIDEO_SRC: 'update-video-src',
} as const;

/**
 * WebRTC Signaling Events — pure relay; no video bytes ever pass through these.
 * The backend acts as a signaling router: it finds the target socket and forwards.
 */
export const WEBRTC_EVENTS = {
  /** Viewer signals it is ready for a peer connection (viewer → host via server) */
  VIEWER_READY: 'webrtc:viewer-ready',
  /** Host sends SDP offer to a specific viewer (host → viewer via server) */
  OFFER: 'webrtc:offer',
  /** Viewer sends SDP answer back to host (viewer → host via server) */
  ANSWER: 'webrtc:answer',
  /** Either side sends an ICE candidate to the other (bidirectional relay) */
  ICE_CANDIDATE: 'webrtc:ice-candidate',
  /** Host notifies all viewers that the media stream is starting */
  HOST_STREAM_READY: 'webrtc:host-stream-ready',
  /** Host notifies all viewers that the stream has ended */
  HOST_STREAM_ENDED: 'webrtc:host-stream-ended',
  /** Host broadcasts media file metadata (name, duration — never file bytes) */
  MEDIA_INFO: 'webrtc:media-info',
} as const;

export type SocketEvent = typeof SOCKET_EVENTS[keyof typeof SOCKET_EVENTS];
export type WebRTCEvent = typeof WEBRTC_EVENTS[keyof typeof WEBRTC_EVENTS];
