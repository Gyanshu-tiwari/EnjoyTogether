import { useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';
import Room from '@/pages/Room';
import ResetPassword from '@/pages/ResetPassword';
import Verified from '@/pages/Verified';

const AuthListener = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        navigate('/', { replace: true });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  return null;
};

export const AppRoutes = () => {
  return (
    <>
      <AuthListener />
      <Routes>
        <Route path="/" element={<Room />} />
        <Route path="/room/:id" element={<Room />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verified" element={<Verified />} />
      </Routes>
    </>
  );
};
