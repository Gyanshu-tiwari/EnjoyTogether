import { useEffect, useState, useRef } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import axios from 'axios';
import { supabase } from '@/shared/lib/supabase';

const getAnonymousUserId = () => {
  let anonId = localStorage.getItem('et_anon_user_id');
  if (!anonId) {
    anonId = 'anon_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('et_anon_user_id', anonId);
  }
  return anonId;
};

export interface ParticipantInfo {
  identity: string;
  isLocal: boolean;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  videoTrack?: Track;
  audioTrack?: Track;
}

export function useLiveKitRoom(roomId: string, sessionState: string) {
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(sessionState === 'active_session');
  const [error, setError] = useState<string | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const roomRef = useRef<Room | null>(null);

  // Reset states on roomId / sessionState change using derived state pattern
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
    if (sessionState !== 'active_session') {
      return;
    }

    let active = true;
    
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    const updateParticipantsList = () => {
      if (!active) return;
      const list: ParticipantInfo[] = [];

      // Add local participant
      const local = room.localParticipant;
      if (local) {
        const videoPub = Array.from(local.videoTrackPublications.values())[0];
        const audioPub = Array.from(local.audioTrackPublications.values())[0];
        list.push({
          identity: local.identity + ' (You)',
          isLocal: true,
          isMicEnabled: local.isMicrophoneEnabled,
          isCameraEnabled: local.isCameraEnabled,
          videoTrack: videoPub?.track,
          audioTrack: audioPub?.track,
        });
      }

      // Add remote participants
      room.remoteParticipants.forEach((p) => {
        const videoPub = Array.from(p.videoTrackPublications.values())[0];
        const audioPub = Array.from(p.audioTrackPublications.values())[0];
        list.push({
          identity: p.identity,
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
        const userIdentity = session?.user?.email || session?.user?.id || getAnonymousUserId();

        const backendHost = window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname;
        
        // 1. Hit the backend to grab BOTH the token and the server URL target
        const res = await axios.get(
          `http://${backendHost}:5000/api/livekit/token?room_id=${roomId}&user_id=${encodeURIComponent(userIdentity)}`
        );
        const { token, serverUrl } = res.data;

        if (!active) return;

        if (!serverUrl) {
          throw new Error('LiveKit configuration missing server routing target location.');
        }

        // Register room events to trigger updates
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

        events.forEach((evt) => {
          room.on(evt, updateParticipantsList);
        });

        // 2. Connect dynamically to whatever serverUrl the backend returned
        console.log(`🌐 Routing connection pipeline to node target: ${serverUrl}`);
        await room.connect(serverUrl, token);
        console.log('✅ Connected to LiveKit Room:', room.name);
        
        if (!active) {
          await room.disconnect();
          return;
        }

        setLoading(false);

        // Meet-style defaults
        await room.localParticipant.setMicrophoneEnabled(true);
        await room.localParticipant.setCameraEnabled(false);
        setIsMicEnabled(true);
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
        roomRef.current.removeAllListeners();
        roomRef.current.disconnect();
      }
      setParticipants([]);
    };
  }, [roomId, sessionState]);

  return { participants, loading, error, isMicEnabled, isCameraEnabled, toggleMic, toggleCamera };
}