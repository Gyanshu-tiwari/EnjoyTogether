import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';
import { Lock, Eye, EyeOff } from 'lucide-react';

export const ResetPassword: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
    <div className="flex-1 flex flex-col items-center justify-center w-full relative">
      <div className="w-full max-w-md p-8 rounded-3xl bg-bg-card border border-white/5 shadow-2xl relative overflow-hidden animate-fade-in -mt-10">
        {/* Decorative light glows */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-brand/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-brand/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col items-center mb-8 relative z-10">
          <div className="w-16 h-16 rounded-2xl bg-brand flex items-center justify-center shadow-lg shadow-brand/20 mb-4 scale-95 hover:scale-100 transition-transform duration-300 text-white">
            <Lock className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-white mb-2">
            Reset Password
          </h2>
          <p className="text-text-secondary text-xs text-center max-w-70 leading-relaxed font-medium">
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
              <div className="p-4 bg-brand/10 border border-brand-border rounded-xl text-sm text-indigo-400 text-center font-medium">
                Password updated successfully!
              </div>
              <button
                onClick={() => navigate('/', { replace: true })}
                className="w-full py-3.5 bg-brand hover:bg-brand-hover rounded-2xl text-xs font-black tracking-wider transition-all cursor-pointer text-white shadow-lg shadow-brand/10 active:scale-95"
              >
                CONTINUE TO APP
              </button>
            </div>
          ) : (
            <form onSubmit={handleResetPassword} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-text-secondary tracking-wider uppercase ml-1">New Password</label>
                <div className="relative w-full">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-4 pr-11 py-3 bg-bg-primary rounded-2xl border border-white/5 focus:outline-none focus:border-brand/40 text-sm transition-all text-neutral-200 placeholder-neutral-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors cursor-pointer p-1"
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-text-secondary tracking-wider uppercase ml-1">Confirm New Password</label>
                <div className="relative w-full">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-4 pr-11 py-3 bg-bg-primary rounded-2xl border border-white/5 focus:outline-none focus:border-brand/40 text-sm transition-all text-neutral-200 placeholder-neutral-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors cursor-pointer p-1"
                    title={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-brand hover:bg-brand-hover rounded-2xl text-xs font-black tracking-wider transition-all cursor-pointer text-white shadow-lg shadow-brand/10 active:scale-95 disabled:opacity-50 mt-4"
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
