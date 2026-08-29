import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Video, ChevronRight } from 'lucide-react';
import { supabase } from '@/shared/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';

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

  const headerClass = isLandingPage
    ? 'fixed top-0 left-0 right-0 w-full flex justify-between items-center z-50 px-6 pt-6 pb-4 border-b border-white/5 backdrop-blur-md bg-[#0a0a0a]/80'
    : 'w-full flex justify-between items-center mb-8 border-b border-white/5 pb-4 relative z-45';

  return (
    <header className={headerClass}>
      <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
        <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-lg shadow-brand/10 text-white">
          <Video className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-white">EnjoyTogether</h1>
          {!isLandingPage && <p className="text-[10px] text-text-secondary hidden sm:block">Google Meet style movie streaming room</p>}
        </div>
      </div>

      {isLandingPage && (
        <nav className="hidden md:flex items-center gap-6 absolute left-1/2 -translate-x-1/2 mt-1">
          <a href="#how-it-works" className="text-sm font-semibold text-neutral-400 hover:text-white transition-colors">How it works</a>
          <a href="#why-enjoytogether" className="text-sm font-semibold text-neutral-400 hover:text-white transition-colors">Why us</a>
          <a href="#features" className="text-sm font-semibold text-neutral-400 hover:text-white transition-colors">Features</a>
          <a href="#testimonial" className="text-sm font-semibold text-neutral-400 hover:text-white transition-colors">Testimonials</a>
          <a href="#faq" className="text-sm font-semibold text-neutral-400 hover:text-white transition-colors">FAQ</a>
        </nav>
      )}

      <div className="flex items-center gap-4 relative">
      {session ? (
        <div className="relative">
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="rounded-full overflow-hidden hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer"
          >
            <Avatar src={avatarUrl} fallback={userInitial} size="md" className="border-neutral-800" />
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
            className="hidden sm:flex items-center justify-center px-4 py-2 text-sm font-bold text-white hover:text-brand-hover transition-colors cursor-pointer"
          >
            Log in
          </button>
          <Button 
            onClick={() => navigate('/login?mode=signup')} 
            variant="brand" 
            className="px-5 py-2 text-sm"
          >
            Sign up <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
      </div>
    </header>
  );
};
