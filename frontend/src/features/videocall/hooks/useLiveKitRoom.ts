import { useEffect, useState, useRef } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import axios from 'axios';
import { supabase } from '@/shared/lib/supabase';
import { getAnonymousUserId } from '@/shared/utils/anonymousUser';

// ─── Types ───────────────────────────────────────────────────────────────────
export type WatchPartyRole = 'host' | 'co-host' | 'viewer';

export interface ParticipantInfo {
  identity: string;
  isLocal: boolean;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  videoTrack?: Track;
  audioTrack?: Track;
}

// ─── Hook ────────────────────────────────────────────────────────────────────
export function useLiveKitRoom(roomId: string, sessionState: string) {
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(sessionState === 'active_session');
  const [error, setError] = useState<string | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [userRole, setUserRole] = useState<WatchPartyRole>('viewer');
  const roomRef = useRef<Room | null>(null);

  // Reset states on roomId / sessionState change (derived state pattern)
  const [prevRoomId, setPrevRoomId] = useState(roomId);
  const [prevSessionState, setPrevSessionState] = useState(sessionState);
  if (roomId !== prevRoomId || sessionState !== prevSessionState) {
    setPrevRoomId(roomId);
    setPrevSessionState(sessionState);
    setLoading(sessionState === 'active_session');
    setError(null);
    setParticipants([]);
    setIsMicEnabled(true);
    setIsCameraEnabled(false);
    setUserRole('viewer');
  }

  const toggleMic = async () => {
    if (!roomRef.current) return;
    try {
      const enabled = !isMicEnabled;
      await roomRef.current.localParticipant.setMicrophoneEnabled(enabled);
      setIsMicEnabled(enabled);
    } catch (err) {
      console.error('Failed to toggle microphone:', err);
    }
  };

  const toggleCamera = async () => {
    if (!roomRef.current) return;
    try {
      const enabled = !isCameraEnabled;
      await roomRef.current.localParticipant.setCameraEnabled(enabled);
      setIsCameraEnabled(enabled);
    } catch (err) {
      console.error('Failed to toggle camera:', err);
    }
  };

  useEffect(() => {
    if (sessionState !== 'active_session') return;

    let active = true;

    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const updateParticipantsList = () => {
      if (!active) return;
      const list: ParticipantInfo[] = [];

      const local = room.localParticipant;
      if (local) {
        const videoPub = Array.from(local.videoTrackPublications.values())[0];
        const audioPub = Array.from(local.audioTrackPublications.values())[0];
        list.push({
          identity: (local.name || local.identity) + ' (You)',
          isLocal: true,
          isMicEnabled: local.isMicrophoneEnabled,
          isCameraEnabled: local.isCameraEnabled,
          videoTrack: videoPub?.track,
          audioTrack: audioPub?.track,
        });
      }

      room.remoteParticipants.forEach((p) => {
        const videoPub = Array.from(p.videoTrackPublications.values())[0];
        const audioPub = Array.from(p.audioTrackPublications.values())[0];
        list.push({
          identity: p.name || p.identity,
          isLocal: false,
          isMicEnabled: p.isMicrophoneEnabled,
          isCameraEnabled: p.isCameraEnabled,
          videoTrack: videoPub?.track,
          audioTrack: audioPub?.track,
        });
      });

      setParticipants(list);
    };

    const setupLiveKit = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id || getAnonymousUserId();
        const userName = session?.user?.email || userId;

        const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
        const res = await axios.get(`${backendUrl}/api/livekit/token?room_id=${roomId}&user_id=${encodeURIComponent(userId)}&user_name=${encodeURIComponent(userName)}`);
        const { token, serverUrl, role } = res.data as {
          token: string;
          serverUrl: string;
          role: WatchPartyRole;
        };

        if (!active) return;

        if (!serverUrl) throw new Error('LiveKit configuration missing server routing target location.');

        // ── Hydrate RBAC role received from backend ──────────────────────────
        if (role) setUserRole(role);

        const events = [
          RoomEvent.ParticipantConnected,
          RoomEvent.ParticipantDisconnected,
          RoomEvent.TrackSubscribed,
          RoomEvent.TrackUnsubscribed,
          RoomEvent.TrackMuted,
          RoomEvent.TrackUnmuted,
          RoomEvent.LocalTrackPublished,
          RoomEvent.LocalTrackUnpublished,
        ];
        events.forEach((evt) => { room.on(evt, updateParticipantsList); });

        console.log(`🌐 Routing connection pipeline to node target: ${serverUrl}`);
        await room.connect(serverUrl, token);
        console.log('✅ Connected to LiveKit Room:', room.name);

        if (!active) {
          await room.disconnect();
          return;
        }

        setLoading(false);

        // Viewers are receive-only — don't enable mic publishing on the SFU
        const canPublish = role === 'host' || role === 'co-host';
        await room.localParticipant.setMicrophoneEnabled(canPublish);
        await room.localParticipant.setCameraEnabled(false);
        setIsMicEnabled(canPublish);
        setIsCameraEnabled(false);

        updateParticipantsList();
      } catch (err) {
        if (active) {
          console.error('❌ Failed to setup LiveKit:', err);
          const errMsg = err instanceof Error ? err.message : 'Failed to establish connection to LiveKit node.';
          setError(errMsg);
          setLoading(false);
        } else {
          console.log('ℹ️ LiveKit connection aborted intentionally (cleanup).');
        }
      }
    };

    setupLiveKit();

    return () => {
      active = false;
      if (roomRef.current) {
        // Stop all local tracks before disconnecting to ensure
        // the browser camera/microphone indicator light turns off.
        roomRef.current.localParticipant?.trackPublications.forEach((pub) => {
          pub.track?.stop();
        });
        roomRef.current.removeAllListeners();
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      setParticipants([]);
    };
  }, [roomId, sessionState]);

  return { participants, loading, error, isMicEnabled, isCameraEnabled, userRole, toggleMic, toggleCamera };
}