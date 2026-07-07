import React, { useEffect, useRef } from 'react';
import { Track } from 'livekit-client';
import { Spinner } from '@/shared/components/feedback/Spinner';
import type { ParticipantInfo } from '../hooks/useLiveKitRoom';

interface VideoCallOverlayProps {
  participants: ParticipantInfo[];
  loading: boolean;
  error: string | null;
}

const TrackRenderer: React.FC<{ track: Track; isLocal?: boolean }> = ({ track, isLocal }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (el) {
      track.attach(el);
    }
    return () => {
      if (el) {
        track.detach(el);
      }
    };
  }, [track]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={isLocal}
      className={`w-full h-full object-cover ${isLocal ? 'scale-x-[-1]' : ''}`}
    />
  );
};

const AudioRenderer: React.FC<{ track: Track }> = ({ track }) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (el) {
      track.attach(el);
    }
    return () => {
      if (el) {
        track.detach(el);
      }
    };
  }, [track]);

  return <audio ref={audioRef} autoPlay />;
};

export const VideoCallOverlay: React.FC<VideoCallOverlayProps> = ({
  participants,
  loading,
  error,
}) => {
  // Limit rendering to a maximum of 10 participants
  const displayParticipants = participants.slice(0, 10);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-red-950/20 border border-red-500/30 h-full text-center gap-3 animate-fade-in">
        <span className="text-2xl">⚠️</span>
        <p className="text-sm font-bold text-red-450">Video Call Failed</p>
        <p className="text-[11px] text-neutral-400 max-w-[240px] font-mono leading-normal">
          {error}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-8 rounded-2xl bg-neutral-900/40 border border-white/5 h-full text-center gap-4 animate-pulse">
        <Spinner size="sm" />
        <p className="text-sm font-semibold text-neutral-300">Connecting to voice mesh...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full justify-between">
      {/* Hidden audio players to hear remote participants */}
      <div className="hidden">
        {displayParticipants
          .filter((p) => p.audioTrack && !p.isLocal)
          .map((p) => (
            <AudioRenderer key={p.identity} track={p.audioTrack!} />
          ))}
      </div>

      {/* Grid of Participants */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        {displayParticipants.length === 0 ? (
          <div className="flex flex-col items-center justify-center border border-white/5 bg-neutral-900/10 rounded-2xl h-[280px] text-center gap-3 animate-fade-in">
            <span className="text-2xl">📡</span>
            <p className="text-sm font-bold text-neutral-300">Connected</p>
            <p className="text-xs text-neutral-500 max-w-[220px]">
              Waiting for other peers to join voice chat.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 w-full">
            {displayParticipants.map((p) => {
              const initial = p.identity ? p.identity.charAt(0).toUpperCase() : '?';
              return (
                <div
                  key={p.identity}
                  className="relative aspect-video rounded-2xl bg-neutral-950 border border-white/5 hover:border-cyan-500/20 transition-all duration-300 group overflow-hidden flex flex-col items-center justify-center"
                >
                  {/* Camera Video Stream vs Placeholder Avatar */}
                  {p.isCameraEnabled && p.videoTrack ? (
                    <div className="absolute inset-0 w-full h-full z-0">
                      <TrackRenderer track={p.videoTrack} isLocal={p.isLocal} />
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 text-center z-10 select-none animate-fade-in">
                      <div className="w-10 h-10 rounded-full bg-linear-to-br from-blue-500/10 to-indigo-600/20 border border-blue-500/20 flex items-center justify-center shadow-inner">
                        <span className="text-xs font-bold text-cyan-300 font-mono">
                          {initial}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Top Right Mic Status Badge */}
                  <div className="absolute top-2 right-2 z-20">
                    {p.isMicEnabled ? (
                      <span className="flex h-5 w-5 items-center justify-center bg-emerald-500/10 border border-emerald-500/20 rounded-full backdrop-blur-md text-[10px]" title="Microphone Active">
                        🎙️
                      </span>
                    ) : (
                      <span className="flex h-5 w-5 items-center justify-center bg-red-500/25 border border-red-500/35 rounded-full backdrop-blur-md text-[10px]" title="Microphone Muted">
                        🔇
                      </span>
                    )}
                  </div>

                  {/* Bottom Identity Label Overlay */}
                  <div className="absolute bottom-2 left-2 right-2 flex justify-center z-20">
                    <span className="text-[9px] font-medium text-neutral-300 font-mono truncate max-w-full px-1.5 py-0.5 text-center bg-black/60 rounded-md backdrop-blur-md border border-white/5">
                      {p.identity}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoCallOverlay;
