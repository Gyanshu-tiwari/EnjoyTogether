import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/shared/components/ui/Button';
import { useAuthSession } from '@/features/auth';
import { Spinner } from '@/shared/components/feedback/Spinner';

export const Verified: React.FC = () => {
  const navigate = useNavigate();
  const { session, loading } = useAuthSession();
  const [isMobile] = useState(() => 
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-neutral-400 font-medium gap-4 w-full">
        <Spinner size="md" />
        <span>Verifying your session...</span>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-6 text-white selection:bg-red-500/30 font-sans select-none w-full relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-red-500/5 rounded-full blur-[100px] pointer-events-none" />
        <div className="w-full max-w-md p-10 rounded-3xl bg-neutral-900/80 border border-white/10 shadow-2xl backdrop-blur-2xl relative overflow-hidden animate-fade-in flex flex-col items-center text-center">
          <div className="w-20 h-20 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-red-500/20 text-4xl">
            ⚠️
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-white mb-3">Verification Failed</h2>
          <p className="text-neutral-400 text-sm mb-8 leading-relaxed">
            The verification link is invalid or has expired. Please try signing in again to request a new link.
          </p>
          <Button onClick={() => navigate('/')} variant="secondary" className="w-full py-4 text-sm font-black tracking-widest shadow-lg shadow-white/5">
            RETURN TO SIGN IN
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-6 text-white selection:bg-cyan-500/30 font-sans select-none w-full relative overflow-hidden">
      
      {/* Background decorations */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-[80px] pointer-events-none" />

      <div className="w-full max-w-md p-10 rounded-3xl bg-neutral-900/80 border border-white/10 shadow-2xl backdrop-blur-2xl relative overflow-hidden animate-fade-in flex flex-col items-center text-center">
        
        {/* Animated Checkmark */}
        <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-emerald-500/20">
          <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h2 className="text-3xl font-extrabold tracking-tight text-white mb-3">
          Email Verified!
        </h2>
        
        {isMobile ? (
          <>
            <p className="text-neutral-400 text-sm mb-8 leading-relaxed">
              Your email is verified. EnjoyTogether works best on a desktop browser. You can safely close this tab and return to the app on your primary device.
            </p>
            <Button
              onClick={() => window.close()}
              variant="secondary"
              className="w-full py-4 text-sm font-black tracking-widest shadow-lg shadow-white/5"
            >
              CLOSE TAB
            </Button>
          </>
        ) : (
          <>
            <p className="text-neutral-400 text-sm mb-8 leading-relaxed">
              Your email address has been successfully verified. You now have full access to EnjoyTogether.
            </p>
            <Button
              onClick={() => navigate('/')}
              variant="cyan"
              className="w-full py-4 text-sm font-black tracking-widest shadow-lg shadow-cyan-500/20"
            >
              CONTINUE TO DASHBOARD
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default Verified;
