import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { supabase } from '@/shared/lib/supabase';
import { Button } from '@/shared/components/ui/Button';
import { Spinner } from '@/shared/components/feedback/Spinner';
import { LoginForm, useAuthSession } from '@/features/auth';
import { UploadDashboard, TheaterProvider, TheaterView, useTheater } from '@/features/theater';

const RoomContent: React.FC<{
  roomId: string;
  onExit: () => void;
}> = ({ roomId, onExit }) => {
  const {
    sessionState,
    isHost,
    startSession,
    endSession,
    loading,
    dbError,
    knocks,
    approveGuest,
    rejectGuest,
    floatingEmojis,
  } = useTheater();

  const [copied, setCopied] = useState<boolean>(false);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);

  const copyInviteLink = () => {
    const inviteUrl = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-[400px] w-full flex flex-col items-center justify-center text-neutral-400 font-medium gap-4">
        <Spinner size="md" />
        <span>Loading session parameters...</span>
      </div>
    );
  }

  if (dbError) {
    return (
      <div className="w-full max-w-2xl bg-red-950/40 border border-red-500/20 rounded-2xl p-8 flex flex-col items-center text-center backdrop-blur-md shadow-2xl mt-12">
        <div className="h-16 w-16 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mb-6 text-2xl">
          ⚠️
        </div>
        <h2 className="text-2xl font-bold mb-2 text-red-400">Database Setup Required</h2>
        <p className="text-neutral-300 mb-6 text-sm leading-relaxed">
          {dbError}
        </p>
        <div className="text-left bg-black/40 border border-white/5 rounded-xl p-4 w-full font-mono text-xs text-neutral-400 select-all overflow-x-auto mb-6">
          <span className="text-neutral-500"># You can find the SQL schema file in the root of the project:</span><br/>
          <span className="text-cyan-400 font-semibold">watch_stream_together/supabase_schema.sql</span>
        </div>
        <div className="flex gap-4">
          <Button
            onClick={() => window.location.reload()}
            variant="cyan"
            className="px-6 py-2"
          >
            🔄 Retry Connection
          </Button>
          <Button
            onClick={onExit}
            variant="secondary"
            className="px-6 py-2"
          >
            ◀ Exit Theater
          </Button>
        </div>
      </div>
    );
  }

  // Active Theater Session view
  if (sessionState === 'active_session') {
    return (
      <div className="w-full">
        {/* Small context indicator bar in theater mode */}
        <div className="w-full flex justify-between items-center mb-4 px-4 bg-white/5 py-3 rounded-2xl border border-white/5">
          <div className="flex items-center gap-3">
            <span className="flex h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-xs font-bold text-neutral-200 tracking-wider">LIVE THEATER SESSION</span>
            <span className="text-xs text-neutral-500 font-mono">| Room: {roomId}</span>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={copyInviteLink}
              variant={copied ? 'emerald' : 'cyan'}
              className="px-3 py-1.5 text-xs font-semibold"
            >
              {copied ? '✓ Copied' : '🔗 Copy Invite'}
            </Button>
            {isHost && (
              <Button
                onClick={endSession}
                variant="secondary"
                className="px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20"
              >
                🛑 Close Room
              </Button>
            )}
            <Button
              onClick={onExit}
              variant="secondary"
              className="px-3 py-1.5 text-xs"
            >
              ◀ Exit
            </Button>
          </div>
        </div>

        <TheaterView />

        {/* Host Admission Alerts */}
        {isHost && knocks.length > 0 && (
          <div className="fixed top-6 right-6 flex flex-col gap-3 w-80" style={{ zIndex: 9999 }}>
            {knocks.map((knock) => (
              <div
                key={knock.socketId}
                className="bg-neutral-950/95 border border-cyan-500/30 rounded-2xl p-4 shadow-2xl backdrop-blur-md flex flex-col gap-3 animate-fade-in"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl">✊</span>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-white">Join Request</span>
                    <span className="text-xs text-cyan-400 font-mono truncate max-w-[200px]" title={knock.username}>
                      {knock.username}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-neutral-300">
                  wants to join party
                </p>
                <div className="flex gap-2 justify-end">
                  <Button
                    onClick={() => rejectGuest(knock.socketId)}
                    variant="secondary"
                    className="px-3 py-1 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20"
                  >
                    Reject
                  </Button>
                  <Button
                    onClick={() => approveGuest(knock.socketId)}
                    variant="cyan"
                    className="px-3 py-1 text-xs"
                  >
                    Accept
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Floating Emoji Canvas */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 9998 }}>
          {floatingEmojis.map((e) => {
            const charCodeSum = e.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const leftPercent = 10 + (charCodeSum % 80);
            return (
              <span
                key={e.id}
                className="absolute bottom-0 text-5xl select-none pointer-events-none animate-emoji-float"
                style={{
                  left: `${leftPercent}%`,
                }}
              >
                {e.emoji}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  // Pre-join Lobby State: styled like Google Meet Green Room
  return (
    <div className="w-full flex flex-col lg:flex-row gap-12 items-center justify-center max-w-5xl mx-auto py-8 px-4 animate-fade-in">
      {/* Left side: Simulated Local Video Preview Card */}
      <div className="w-full lg:w-3/5 bg-neutral-900 border border-white/5 rounded-3xl overflow-hidden aspect-video relative flex flex-col items-center justify-center shadow-2xl">
        {cameraOn ? (
          <div className="absolute inset-0 bg-neutral-800 flex items-center justify-center">
            <span className="text-xs text-neutral-400">[Camera Feed Mock]</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 text-center">
            <div className="w-20 h-20 rounded-full bg-neutral-800 border border-white/10 flex items-center justify-center text-3xl">
              👤
            </div>
            <p className="text-sm font-semibold text-neutral-400">Camera is off</p>
          </div>
        )}

        {/* Overlay buttons to toggle state */}
        <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
          <button
            onClick={() => setMicOn(!micOn)}
            className={`w-12 h-12 rounded-full border flex items-center justify-center text-xl transition-all cursor-pointer ${
              micOn
                ? 'bg-neutral-800 hover:bg-neutral-700 text-white border-white/10'
                : 'bg-red-500/20 hover:bg-red-500/30 text-red-300 border-red-500/30'
            }`}
            title={micOn ? 'Mute Mic' : 'Unmute Mic'}
          >
            {micOn ? '🎙️' : '🔇'}
          </button>
          <button
            onClick={() => setCameraOn(!cameraOn)}
            className={`w-12 h-12 rounded-full border flex items-center justify-center text-xl transition-all cursor-pointer ${
              cameraOn
                ? 'bg-neutral-800 hover:bg-neutral-700 text-white border-white/10'
                : 'bg-red-500/20 hover:bg-red-500/30 text-red-300 border-red-500/30'
            }`}
            title={cameraOn ? 'Turn Camera Off' : 'Turn Camera On'}
          >
            {cameraOn ? '📹' : '📷'}
          </button>
        </div>
      </div>

      {/* Right side: Action card */}
      <div className="w-full lg:w-2/5 flex flex-col gap-6 text-left">
        {sessionState === 'idle_host' && (
          <div className="space-y-4">
            <h2 className="text-3xl font-bold tracking-tight text-white">Ready to host?</h2>
            <p className="text-sm text-neutral-400 leading-relaxed">
              No one else is in this theater yet. Click Start to initialize the room session, and send the link to friends to let them join.
            </p>
            <div className="pt-2 flex flex-col gap-3">
              <Button
                onClick={startSession}
                variant="cyan"
                className="w-full py-3.5 text-sm font-bold tracking-wider"
              >
                🎬 Start Watch Party
              </Button>
              <Button
                onClick={copyInviteLink}
                variant={copied ? 'emerald' : 'secondary'}
                className="w-full py-3 text-xs"
              >
                {copied ? '✓ Link Copied!' : '🔗 Copy Invite Link'}
              </Button>
            </div>
          </div>
        )}

        {sessionState === 'idle_guest' && (
          <div className="space-y-4">
            <h2 className="text-3xl font-bold tracking-tight text-white font-sans">Lobby Standby</h2>
            <p className="text-sm text-neutral-400 leading-relaxed">
              The room session is inactive. The host is currently preparing the media stream. Please stay on this screen to automatically enter when they go live.
            </p>
            <div className="flex items-center gap-3 text-xs text-neutral-500 font-mono py-2 bg-white/5 px-4 rounded-xl border border-white/5 w-fit">
              <Spinner size="sm" />
              <span>Waiting for session start...</span>
            </div>
            <Button
              onClick={onExit}
              variant="secondary"
              className="w-full py-3.5"
            >
              ◀ Exit Lobby
            </Button>
          </div>
        )}

        {sessionState === 'knocking' && (
          <div className="space-y-4">
            <h2 className="text-3xl font-bold tracking-tight text-white">Ask to join?</h2>
            <p className="text-sm text-neutral-400 leading-relaxed">
              An active session is running in this room. You must knock to request permission to join the party.
            </p>
            <div className="flex items-center gap-3 text-xs text-neutral-500 font-mono py-2 bg-white/5 px-4 rounded-xl border border-white/5 w-fit">
              <Spinner size="sm" />
              <span>Waiting for host's admission approval...</span>
            </div>
            <Button
              onClick={onExit}
              variant="secondary"
              className="w-full py-3.5"
            >
              ◀ Cancel & Exit
            </Button>
          </div>
        )}

        {sessionState === 'rejected' && (
          <div className="space-y-4">
            <h2 className="text-3xl font-bold tracking-tight text-red-400">Entry Denied</h2>
            <p className="text-sm text-neutral-400 leading-relaxed">
              The host of this session rejected your join request. You cannot join this room.
            </p>
            <Button
              onClick={onExit}
              variant="secondary"
              className="w-full py-3.5"
            >
              ◀ Return to Home
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export const Room: React.FC = () => {
  const { session, loading } = useAuthSession();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const bypassLogin = false;

  const handleSignOut = () => {
    supabase.auth.signOut();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-neutral-400 font-medium gap-4">
        <Spinner size="md" />
        <span>Loading EnjoyTogether...</span>
      </div>
    );
  }

  const handleCreateRoom = async (movieUrl: string) => {
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const hostId = currentSession?.user?.id || 'default-host-id';

      const backendHost = window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname;
      const res = await axios.post(`http://${backendHost}:5000/api/rooms/create`, {
        hostId,
        movieUrl,
      });

      if (res.data && res.data.roomId) {
        navigate(`/room/${res.data.roomId}`);
      }
    } catch (err) {
      console.error('Failed to create dynamic watch room:', err);
    }
  };

  const userEmail = session?.user?.email || '';
  const userInitial = userEmail ? userEmail.charAt(0).toUpperCase() : 'U';

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center p-6 text-white selection:bg-cyan-500/30 font-sans select-none w-full">
      {!session && !bypassLogin ? (
        <div className="min-h-[85vh] flex items-center justify-center">
          <LoginForm />
        </div>
      ) : (
        <div className="w-full max-w-7xl flex flex-col">
          {/* Header Panel with Account dropdown menu */}
          <header className="w-full flex justify-between items-center mb-8 border-b border-white/5 pb-4 relative z-40">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
              <div className="w-10 h-10 rounded-xl bg-linear-to-tr from-blue-500 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/10">
                <span className="text-xl">🎥</span>
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-white">EnjoyTogether</h1>
                <p className="text-[10px] text-neutral-400">Google Meet style movie streaming room</p>
              </div>
            </div>

            <div className="relative">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="w-10 h-10 rounded-full bg-linear-to-br from-blue-500/20 to-cyan-600/30 border border-blue-500/30 flex items-center justify-center font-bold text-cyan-300 font-mono cursor-pointer hover:border-cyan-400 hover:scale-105 active:scale-95 transition-all"
              >
                {userInitial}
              </button>

              {profileOpen && (
                <div className="absolute right-0 mt-3 w-72 bg-neutral-900 border border-white/10 rounded-2xl p-4 shadow-2xl z-50 animate-slide-down backdrop-blur-xl">
                  <div className="flex items-center gap-3 mb-4 pb-3 border-b border-white/5">
                    <div className="w-12 h-12 rounded-full bg-linear-to-br from-blue-500/20 to-cyan-600/30 border border-blue-500/30 flex items-center justify-center font-bold text-lg text-cyan-300 font-mono">
                      {userInitial}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] font-semibold text-neutral-400 font-mono uppercase tracking-wider">Account Connected</span>
                      <span className="text-sm font-bold text-white truncate" title={userEmail}>
                        {userEmail}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setProfileOpen(false);
                      handleSignOut();
                    }}
                    className="w-full py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/40 rounded-xl text-xs font-bold transition-all cursor-pointer text-center"
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </header>

          <main className="w-full flex flex-col items-center">
            {id ? (
              <TheaterProvider roomId={id} initialStreamUrl="">
                <RoomContent roomId={id} onExit={() => navigate('/')} />
              </TheaterProvider>
            ) : (
              <UploadDashboard onUploadSuccess={handleCreateRoom} />
            )}
          </main>
        </div>
      )}
    </div>
  );
};

export default Room;
