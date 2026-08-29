import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { useAuthSession } from '@/features/auth';
import { DashboardSkeleton, TheaterSkeleton } from '@/shared/components/feedback/Skeletons';

interface MainLayoutProps {
  children?: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const { session, loading } = useAuthSession();
  const location = useLocation();
  const content = children || <Outlet />;

  const isTheaterPage = location.pathname.includes('/room/');
  const isLandingPage = location.pathname === '/';
  const paddingClass = isLandingPage ? '' : 'p-6';

  if (loading) {
    return (
      <div className={`min-h-screen bg-bg-primary flex flex-col items-center text-white selection:bg-brand/25 font-sans select-none w-full relative overflow-hidden ${paddingClass}`}>
        <div className="absolute top-0 right-0 w-96 h-96 bg-brand/3 rounded-full blur-[80px] pointer-events-none" />
        <div className="w-full max-w-7xl flex flex-col relative z-10">
          {!isTheaterPage && (
            <header className="w-full flex justify-between items-center mb-8 border-b border-white/5 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-bg-card border border-white/5 animate-shimmer" />
                <div className="flex flex-col gap-1.5">
                  <div className="h-4 w-28 rounded-md bg-bg-card border border-white/5 animate-shimmer" />
                  <div className="h-3 w-48 rounded-md bg-bg-card border border-white/5 animate-shimmer" />
                </div>
              </div>
              <div className="w-10 h-10 rounded-full bg-bg-card border border-white/5 animate-shimmer" />
            </header>
          )}
          <main className="w-full flex flex-col items-center">
            {isTheaterPage ? <TheaterSkeleton /> : <DashboardSkeleton />}
          </main>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className={`min-h-screen bg-bg-primary flex flex-col items-center text-white selection:bg-brand/25 font-sans select-none w-full relative overflow-hidden ${paddingClass}`}>
        <div className="absolute top-0 right-0 w-96 h-96 bg-brand/3 rounded-full blur-[80px] pointer-events-none" />
        <div className="w-full max-w-7xl flex flex-col relative z-10">
          {!isTheaterPage && <Header session={session} />}
          <main className="w-full flex flex-col items-center">
            {content}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-bg-primary flex flex-col items-center text-white selection:bg-brand/25 font-sans select-none w-full relative overflow-hidden ${paddingClass}`}>
      {/* Background decorations */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-brand/3 rounded-full blur-[80px] pointer-events-none" />
      <div className="w-full max-w-7xl flex flex-col relative z-10">
        {!isTheaterPage && <Header session={session} />}
        <main className="w-full flex flex-col items-center">
          {content}
        </main>
      </div>
    </div>
  );
};
