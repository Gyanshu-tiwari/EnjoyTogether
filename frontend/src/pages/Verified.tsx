import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/shared/components/ui/Button';
import { useAuthSession } from '@/features/auth';
import { AlertTriangle } from 'lucide-react';
import { CardSkeleton } from '@/shared/components/feedback/Skeletons';

export const Verified: React.FC = () => {
  const navigate = useNavigate();
  const { session, loading } = useAuthSession();
  const [isMobile] = useState(() => 
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-center p-6 text-white selection:bg-brand/25 font-sans select-none w-full relative overflow-hidden">
        <CardSkeleton />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-center p-6 text-white selection:bg-red-500/30 font-sans select-none w-full relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-150 h-150 bg-red-500/5 rounded-full blur-[100px] pointer-events-none" />
        <div className="w-full max-w-md p-10 rounded-3xl bg-bg-card border border-white/5 shadow-2xl backdrop-blur-2xl relative overflow-hidden animate-fade-in flex flex-col items-center text-center">
          <div className="w-20 h-20 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-red-500/10 text-red-550">
            <AlertTriangle className="w-10 h-10" />
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-white mb-3">Verification Failed</h2>
          <p className="text-text-secondary text-sm mb-8 leading-relaxed font-medium">
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
    <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-center p-6 text-white selection:bg-brand/25 font-sans select-none w-full relative overflow-hidden">
      
      {/* Background decorations */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-150 h-150 bg-brand/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-0 right-0 w-96 h-96 bg-brand/5 rounded-full blur-[80px] pointer-events-none" />

      <div className="w-full max-w-md p-10 rounded-3xl bg-bg-card border border-white/5 shadow-2xl backdrop-blur-2xl relative overflow-hidden animate-fade-in flex flex-col items-center text-center">
        
        {/* Animated Checkmark */}
        <div className="w-20 h-20 bg-brand-muted border border-brand-border rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-brand/10">
          <svg className="w-10 h-10 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h2 className="text-3xl font-extrabold tracking-tight text-white mb-3">
          Email Verified!
        </h2>
        
        {isMobile ? (
          <>
            <p className="text-text-secondary text-sm mb-8 leading-relaxed font-medium">
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
            <p className="text-text-secondary text-sm mb-8 leading-relaxed font-medium">
              Your email address has been successfully verified. You now have full access to EnjoyTogether.
            </p>
            <Button
              onClick={() => navigate('/')}
              variant="brand"
              className="w-full py-4 text-sm font-black tracking-widest shadow-lg shadow-brand/10"
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
