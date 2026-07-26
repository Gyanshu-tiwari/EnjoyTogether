import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video } from 'lucide-react';
import { supabase } from '@/shared/lib/supabase';
import type { Session } from '@supabase/supabase-js';

interface HeaderProps {
  session: Session | null;
}

export const Header: React.FC<HeaderProps> = ({ session }) => {
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);

  const handleSignOut = () => {
    supabase.auth.signOut();
  };

  const userEmail = session?.user?.email || '';
  const userInitial = userEmail ? userEmail.charAt(0).toUpperCase() : 'U';

  return (
    <header className="w-full flex justify-between items-center mb-8 border-b border-white/5 pb-4 relative z-45">
      <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
        <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-lg shadow-brand/10 text-white">
          <Video className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-white">EnjoyTogether</h1>
          <p className="text-[10px] text-text-secondary">Google Meet style movie streaming room</p>
        </div>
      </div>

      {session && (
        <div className="relative">
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="w-10 h-10 rounded-full bg-brand-muted border border-brand-border flex items-center justify-center font-bold text-indigo-400 font-mono cursor-pointer hover:border-indigo-400 hover:scale-105 active:scale-95 transition-all"
          >
            {userInitial}
          </button>

          {profileOpen && (
            <div className="absolute right-0 mt-3 w-72 bg-bg-card border border-white/5 rounded-2xl p-4 shadow-2xl z-50 animate-slide-down backdrop-blur-xl">
              <div className="flex items-center gap-3 mb-4 pb-3 border-b border-white/5">
                <div className="w-12 h-12 rounded-full bg-brand-muted border border-brand-border flex items-center justify-center font-bold text-lg text-indigo-400 font-mono">
                  {userInitial}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] font-semibold text-text-secondary font-mono uppercase tracking-wider">Account Connected</span>
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
      )}
    </header>
  );
};
