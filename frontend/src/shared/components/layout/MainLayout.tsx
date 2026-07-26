import React from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { useAuthSession } from '@/features/auth';
import { Spinner } from '@/shared/components/feedback/Spinner';

interface MainLayoutProps {
  children?: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const { session, loading } = useAuthSession();
  const content = children || <Outlet />;

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-neutral-400 font-medium gap-4 w-full">
        <Spinner size="md" />
        <span>Loading EnjoyTogether...</span>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-6 text-white selection:bg-cyan-500/30 font-sans select-none w-full relative overflow-hidden">
        {content}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center p-6 text-white selection:bg-cyan-500/30 font-sans select-none w-full relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/5 rounded-full blur-[80px] pointer-events-none" />
      <div className="w-full max-w-7xl flex flex-col relative z-10">
        <Header session={session} />
        <main className="w-full flex flex-col items-center">
          {content}
        </main>
      </div>
    </div>
  );
};
