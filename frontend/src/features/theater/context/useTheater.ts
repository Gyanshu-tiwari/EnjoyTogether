/**
 * useTheater.ts
 * ─────────────
 * TheaterContext type definition + createContext + useTheater hook.
 */

import { createContext, useContext } from 'react';
import { Socket } from 'socket.io-client';
import type { WatchPartyRole } from '@/features/videocall/hooks/useLiveKitRoom';
import type { LocalMediaSource } from '../media/LocalMediaSource';
import type { MediaSourceDescriptor } from '../media/types';

export interface Comment {
  userId?: string;
  user: string;
  text: string;
}

export interface ActiveUser {
  socketId: string;
  userId: string;
  name: string;
  role: string;
  isHost: boolean;
}

export interface KnockRequest {
  socketId: string;
  username: string;
}

export interface FloatingEmoji {
  id: string;
  emoji: string;
}

/** Status of the WebRTC media connection */
export type WebRTCStatus = 'idle' | 'connecting' | 'connected' | 'failed' | 'host_disconnected';

export interface TheaterContextType {
  roomId: string;
  socket: Socket | null;

  // ── Legacy HLS stream URL (preserved for backward compat) ──────────────
  currentStreamUrl: string;
  setCurrentStreamUrl: (url: string) => void;

  // ── Local-first media (MVP) ──────────────────────────────────────────────
  /** The raw File selected by the Host — only populated on Host browser */
  localFile: File | null;
  setLocalFile: (f: File | null) => void;
  /** Manages the File lifecycle (objectUrl, captureStream, destroy) */
  mediaSource: LocalMediaSource | null;
  /** Resolved metadata (name, duration, resolution) for display */
  mediaDescriptor: MediaSourceDescriptor | null;
  /** The Host's captured MediaStream (host-side only) */
  hostStream: MediaStream | null;
  /** The incoming stream received from the host (viewer-side) */
  viewerStream: MediaStream | null;
  setViewerStream: (s: MediaStream | null) => void;
  /** WebRTC connection status */
  webrtcStatus: WebRTCStatus;
  setWebRTCStatus: (s: WebRTCStatus) => void;
  /** Host: begin captureStream and initialize WebRTCHostManager */
  startHostCapture: (videoEl: HTMLVideoElement) => void;

  // ── Chat ──────────────────────────────────────────────────────────────────
  comments: Comment[];
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  inputMessage: string;
  setInputMessage: (msg: string) => void;
  sendMessage: () => void;

  // ── UI state ──────────────────────────────────────────────────────────────
  activeTab: 'chat' | 'call';
  setActiveTab: (tab: 'chat' | 'call') => void;

  // ── Session / room lifecycle ───────────────────────────────────────────────
  sessionState: 'idle_host' | 'idle_guest' | 'knocking' | 'rejected' | 'active_session';
  isHost: boolean;
  startSession: () => Promise<void>;
  endSession: () => Promise<void>;
  loading: boolean;
  dbError: string | null;

  // ── Admission ────────────────────────────────────────────────────────────
  knocks: KnockRequest[];
  approveGuest: (socketId: string) => void;
  rejectGuest: (socketId: string) => void;

  // ── Reactions ────────────────────────────────────────────────────────────
  sendEmoji: (emoji: string) => void;
  floatingEmojis: FloatingEmoji[];

  // ── RBAC ─────────────────────────────────────────────────────────────────
  userRole: WatchPartyRole;
  setUserRole: (role: WatchPartyRole) => void;
  activeUsers: ActiveUser[];
  changeRole: (userId: string, newRole: string) => void;
  kickUser: (userId: string) => void;
  currentUserId: string | null;
  /** Non-null when the local user has been kicked — holds the reason string */
  kickedReason: string | null;

  // ── WebRTC signaling actions ───────────────────────────────────────────────
  sendWebRTCOffer: (targetId: string, sdp: RTCSessionDescriptionInit, connectionId: string) => void;
  sendWebRTCAnswer: (sdp: RTCSessionDescriptionInit, connectionId: string) => void;
  sendWebRTCIce: (targetId: string, candidate: RTCIceCandidateInit, connectionId: string) => void;
  signalViewerReady: (connectionId: string) => void;
  notifyHostStreamReady: (mediaName: string, mediaDuration: number | null) => void;
  notifyHostStreamEnded: () => void;
}

export const TheaterContext = createContext<TheaterContextType | undefined>(undefined);

export const useTheater = () => {
  const context = useContext(TheaterContext);
  if (!context) {
    throw new Error('useTheater must be used within a TheaterProvider');
  }
  return context;
};
