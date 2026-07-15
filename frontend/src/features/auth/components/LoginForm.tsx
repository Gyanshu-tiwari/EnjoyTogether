import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '@/shared/lib/supabase';

type AuthMode = 'signin' | 'signup' | 'forgot_password';

export const LoginForm: React.FC = () => {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [crossTabVerified, setCrossTabVerified] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    // Cross-tab listener for email verification
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' && mode === 'signup' && successMsg && mounted.current) {
        setCrossTabVerified(true);
      }
    });

    return () => {
      mounted.current = false;
      subscription.unsubscribe();
    };
  }, [mode, successMsg]);

  const resetState = () => {
    setError(null);
    setSuccessMsg(null);
    setLoading(false);
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetState();
    setLoading(true);

    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        if (mounted.current) {
          setSuccessMsg('Success! Please check your email to verify your account.');
          (window as Window & { isCrossTabPending?: boolean }).isCrossTabPending = true;
        }
      } else if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        // On success, the useAuthSession hook will trigger and re-render
      } else if (mode === 'forgot_password') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        if (mounted.current) {
          setSuccessMsg('Password reset link sent to your email.');
        }
      }
    } catch (err: unknown) {
      if (!mounted.current) return;
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An error occurred during authentication.');
      }
    } finally {
      if (mounted.current) {
        setLoading(false);
      }
    }
  };

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

      <div className="space-y-5 relative z-10">
        {/* Error / Success Messages */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">
            {error}
          </div>
        )}
        {successMsg && mode !== 'signup' && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400">
            {successMsg}
          </div>
        )}

        {mode === 'signup' && successMsg ? (
          crossTabVerified ? (
            <div className="flex flex-col items-center justify-center p-6 text-center gap-4 bg-cyan-500/10 border border-cyan-500/20 rounded-2xl animate-fade-in">
              <div className="w-16 h-16 bg-cyan-500/20 border border-cyan-500/40 rounded-full flex items-center justify-center shadow-lg shadow-cyan-500/20">
                <svg className="w-8 h-8 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-cyan-400 mb-1">Verification Successful!</h3>
                <p className="text-xs text-neutral-300">
                  You are now signed in. Redirecting to your dashboard...
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-6 text-center gap-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl animate-fade-in">
              <span className="text-4xl">✉️</span>
              <div>
                <h3 className="text-lg font-bold text-emerald-400 mb-1">Check your inbox</h3>
                <p className="text-xs text-neutral-300">
                  We've sent a verification link to <span className="font-bold text-white">{email}</span>.
                </p>
              </div>
              <button
                onClick={() => { resetState(); setMode('signin'); }}
                className="mt-2 text-xs font-bold text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                Return to Sign In
              </button>
            </div>
          )
        ) : (
          <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-neutral-400 tracking-wider uppercase ml-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full px-4 py-3 bg-neutral-950/50 rounded-2xl border border-white/10 focus:outline-none focus:border-cyan-500/50 text-sm transition-all text-neutral-200 placeholder-neutral-500"
              />
            </div>

            {mode !== 'forgot_password' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-neutral-400 tracking-wider uppercase ml-1">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 bg-neutral-950/50 rounded-2xl border border-white/10 focus:outline-none focus:border-cyan-500/50 text-sm transition-all text-neutral-200 placeholder-neutral-500"
                />
              </div>
            )}

            {mode === 'signin' && (
              <div className="flex justify-end mt-[-8px]">
                <button
                  type="button"
                  onClick={() => { setMode('forgot_password'); resetState(); }}
                  className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  Forgot password?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-linear-to-r from-blue-500 via-indigo-500 to-cyan-500 hover:opacity-95 rounded-2xl text-xs font-black tracking-wider transition-all cursor-pointer text-white shadow-lg shadow-indigo-500/10 active:scale-95 disabled:opacity-50 mt-2"
            >
              {loading ? 'PROCESSING...' : mode === 'signin' ? 'SIGN IN' : mode === 'signup' ? 'CREATE ACCOUNT' : 'SEND RESET LINK'}
            </button>
          </form>
        )}

        <div className="flex items-center justify-center gap-2 text-xs text-neutral-400">
          {mode === 'signin' ? (
            <>
              <span>Don't have an account?</span>
              <button type="button" onClick={() => { setMode('signup'); resetState(); }} className="text-cyan-400 font-bold hover:text-cyan-300">Sign Up</button>
            </>
          ) : (
            <>
              <span>Already have an account?</span>
              <button type="button" onClick={() => { setMode('signin'); resetState(); }} className="text-cyan-400 font-bold hover:text-cyan-300">Sign In</button>
            </>
          )}
        </div>

        <div className="relative flex items-center py-2">
          <div className="grow border-t border-white/10"></div>
          <span className="shrink-0 px-4 text-xs text-neutral-500 uppercase tracking-widest font-semibold">Or continue with</span>
          <div className="grow border-t border-white/10"></div>
        </div>

        <button
          onClick={handleGoogleLogin}
          type="button"
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
          Google
        </button>

        <div className="flex items-center justify-between text-[11px] text-neutral-500 font-mono tracking-wider pt-2 border-t border-white/5">
          <span>SECURE SECRETS MESH</span>
          <span>v1.2.1</span>
        </div>
      </div>
    </div>
  );
};

export default LoginForm;
