import React from 'react';
import { supabase } from '@/shared/lib/supabase';

export const LoginForm: React.FC = () => {
  const handleGoogleLogin = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    } catch (error) {
      console.error('Authentication routing initialization failed:', error);
    }
  };

  return (
    <div className="w-full max-w-md p-8 rounded-3xl bg-neutral-900/80 border border-white/5 shadow-2xl backdrop-blur-2xl relative overflow-hidden animate-fade-in">
      {/* Decorative light glows */}
      <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Brand logo & tagline */}
      <div className="flex flex-col items-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-linear-to-tr from-blue-500 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-4 scale-95 hover:scale-100 transition-transform duration-300">
          <span className="text-3xl">🎥</span>
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white mb-2">
          EnjoyTogether
        </h2>
        <p className="text-neutral-400 text-xs text-center max-w-[280px] leading-relaxed">
          Premium synchronized theater rooms with integrated peer audio & video.
        </p>
      </div>

      <div className="space-y-6">
        <button
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-neutral-100 text-neutral-900 font-bold py-3.5 px-4 rounded-2xl transition-all duration-300 hover:shadow-lg hover:shadow-white/5 active:scale-[0.98] cursor-pointer"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#EA4335"
              d="M12 5.04c1.64 0 3.12.56 4.28 1.67l3.2-3.2C17.52 1.58 14.96 1 12 1 7.35 1 3.4 3.65 1.49 7.5l3.64 2.82c.86-2.58 3.28-4.28 6.87-4.28z"
            />
            <path
              fill="#4285F4"
              d="M23.49 12.27c0-.81-.07-1.59-.2-2.36H12v4.51h6.46c-.29 1.48-1.14 2.73-2.4 3.58l3.64 2.82c2.13-1.97 3.49-4.87 3.49-8.55z"
            />
            <path
              fill="#FBBC05"
              d="M5.13 14.68A7.16 7.16 0 0 1 4.75 12c0-.93.16-1.83.45-2.68L1.49 6.5A11.93 11.93 0 0 0 0 12c0 2.05.52 3.98 1.43 5.68l3.7-3z"
            />
            <path
              fill="#34A853"
              d="M12 23c3.24 0 5.97-1.07 7.96-2.91l-3.64-2.82c-1.01.68-2.3 1.09-4.32 1.09-3.59 0-6.01-1.7-6.87-4.28L1.43 16.9C3.35 20.35 7.31 23 12 23z"
            />
          </svg>
          Sign in with Google
        </button>

        <div className="flex items-center justify-between text-[11px] text-neutral-500 font-mono tracking-wider pt-2 border-t border-white/5">
          <span>SECURE SECRETS MESH</span>
          <span>v1.2.0</span>
        </div>
      </div>
    </div>
  );
};

export default LoginForm;
