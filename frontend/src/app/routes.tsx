import { useEffect } from 'react';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';
import { useAuthSession } from '@/features/auth';
import Room from '@/pages/Room';
import ResetPassword from '@/pages/ResetPassword';
import Verified from '@/pages/Verified';
import { MainLayout } from '@/shared/components/layout';

// ── Auth state listener — handles cross-tab sign-in sync ────────────────────
const AuthListener = () => {
  const navigate = useNavigate();
  const { loading } = useAuthSession();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      // Guard against acting before Supabase SDK has resolved the initial session.
      // Without this, SIGNED_IN can fire during the async getSession() call and
      // navigate prematurely before loading is even complete.
      if (loading) return;

      if (event === 'SIGNED_IN') {
        navigate('/', { replace: true });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate, loading]);

  return null;
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, loading } = useAuthSession();

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-center text-neutral-400 font-medium gap-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/5 to-transparent animate-shimmer" />
        <div className="w-12 h-12 rounded-full bg-brand/10 border border-brand-border flex items-center justify-center relative">
          <div className="absolute inset-0 rounded-full bg-brand animate-ping opacity-75" />
          <div className="relative w-4 h-4 rounded-full bg-brand" />
        </div>
        <span className="font-mono text-xs tracking-widest text-brand animate-pulse uppercase">EnjoyTogether</span>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export const AppRoutes = () => {
  return (
    <>
      <AuthListener />
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Room />} />
          <Route
            path="/room/:id"
            element={
              <ProtectedRoute>
                <Room />
              </ProtectedRoute>
            }
          />
        </Route>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verified" element={<Verified />} />
      </Routes>
    </>
  );
};
