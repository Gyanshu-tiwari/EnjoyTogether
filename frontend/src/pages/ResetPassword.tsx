import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';

export const ResetPassword: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) throw error;
      if (mounted.current) {
        setSuccess(true);
      }
    } catch (err: unknown) {
      if (!mounted.current) return;
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to reset password.');
      }
    } finally {
      if (mounted.current) {
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-6 text-white selection:bg-cyan-500/30 font-sans select-none w-full">
      <div className="w-full max-w-md p-8 rounded-3xl bg-neutral-900/80 border border-white/5 shadow-2xl backdrop-blur-2xl relative overflow-hidden animate-fade-in">
        {/* Decorative light glows */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col items-center mb-8 relative z-10">
          <div className="w-16 h-16 rounded-2xl bg-linear-to-tr from-blue-500 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-4 scale-95 hover:scale-100 transition-transform duration-300">
            <span className="text-3xl">🔐</span>
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-white mb-2">
            Reset Password
          </h2>
          <p className="text-neutral-400 text-xs text-center max-w-[280px] leading-relaxed">
            Enter your new password below.
          </p>
        </div>

        <div className="space-y-5 relative z-10">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">
              {error}
            </div>
          )}
          
          {success ? (
            <div className="flex flex-col gap-6">
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-400 text-center font-medium">
                Password updated successfully!
              </div>
              <button
                onClick={() => navigate('/')}
                className="w-full py-3.5 bg-linear-to-r from-blue-500 via-indigo-500 to-cyan-500 hover:opacity-95 rounded-2xl text-xs font-black tracking-wider transition-all cursor-pointer text-white shadow-lg shadow-indigo-500/10 active:scale-95"
              >
                RETURN TO LOGIN
              </button>
            </div>
          ) : (
            <form onSubmit={handleResetPassword} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-neutral-400 tracking-wider uppercase ml-1">New Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 bg-neutral-950/50 rounded-2xl border border-white/10 focus:outline-none focus:border-cyan-500/50 text-sm transition-all text-neutral-200 placeholder-neutral-500"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-neutral-400 tracking-wider uppercase ml-1">Confirm New Password</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 bg-neutral-950/50 rounded-2xl border border-white/10 focus:outline-none focus:border-cyan-500/50 text-sm transition-all text-neutral-200 placeholder-neutral-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-linear-to-r from-blue-500 via-indigo-500 to-cyan-500 hover:opacity-95 rounded-2xl text-xs font-black tracking-wider transition-all cursor-pointer text-white shadow-lg shadow-indigo-500/10 active:scale-95 disabled:opacity-50 mt-4"
              >
                {loading ? 'UPDATING...' : 'UPDATE PASSWORD'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
