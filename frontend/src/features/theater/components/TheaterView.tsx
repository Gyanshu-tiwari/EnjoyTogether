import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheater } from '../context/useTheater';
import { SyncVideoPlayer } from './SyncVideoPlayer';
import { VideoCallOverlay, useLiveKitRoom } from '@/features/videocall';

export const TheaterView: React.FC = () => {
  const navigate = useNavigate();
  const [emojiPopoverOpen, setEmojiPopoverOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const {
    roomId,
    comments,
    inputMessage,
    setInputMessage,
    sendMessage,
    activeTab,
    setActiveTab,
    sendEmoji,
    sessionState,
    isHost,
    endSession,
  } = useTheater();

  // Connect to LiveKit Room at the top level
  const livekit = useLiveKitRoom(roomId, sessionState);

  const handleLeaveOrClose = async () => {
    if (isHost) {
      if (confirm('Are you sure you want to end this watch party for everyone?')) {
        await endSession();
      }
    } else {
      navigate('/');
    }
  };

  return (
    <div className="w-full flex flex-col min-h-[75vh] justify-between relative bg-neutral-950/40 rounded-3xl border border-white/5 p-4 animate-fade-in font-sans">
      
      {/* Main body area: Video + Sidebar */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 items-stretch mb-6 min-h-0">
        
        {/* Main Synced Video Player */}
        <div className={`flex-1 bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/5 relative flex items-center justify-center transition-all duration-300`}>
          <SyncVideoPlayer />
        </div>

        {/* Slide-out / Collapsible Sidebar */}
        {sidebarOpen && (
          <aside className="w-full lg:w-[320px] bg-neutral-900/60 border border-white/10 rounded-2xl p-4 flex flex-col justify-between h-[450px] lg:h-auto backdrop-blur-xl animate-slide-left">
            {/* Header of Sidebar */}
            <div className="flex justify-between items-center border-b border-white/5 pb-2.5 mb-3">
              <span className="text-xs font-bold text-neutral-300 tracking-wider uppercase">
                {activeTab === 'chat' ? '💬 Live Chat' : '👥 Voice Grid'}
              </span>
              <button 
                onClick={() => setSidebarOpen(false)}
                className="text-neutral-500 hover:text-neutral-300 text-xs px-2 py-0.5 rounded cursor-pointer"
                title="Hide Panel"
              >
                ✕
              </button>
            </div>

            {/* Panel Content Scroll Container */}
            <div className="flex-1 overflow-y-auto min-h-0 mb-3">
              {activeTab === 'chat' ? (
                <div className="flex flex-col h-full justify-between">
                  <div className="space-y-2.5 max-h-[300px] lg:max-h-[350px] overflow-y-auto pr-1 flex-1 flex flex-col justify-start">
                    {comments.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-neutral-500 font-mono text-xs select-none">
                        <span className="text-2xl mb-2">💬</span>
                        <p>chat with you friends appear here</p>
                      </div>
                    ) : (
                      comments.map((msg, index) => (
                        <div key={index} className="bg-white/5 border border-white/5 p-2.5 rounded-xl text-xs backdrop-blur-md animate-slide-up">
                          <b className={msg.user === 'You' ? 'text-cyan-400 font-mono' : 'text-neutral-350'}>
                            {msg.user}:{' '}
                          </b>
                          <span className="text-neutral-200">{msg.text}</span>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Input Block */}
                  <div className="w-full mt-3 flex gap-2 relative">
                    <input
                      type="text"
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                      placeholder="Type message..."
                      className="w-full px-3 py-2 bg-neutral-950 border border-white/15 rounded-xl text-xs text-neutral-200 focus:outline-none focus:border-cyan-500/50 transition-all placeholder-neutral-500"
                    />
                    <button
                      onClick={sendMessage}
                      className="px-3 bg-linear-to-r from-blue-500 to-cyan-500 text-xs font-bold rounded-xl active:scale-95 transition-all cursor-pointer text-white"
                    >
                      Send
                    </button>
                  </div>
                </div>
              ) : (
                <VideoCallOverlay
                  participants={livekit.participants}
                  loading={livekit.loading}
                  error={livekit.error}
                />
              )}
            </div>

            {/* Sidebar toggle buttons dock */}
            <div className="flex justify-around items-center border-t border-white/5 pt-2.5 mt-auto">
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex items-center gap-1.5 text-[10px] font-bold tracking-wider transition-all cursor-pointer px-3 py-1 rounded-xl ${
                  activeTab === 'chat' ? 'text-cyan-400 bg-cyan-500/10' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                <span>💬</span>
                <span>CHAT</span>
              </button>
              <button
                onClick={() => setActiveTab('call')}
                className={`flex items-center gap-1.5 text-[10px] font-bold tracking-wider transition-all cursor-pointer px-3 py-1 rounded-xl ${
                  activeTab === 'call' ? 'text-cyan-400 bg-cyan-500/10' : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                <span>👥</span>
                <span>VOICE</span>
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* Google Meet inspired Bottom Bar Control Dock */}
      <footer className="w-full bg-neutral-900 border border-white/10 rounded-2xl px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4 relative z-30">
        
        {/* Left Side: Session / Room Name Details */}
        <div className="flex flex-col text-left">
          <span className="text-sm font-black text-white tracking-tight truncate max-w-[200px]">
            EnjoyTogether Room
          </span>
          <span className="text-[10px] text-neutral-400 font-mono">
            {roomId}
          </span>
        </div>

        {/* Middle Section: Circle controls row */}
        <div className="flex items-center gap-3 relative">
          
          {/* Microphone Action */}
          <button
            onClick={livekit.toggleMic}
            disabled={livekit.loading || !!livekit.error}
            className={`w-11 h-11 rounded-full border flex items-center justify-center text-lg transition-all cursor-pointer shadow-lg active:scale-90 ${
              livekit.isMicEnabled
                ? 'bg-neutral-800 hover:bg-neutral-750 text-neutral-200 border-white/10'
                : 'bg-red-500/20 hover:bg-red-500/30 text-red-300 border-red-500/30 shadow-red-950/25'
            }`}
            title={livekit.isMicEnabled ? 'Mute Mic' : 'Unmute Mic'}
          >
            {livekit.isMicEnabled ? '🎙️' : '🔇'}
          </button>

          {/* Camera Action */}
          <button
            onClick={livekit.toggleCamera}
            disabled={livekit.loading || !!livekit.error}
            className={`w-11 h-11 rounded-full border flex items-center justify-center text-lg transition-all cursor-pointer shadow-lg active:scale-90 ${
              livekit.isCameraEnabled
                ? 'bg-neutral-800 hover:bg-neutral-750 text-neutral-200 border-white/10'
                : 'bg-red-500/20 hover:bg-red-500/30 text-red-300 border-red-500/30 shadow-red-950/25'
            }`}
            title={livekit.isCameraEnabled ? 'Turn Camera Off' : 'Turn Camera On'}
          >
            {livekit.isCameraEnabled ? '📹' : '📷'}
          </button>

          {/* Emoji Popover trigger */}
          <div className="relative">
            <button
              onClick={() => setEmojiPopoverOpen(!emojiPopoverOpen)}
              className="w-11 h-11 rounded-full bg-neutral-800 hover:bg-neutral-750 border border-white/10 flex items-center justify-center text-lg transition-all cursor-pointer shadow-lg active:scale-90 text-neutral-200"
              title="Send Reaction"
            >
              😀
            </button>

            {emojiPopoverOpen && (
              <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-neutral-900/95 border border-white/10 p-3 rounded-2xl shadow-2xl flex gap-2.5 z-50 animate-slide-up backdrop-blur-md">
                {['❤️', '😂', '😮', '😢', '👏', '🔥', '🎉', '🚀'].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      sendEmoji(emoji);
                      setEmojiPopoverOpen(false);
                    }}
                    className="text-xl hover:scale-135 active:scale-90 transition-all cursor-pointer"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Red leave / close meeting button */}
          <button
            onClick={handleLeaveOrClose}
            className="px-6 py-2.5 rounded-full bg-red-650 hover:bg-red-550 border border-red-500/30 text-white font-bold text-xs transition-all cursor-pointer active:scale-95 flex items-center gap-2 shadow-lg shadow-red-950/30 uppercase tracking-widest"
            title={isHost ? 'End watch party' : 'Leave watch party'}
          >
            <span>📞</span>
            <span>{isHost ? 'End Call' : 'Leave'}</span>
          </button>
        </div>

        {/* Right Section: Utility actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setSidebarOpen(!sidebarOpen);
            }}
            className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm border transition-all cursor-pointer ${
              sidebarOpen 
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' 
                : 'bg-neutral-800 border-white/10 hover:bg-neutral-750 text-neutral-400'
            }`}
            title="Toggle Sidebar Panel"
          >
            👥
          </button>
        </div>
      </footer>
    </div>
  );
};

export default TheaterView;
