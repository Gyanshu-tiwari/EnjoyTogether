import { useEffect, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { syncGoogleProfile } from '@/features/friends/api/friendApi';

export function useAuthSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const syncProfile = (session: Session) => {
      if (!session?.user) return;
      const meta = session.user.user_metadata;
      const existingUsername = meta?.username;
      const googleName: string | undefined = meta?.full_name || meta?.name;
      
      let targetUsername = existingUsername;
      
      if (!targetUsername && googleName) {
        targetUsername = googleName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '')
          .substring(0, 30) || 'user';
      }

      if (targetUsername) {
        const targetAvatar: string | undefined = meta?.avatar_url || meta?.picture;
        syncGoogleProfile(targetUsername, targetAvatar).then(() => {
          if (!existingUsername) {
            return supabase.auth.updateUser({ data: { username: targetUsername } });
          }
        }).catch(err => console.warn('[useAuthSession] profile sync failed:', err));
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (session) syncProfile(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        // Proactively wake up the Railway backend so sockets/streams initialize faster
        const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
        if (backendUrl) {
          fetch(`${backendUrl}/health`).catch(err => console.error('Backend wake handshake failed:', err));
        }

        syncProfile(session);

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

