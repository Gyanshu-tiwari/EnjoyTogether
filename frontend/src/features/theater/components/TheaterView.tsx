import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheater } from '../context/useTheater';
import { SyncVideoPlayer } from './SyncVideoPlayer';
import { VideoCallOverlay, useLiveKitRoom } from '@/features/videocall';
import { ActiveUsersModal } from './ActiveUsersModal';
import { 
  Hand, MessageSquare, Users, X, Mic, MicOff, Video, VideoOff, 
  Smile, Copy, UserPlus, MonitorUp, Phone
} from 'lucide-react';

export const TheaterView: React.FC = () => {
  const navigate = useNavigate();
  const [emojiPopoverOpen, setEmojiPopoverOpen] = useState(false);
  const [participantsModalOpen, setParticipantsModalOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [elapsedTime, setElapsedTime] = useState('00:00');

  const {
    roomId,
    comments,
    inputMessage,
    setInputMessage,
    sendMessage,
    sendEmoji,
    sessionState,
    isHost,
    endSession,
    setUserRole,
    knocks,
    approveGuest,
    rejectGuest,
    currentUserId,
  } = useTheater();

  // Connect to LiveKit Room at the top level
  const livekit = useLiveKitRoom(roomId, sessionState);

  // Sync RBAC role from LiveKit token into shared theater context
  useEffect(() => {
    if (livekit.userRole) setUserRole(livekit.userRole);
  }, [livekit.userRole, setUserRole]);

  // Simple local elapsed timer
  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - start) / 1000);
      const m = String(Math.floor(diff / 60)).padStart(2, '0');
      const s = String(diff % 60).padStart(2, '0');
      setElapsedTime(`${m}:${s}`);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleLeaveOrClose = async () => {
    if (isHost) {
      if (confirm('Are you sure you want to end this watch party for everyone?')) {
        await endSession();
      }
    } else {
      navigate('/');
    }
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    alert('Room ID copied to clipboard!');
  };

  return (
    <div className="w-full h-full min-h-screen bg-[#0a0a0a] flex flex-col p-4 md:p-6 overflow-hidden relative font-sans text-white z-50">
      
      {/* Top Bar */}
      <header className="w-full flex items-center justify-between mb-4 px-2">
        {/* Left: Room ID */}
        <div className="flex items-center gap-2 text-neutral-300 group cursor-pointer" onClick={copyRoomId}>
          <span className="text-sm font-medium tracking-wide">{roomId}</span>
          <Copy className="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity" />
        </div>
        
        {/* Center: Timer */}
        <div className="text-neutral-300 text-sm font-mono tracking-widest absolute left-1/2 -translate-x-1/2">
          {elapsedTime}
        </div>
        
        {/* Right: Invite Button */}
        <button className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-full text-sm font-medium transition-all cursor-pointer">
          <UserPlus className="w-4 h-4" />
          <span>Invite</span>
        </button>
      </header>

      {/* Main Body Area */}
      <div className="flex-1 flex gap-4 min-h-0 relative w-full overflow-hidden pb-20">
        
        {/* Video & Participants Group */}
        <div className="flex-1 flex flex-col lg:flex-row gap-4 min-w-0 transition-all duration-300">
          
          {/* Main Synced Video Player */}
          <div className="flex-1 bg-black rounded-2xl overflow-hidden shadow-2xl relative flex items-center justify-center border border-white/5">
            <SyncVideoPlayer />
            
            {/* Host Join Requests UI overlay */}
            {isHost && knocks.length > 0 && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-full max-w-sm pointer-events-auto px-4">
                {knocks.map((knock) => (
                  <div key={knock.socketId} className="bg-[#18181b]/90 border border-white/10 shadow-2xl rounded-2xl p-4 flex items-center gap-4 animate-slide-down backdrop-blur-md">
                    <div className="w-10 h-10 shrink-0 rounded-full bg-brand-muted border border-brand-border flex items-center justify-center text-indigo-400">
                      <Hand className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-bold text-white truncate">{knock.username}</span>
                      <span className="text-[10px] uppercase tracking-wider text-indigo-400 font-bold">wants to join</span>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => rejectGuest(knock.socketId)} className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs font-bold hover:bg-red-500/20 border border-red-500/20 cursor-pointer transition-all active:scale-95">Deny</button>
                      <button onClick={() => approveGuest(knock.socketId)} className="px-3 py-1.5 rounded-lg bg-brand-muted text-indigo-400 text-xs font-bold hover:bg-brand/20 border border-brand-border cursor-pointer transition-all active:scale-95">Admit</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Voice Grid / Participants Column */}
          <div className="w-full lg:w-[280px] shrink-0 flex flex-col gap-3 overflow-y-auto pr-1 hidden md:flex">
            <VideoCallOverlay
              participants={livekit.participants}
              loading={livekit.loading}
              error={livekit.error}
            />
          </div>
        </div>

        {/* Slide-out Chat Panel */}
        {isChatOpen && (
          <aside className="w-full md:w-[320px] shrink-0 bg-[#121212] border border-white/5 rounded-2xl flex flex-col transition-all duration-300 animate-slide-left shadow-2xl overflow-hidden relative z-40">
            {/* Chat Header */}
            <div className="flex justify-between items-center px-4 py-3 border-b border-white/5 bg-[#18181b]/50">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-white" />
                <span className="text-sm font-medium">Chat</span>
                <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
                  {livekit.participants.length} online
                </span>
              </div>
              <button 
                onClick={() => setIsChatOpen(false)}
                className="text-neutral-400 hover:text-white p-1 rounded cursor-pointer transition-colors"
                title="Close Chat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
              {comments.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center text-neutral-500 font-mono text-xs select-none">
                  <MessageSquare className="w-8 h-8 opacity-20 mb-2" />
                  <p>No messages yet</p>
                </div>
              ) : (
                comments.map((msg, index) => {
                  const isMe = msg.userId === currentUserId || msg.user === 'You';
                  return (
                    <div key={index} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'} animate-slide-up`}>
                      {!isMe && (
                        <div className="flex gap-2 max-w-[85%]">
                          <div className="w-7 h-7 rounded-full bg-[#27272a] border border-white/5 flex items-center justify-center text-xs font-bold text-white shrink-0 mt-4">
                            {msg.user.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex flex-col items-start">
                            <span className="text-[10px] text-neutral-400 ml-1 mb-1 font-medium">{msg.user}</span>
                            <div className="bg-[#27272a] px-3 py-2 rounded-2xl rounded-tl-sm text-sm text-neutral-200">
                              {msg.text}
                            </div>
                          </div>
                        </div>
                      )}
                      {isMe && (
                        <div className="flex flex-col items-end max-w-[85%]">
                          <span className="text-[10px] text-brand ml-1 mb-1 font-medium">You</span>
                          <div className="bg-[#1e1b4b] border border-brand/20 px-3 py-2 rounded-2xl rounded-tr-sm text-sm text-brand-100">
                            {msg.text}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Chat Input */}
            <div className="p-3 border-t border-white/5 bg-[#18181b]/50">
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Type a message..."
                  className="w-full pl-4 pr-12 py-2.5 bg-[#27272a] border border-transparent focus:border-white/10 rounded-full text-sm text-white focus:outline-none transition-all placeholder-neutral-500"
                />
                <button
                  onClick={sendMessage}
                  className="absolute right-1.5 w-8 h-8 bg-brand hover:bg-brand-hover text-white rounded-full flex items-center justify-center transition-all cursor-pointer disabled:opacity-50"
                  disabled={!inputMessage.trim()}
                >
                  <MessageSquare className="w-4 h-4" />
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Floating Bottom Dock (Google Meet / Zoom style) */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-[#18181b]/80 backdrop-blur-xl border border-white/10 px-4 py-2.5 rounded-full shadow-2xl z-40 transition-all">
        
        {/* Mic */}
        <button
          onClick={livekit.toggleMic}
          disabled={livekit.loading || !!livekit.error}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all cursor-pointer ${
            livekit.isMicEnabled ? 'hover:bg-white/10 text-white' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
          }`}
          title="Toggle Microphone"
        >
          {livekit.isMicEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>

        {/* Video */}
        <button
          onClick={livekit.toggleCamera}
          disabled={livekit.loading || !!livekit.error}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all cursor-pointer ${
            livekit.isCameraEnabled ? 'hover:bg-white/10 text-white' : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
          }`}
          title="Toggle Camera"
        >
          {livekit.isCameraEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
        </button>

        {/* Screen Share (UI Placeholder) */}
        <button className="w-10 h-10 rounded-full hover:bg-white/10 text-white flex items-center justify-center transition-all cursor-pointer">
          <MonitorUp className="w-4 h-4" />
        </button>
        
        {/* Hand Raise (UI Placeholder) */}
        <button className="w-10 h-10 rounded-full hover:bg-white/10 text-white flex items-center justify-center transition-all cursor-pointer">
          <Hand className="w-4 h-4" />
        </button>

        {/* Emoji / Reactions */}
        <div className="relative">
          <button
            onClick={() => setEmojiPopoverOpen(!emojiPopoverOpen)}
            className="w-10 h-10 rounded-full hover:bg-white/10 text-white flex items-center justify-center transition-all cursor-pointer"
          >
            <Smile className="w-4 h-4" />
          </button>
          
          {emojiPopoverOpen && (
            <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-[#18181b] border border-white/10 p-2.5 rounded-2xl shadow-2xl flex gap-2 z-50 animate-slide-up backdrop-blur-xl">
              {['❤️', '😂', '😮', '😢', '👏', '🔥'].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    sendEmoji(emoji);
                    setEmojiPopoverOpen(false);
                  }}
                  className="text-lg hover:scale-125 transition-all cursor-pointer"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Participants */}
        <div className="relative">
          <button
            onClick={() => {
              setParticipantsModalOpen(!participantsModalOpen);
              setEmojiPopoverOpen(false);
            }}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              participantsModalOpen ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-white'
            }`}
          >
            <Users className="w-4 h-4" />
          </button>
          <ActiveUsersModal isOpen={participantsModalOpen} onClose={() => setParticipantsModalOpen(false)} />
        </div>

        {/* Leave */}
        <button
          onClick={handleLeaveOrClose}
          className="ml-2 w-16 h-10 rounded-full bg-red-600 hover:bg-red-550 flex items-center justify-center transition-all cursor-pointer shadow-lg shadow-red-900/20 active:scale-95 text-white"
          title="Leave Room"
        >
          <Phone className="w-4 h-4" style={{ transform: 'rotate(135deg)' }} />
        </button>
      </div>

      {/* Floating Chat Toggle (Bottom Right) */}
      {!isChatOpen && (
        <button
          onClick={() => setIsChatOpen(true)}
          className="absolute bottom-6 right-6 h-12 px-5 bg-[#18181b]/80 backdrop-blur-xl border border-white/10 hover:bg-white/10 rounded-full flex items-center gap-2 text-white shadow-2xl transition-all cursor-pointer z-40 animate-fade-in"
        >
          <MessageSquare className="w-4 h-4" />
          <span className="text-sm font-medium">Chat</span>
        </button>
      )}

    </div>
  );
};

export default TheaterView;
