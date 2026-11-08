import React, { useEffect, useRef } from 'react';
import { Track } from 'livekit-client';
import type { ParticipantInfo } from '../hooks/useLiveKitRoom';
import { AlertTriangle, Radio, Mic, MicOff } from 'lucide-react';
import { Avatar } from '@/shared/components/ui/Avatar';

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
      <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-red-950/20 border border-red-500/30 h-full text-center gap-3 animate-fade-in text-red-400">
        <AlertTriangle className="w-6 h-6" />
        <p className="text-sm font-bold">Video Call Failed</p>
        <p className="text-[11px] text-text-secondary max-w-60 font-mono leading-normal">
          {error}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col gap-2 w-full">
        <p className="text-[10px] text-text-secondary font-bold uppercase tracking-wider mb-1 animate-pulse">Connecting to voice mesh...</p>
        <div className="grid grid-cols-2 gap-2 w-full">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="relative aspect-video rounded-2xl bg-bg-primary border border-white/5 overflow-hidden flex flex-col items-center justify-center"
            >
              <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/5 to-transparent animate-shimmer" />
              <div className="w-10 h-10 rounded-full bg-bg-card flex items-center justify-center animate-pulse" />
              <div className="w-16 h-3 bg-bg-card rounded-md mt-2 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full justify-between">
      {/* Hidden audio players to hear remote participants */}
      <div className="sr-only" aria-hidden="true">
        {displayParticipants
          .filter((p) => p.audioTrack && !p.isLocal)
          .map((p) => (
            <AudioRenderer key={p.identity} track={p.audioTrack!} />
          ))}
      </div>

      {/* Grid of Participants */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        {displayParticipants.length === 0 ? (
          <div className="flex flex-col items-center justify-center border border-white/5 bg-bg-primary/10 rounded-2xl p-6 text-center gap-2 animate-fade-in aspect-video w-full">
            <Radio className="w-6 h-6 text-indigo-400 mb-1 animate-pulse" />
            <p className="text-xs font-bold text-neutral-300">Voice Connected</p>
            <p className="text-[11px] text-text-secondary max-w-44 leading-tight">
              Waiting for friends to join...
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 w-full pb-4">
            {displayParticipants.map((p) => {
              const cleanName = (name: string): string => {
                if (!name) return '';
                const isLocal = name.endsWith(' (You)');
                const baseName = isLocal ? name.slice(0, -6) : name;
                const cleanBase = baseName.includes('@') ? baseName.split('@')[0] : baseName;
                return isLocal ? `${cleanBase} (You)` : cleanBase;
              };

              const displayName = cleanName(p.identity);
              const initial = displayName ? displayName.charAt(0).toUpperCase() : '?';

              return (
                <div
                  key={p.identity}
                  className="relative w-full aspect-video rounded-2xl bg-[#141418] border border-white/10 hover:border-white/20 transition-all duration-200 group overflow-hidden shadow-xl flex items-center justify-center"
                >
                  {/* Camera Video Stream vs Centered Avatar */}
                  {p.isCameraEnabled && p.videoTrack ? (
                    <div className="absolute inset-0 w-full h-full z-0">
                      <TrackRenderer track={p.videoTrack} isLocal={p.isLocal} />
                    </div>
                  ) : (
                    <div className="absolute inset-0 w-full h-full bg-linear-to-b from-[#22222a] to-[#121215] flex items-center justify-center z-0">
                      <Avatar
                        fallback={initial}
                        size="lg"
                        className="border border-white/15 shadow-lg"
                      />
                    </div>
                  )}

                  {/* Bottom subtle gradient for contrast with name overlay */}
                  <div className="absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-black/80 via-black/40 to-transparent pointer-events-none z-10" />

                  {/* Bottom-left: Traditional Name Badge */}
                  <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-md border border-white/10 z-20 max-w-[75%]">
                    <span className="text-xs font-medium text-white truncate drop-shadow-sm">
                      {displayName}
                    </span>
                  </div>

                  {/* Bottom-right: Mic Indicator */}
                  <div className="absolute bottom-2.5 right-2.5 z-20">
                    {p.isMicEnabled ? (
                      <div className="w-6 h-6 rounded-full bg-black/60 backdrop-blur-md border border-white/10 flex items-center justify-center text-neutral-300 shadow-sm">
                        <Mic className="w-3.5 h-3.5" />
                      </div>
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-red-500/90 border border-red-400/30 flex items-center justify-center text-white shadow-md">
                        <MicOff className="w-3.5 h-3.5" />
                      </div>
                    )}
                  </div>

                  {/* Active speaker / hover ring */}
                  <div className="absolute inset-0 rounded-2xl border-2 border-transparent group-hover:border-indigo-500/40 pointer-events-none transition-colors duration-200" />
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
