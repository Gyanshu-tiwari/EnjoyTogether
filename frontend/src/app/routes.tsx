import { useEffect } from 'react';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';
import { useAuthSession } from '@/features/auth';
import Room from '@/pages/Room';
import ResetPassword from '@/pages/ResetPassword';
import Verified from '@/pages/Verified';
import { Spinner } from '@/shared/components/feedback/Spinner';

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

// ── Protected Route — guards /room/:id from unauthenticated access ──────────
// If the session is still resolving, render a full-page spinner to prevent
// the login wall flash. Once resolved, if no session exists, redirect to root.
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, loading } = useAuthSession();

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-neutral-400 font-medium gap-4">
        <Spinner size="md" />
        <span>Loading EnjoyTogether...</span>
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
        <Route path="/" element={<Room />} />
        <Route
          path="/room/:id"
          element={
            <ProtectedRoute>
              <Room />
            </ProtectedRoute>
          }
        />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verified" element={<Verified />} />
      </Routes>
    </>
  );
};
