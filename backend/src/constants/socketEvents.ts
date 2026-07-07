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

export type SocketEvent = typeof SOCKET_EVENTS[keyof typeof SOCKET_EVENTS];
