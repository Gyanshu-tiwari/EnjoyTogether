import { useEffect, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import type { Session } from '@supabase/supabase-js';

export function useAuthSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        // Proactively wake up the Railway backend so sockets/streams initialize faster
        const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
        if (backendUrl) {
          fetch(`${backendUrl}/health`).catch(err => console.error('Backend wake handshake failed:', err));
        }

        const win = window as Window & { isCrossTabPending?: boolean };
        if (win.isCrossTabPending) {
          setTimeout(() => {
            win.isCrossTabPending = false;
            setSession(session);
          }, 2500);
          return;
        }
      }
      
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, loading };
}
