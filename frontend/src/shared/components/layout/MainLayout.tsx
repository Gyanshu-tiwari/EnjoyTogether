import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { useAuthSession } from '@/features/auth';
import { DashboardSkeleton, TheaterSkeleton } from '@/shared/components/feedback/Skeletons';
import { GlobalLoader } from '@/shared/components/feedback/GlobalLoader';
import { AnimatePresence } from 'framer-motion';

interface MainLayoutProps {
  children?: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const { session, loading: authLoading } = useAuthSession();
  const location = useLocation();
  const content = children || <Outlet />;

  const isTheaterPage = location.pathname.includes('/room/');
  const isAuthPage = location.pathname.includes('/login') || location.pathname.includes('/signup') || location.pathname.includes('/reset-password');
  const isLandingPage = location.pathname === '/';
  
  const [showSplash, setShowSplash] = useState(isLandingPage);

  useEffect(() => {
    if (isLandingPage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowSplash(true);
      const timer = setTimeout(() => setShowSplash(false), 2000);
      return () => clearTimeout(timer);
    } else {
      setShowSplash(false);
    }
  }, [isLandingPage]);

  // Loader stays mounted as long as auth is loading or the splash is active
  const isLoading = authLoading || showSplash;
  const shouldShowHeader = !isTheaterPage && !isAuthPage;
  
  const paddingClass = isLandingPage ? '' : 'p-6';
  const maxWidthClass = isLandingPage ? 'w-full' : 'w-full max-w-7xl';

  return (
    <>
      <AnimatePresence>
        {isLoading && isLandingPage && <GlobalLoader />}
      </AnimatePresence>

      <div className={`min-h-screen bg-bg-primary flex flex-col items-center text-white selection:bg-brand/25 font-sans select-none w-full relative overflow-hidden ${paddingClass}`}>
        {/* Background decorations */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-brand/3 rounded-full blur-[80px] pointer-events-none" />
        
        <div className={`${maxWidthClass} flex flex-col relative z-10 flex-1`}>
          {shouldShowHeader && <Header session={session} />}
          
          <main className="w-full flex-1 flex flex-col items-center">
            {/* If we are loading a non-landing page, show the skeleton */}
            {isLoading && !isLandingPage ? (
              isTheaterPage ? <TheaterSkeleton /> : <DashboardSkeleton />
            ) : (
              content
            )}
          </main>
        </div>
      </div>
    </>
  );
};
