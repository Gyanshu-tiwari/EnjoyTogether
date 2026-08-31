import React, { useEffect, useRef } from 'react';
import { Track } from 'livekit-client';
import type { ParticipantInfo } from '../hooks/useLiveKitRoom';
import { AlertTriangle, Radio, Mic, MicOff } from 'lucide-react';

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
          <div className="flex flex-col items-center justify-center border border-white/5 bg-bg-primary/10 rounded-2xl h-70 text-center gap-3 animate-fade-in">
            <Radio className="w-8 h-8 text-indigo-400 mb-2 animate-pulse" />
            <p className="text-sm font-bold text-neutral-300">Connected</p>
            <p className="text-xs text-text-secondary max-w-55">
              Waiting for other peers to join voice chat.
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
              
              // Simulate an active speaker border if they are speaking (or random for visual flair if not provided by livekit)
              // Currently LiveKit exposes isSpeaking on the track/participant if subscribed to, but we'll use a hover effect as a placeholder for interactivity.
              
              return (
                <div key={p.identity} className="relative h-24 w-full rounded-xl bg-[#1e1e1e] border border-white/5 hover:border-[#4f46e5]/50 transition-all duration-300 group overflow-hidden flex shadow-lg">
                  
                  {/* Camera Video Stream vs Placeholder Avatar */}
                  {p.isCameraEnabled && p.videoTrack ? (
                    <div className="absolute inset-0 w-full h-full z-0">
                      <TrackRenderer track={p.videoTrack} isLocal={p.isLocal} />
                    </div>
                  ) : (
                    <div className="absolute inset-0 w-full h-full bg-[#121212] flex items-center justify-center z-0">
                      <div className="w-12 h-12 rounded-full bg-brand-muted border border-brand-border flex items-center justify-center shadow-inner">
                        <span className="text-sm font-bold text-indigo-400 font-mono">
                          {initial}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Right Side Gradient Overlay */}
                  <div className="absolute inset-0 bg-linear-to-l from-black/90 via-black/40 to-transparent pointer-events-none z-10" />

                  {/* User Info (Name & Mic) on the right */}
                  <div className="absolute inset-y-0 right-4 flex items-center justify-end gap-3 z-20">
                    <span className="text-[13px] font-medium text-neutral-200 drop-shadow-md truncate max-w-30">
                      {displayName}
                    </span>
                    {p.isMicEnabled ? (
                      <Mic className="w-4 h-4 text-neutral-400 drop-shadow-md" />
                    ) : (
                      <MicOff className="w-4 h-4 text-red-500 drop-shadow-md" />
                    )}
                  </div>
                  
                  {/* Active Speaker Border Glow (mocked with hover for now) */}
                  <div className="absolute inset-0 border-2 border-transparent group-hover:border-[#4f46e5] rounded-xl z-30 pointer-events-none transition-colors duration-300"></div>
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
