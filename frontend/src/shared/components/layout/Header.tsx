import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Video, LayoutGrid, Globe, MessageCircle, Camera, User } from 'lucide-react';
import { supabase } from '@/shared/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { Avatar } from '../ui/Avatar';

interface HeaderProps {
  session: Session | null;
}

export const Header: React.FC<HeaderProps> = ({ session }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const isLandingPage = location.pathname === '/';

  const handleSignOut = () => {
    supabase.auth.signOut();
  };

  const username = session?.user?.user_metadata?.username || '';
  const userEmail = session?.user?.email || '';
  const avatarUrl = session?.user?.user_metadata?.avatar_url || null;
  const displayName = username || userEmail || 'User';
  const userInitial = displayName.charAt(0).toUpperCase();

  return (
    <header className="w-full flex justify-between items-center mb-8 border-b border-white/5 pb-4 relative z-45 px-6 pt-6">
      <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
        <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-lg shadow-brand/10 text-white">
          <Video className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">EnjoyTogether</h1>
        </div>
      </div>

      {isLandingPage && (
        <div className="hidden md:flex items-center gap-2 bg-white rounded-full p-2 shadow-xl absolute left-1/2 -translate-x-1/2">
          <button 
            onClick={() => navigate('/dashboard')}
            className="w-12 h-10 rounded-[14px] bg-[#1a1a1a] flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-transform"
          >
            <LayoutGrid className="w-5 h-5" />
          </button>
          
          <div className="flex items-center gap-2 px-3">
            <a href="https://instagram.com" target="_blank" rel="noreferrer" className="w-8 h-8 flex items-center justify-center text-black hover:scale-110 transition-transform" title="Instagram">
              <Camera className="w-4 h-4" />
            </a>
            <a href="https://twitter.com" target="_blank" rel="noreferrer" className="w-8 h-8 flex items-center justify-center text-black hover:scale-110 transition-transform" title="Twitter">
              <MessageCircle className="w-4 h-4" />
            </a>
            <a href="https://github.com/Gyanshu-tiwari/EnjoyTogether" target="_blank" rel="noreferrer" className="w-8 h-8 flex items-center justify-center text-black hover:scale-110 transition-transform" title="Github">
              <Globe className="w-4 h-4" />
            </a>
          </div>

          <div className="w-[1px] h-6 bg-black/10 mx-1" />

          <button 
            onClick={() => session ? setProfileOpen(!profileOpen) : navigate('/login')}
            className="w-10 h-10 flex items-center justify-center text-black hover:scale-110 transition-transform relative"
          >
            {session && avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="w-7 h-7 rounded-full object-cover" />
            ) : (
              <User className="w-5 h-5" />
            )}
          </button>
        </div>
      )}

      <div className="flex items-center gap-4 relative">
        {session ? (
          <div className="relative">
            <button
              onClick={() => setProfileOpen(!profileOpen)}
              className="px-6 py-2.5 bg-white text-black text-sm font-bold rounded-xl hover:bg-neutral-200 transition-colors cursor-pointer shadow-lg shadow-white/10"
            >
              Dashboard
            </button>

            {profileOpen && (
              <div className="absolute right-0 mt-3 w-72 bg-neutral-900 border border-neutral-800 rounded-2xl p-4 shadow-2xl z-50 animate-slide-down">
                <div className="flex items-center gap-3 mb-4 pb-3 border-b border-neutral-800">
                  <Avatar src={avatarUrl} fallback={userInitial} size="lg" className="border-neutral-800" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] font-semibold text-neutral-500 font-mono uppercase tracking-wider">
                      {username ? `@${username}` : 'Account Connected'}
                    </span>
                    <span className="text-sm font-bold text-white truncate" title={userEmail}>
                      {userEmail}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setProfileOpen(false);
                    navigate('/profile');
                  }}
                  className="w-full mb-2 py-2.5 bg-neutral-950 hover:bg-neutral-850 text-neutral-300 border border-neutral-800 rounded-xl text-xs font-bold transition-all cursor-pointer text-center"
                >
                  Profile Settings
                </button>
                <button
                  onClick={() => {
                    setProfileOpen(false);
                    handleSignOut();
                  }}
                  className="w-full py-2.5 bg-red-550/10 hover:bg-red-550/20 text-red-400 border border-red-550/25 rounded-xl text-xs font-bold transition-all cursor-pointer text-center"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <button 
              onClick={() => navigate('/login')} 
              className="px-6 py-2.5 bg-white text-black text-sm font-bold rounded-xl hover:bg-neutral-200 transition-colors cursor-pointer shadow-lg shadow-white/10"
            >
              Join to Waitlist
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
