import { useEffect, Suspense, lazy } from 'react';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';
import { useAuthSession } from '@/features/auth';
import Landing from '@/pages/Landing';
import Login from '@/pages/Login';

const Room = lazy(() => import('@/pages/Room'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const Verified = lazy(() => import('@/pages/Verified'));
const Profile = lazy(() => import('@/pages/Profile'));
import { MainLayout } from '@/shared/components/layout';
import { DashboardSkeleton } from '@/shared/components/feedback/Skeletons';

const AuthListener = () => {
  const navigate = useNavigate();
  const { loading } = useAuthSession();

  // Tell the native HTML loader to finish and dismiss once Auth is ready globally
  useEffect(() => {
    if (!loading && typeof window.finishLoading === 'function') {
      window.finishLoading();
    }
  }, [loading]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      // Guard against acting before Supabase SDK has resolved the initial session.
      // Without this, SIGNED_IN can fire during the async getSession() call and
      // navigate prematurely before loading is even complete.
      if (loading) return;

      if (event === 'SIGNED_IN') {
        if (window.location.pathname === '/login') {
          navigate('/', { replace: true });
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate, loading]);

  return null;
};

const ProtectedRoute = ({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) => {
  const { session, loading } = useAuthSession();

  if (loading) {
    if (fallback) return <>{fallback}</>;
    
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
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export const AppRoutes = () => {
  return (
    <>
      <AuthListener />
      <Suspense fallback={<div className="min-h-screen bg-bg-primary" />}>
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute fallback={
                  <div className="w-full flex flex-col items-center pt-24 pb-12 px-4">
                    <DashboardSkeleton />
                  </div>
                }>
                  <Room />
                </ProtectedRoute>
              }
            />
            <Route
              path="/room/:id"
              element={
                <ProtectedRoute>
                  <Room />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
          </Route>
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verified" element={<Verified />} />
        </Routes>
      </Suspense>
    </>
  );
};
