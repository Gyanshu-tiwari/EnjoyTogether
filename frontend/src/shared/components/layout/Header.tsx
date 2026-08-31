import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Video, ChevronRight } from 'lucide-react';
import { supabase } from '@/shared/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { motion } from 'framer-motion';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';

const RevealLink = ({ href, children }: { href: string; children: string }) => {
  return (
    <motion.a
      href={href}
      initial="initial"
      whileHover="hover"
      className="relative overflow-hidden flex flex-col items-center justify-center text-xs font-normal text-neutral-400 transition-colors h-5"
    >
      <motion.span
        variants={{
          initial: { y: 0 },
          hover: { y: '-100%' },
        }}
        transition={{ duration: 0.3, ease: [0.33, 1, 0.68, 1] }}
        className="block whitespace-nowrap"
      >
        {children}
      </motion.span>
      <motion.span
        variants={{
          initial: { y: '100%' },
          hover: { y: 0 },
        }}
        transition={{ duration: 0.3, ease: [0.33, 1, 0.68, 1] }}
        className="whitespace-nowrap text-white absolute inset-0 flex items-center justify-center"
        aria-hidden
      >
        {children}
      </motion.span>
    </motion.a>
  );
};

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
        <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center shadow-lg shadow-brand/10 text-white">
          <Video className="w-4 h-4" />
        </div>
        <div>
          <h1 className="text-lg font-normal tracking-tight text-white">EnjoyTogether</h1>
        </div>
      </div>

      {isLandingPage && (
        <nav className="hidden md:flex items-center gap-6 absolute left-1/2 -translate-x-1/2 mt-1">
          <RevealLink href="#how-it-works">How it works</RevealLink>
          <RevealLink href="#why-enjoytogether">Why us</RevealLink>
          <RevealLink href="#features">Features</RevealLink>
          <RevealLink href="#testimonial">Testimonials</RevealLink>
          <RevealLink href="#faq">FAQ</RevealLink>
        </nav>
      )}

      {location.pathname === '/dashboard' && (
        <nav className="hidden md:flex items-center gap-8 absolute left-1/2 -translate-x-1/2 mt-1">
          <button
            onClick={() => navigate('/dashboard')}
            className={`flex items-center gap-2 pb-2 border-b-2 transition-colors ${
              !location.search.includes('tab=friends')
                ? 'border-brand text-brand'
                : 'border-transparent text-neutral-400 hover:text-white'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 12v9"></path><path d="m16 16-4-4-4 4"></path><path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.243"></path></svg>
            <span className="text-sm font-semibold">Upload</span>
          </button>
          <button
            onClick={() => navigate('/dashboard?tab=friends')}
            className={`flex items-center gap-2 pb-2 border-b-2 transition-colors ${
              location.search.includes('tab=friends')
                ? 'border-brand text-brand'
                : 'border-transparent text-neutral-400 hover:text-white'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            <span className="text-sm font-semibold">Friends</span>
          </button>
        </nav>
      )}

      <div className="flex items-center gap-4 relative">
      {session ? (
        <div className="relative">
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="rounded-full overflow-hidden hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer"
          >
            <Avatar src={avatarUrl} fallback={userInitial} size="sm" className="border-neutral-800" />
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
            className="hidden sm:flex items-center justify-center px-4 py-2 text-xs text-white hover:text-brand-hover transition-colors cursor-pointer"
          >
            Log in
          </button>
          <Button 
            onClick={() => navigate('/login?mode=signup')} 
            variant="brand" 
            className="px-5 py-2 text-sm"
          >
            <span className='text-xs font-normal'>Sign up</span><ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
      </div>
    </header>
  );
};
