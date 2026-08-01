import { useEffect, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { syncGoogleProfile } from '@/features/friends/api/friendApi';

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

        // Seed Google profile: if user signed in with Google and has no username yet, sync it
        if (session?.user) {
          const meta = session.user.user_metadata;
          const hasUsername = Boolean(meta?.username);
          // Google OAuth provides full_name or name; normal signup sets username
          const googleName: string | undefined = meta?.full_name || meta?.name;
          if (!hasUsername && googleName) {
            // Derive a clean username from the Google display name (lowercase, underscored)
            const derivedUsername = googleName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_|_$/g, '')
              .substring(0, 30) || 'user';

            const googleAvatar: string | undefined = meta?.avatar_url || meta?.picture;
            syncGoogleProfile(derivedUsername, googleAvatar).then(() => {
              // Also persist to supabase auth metadata so Header shows username immediately
              return supabase.auth.updateUser({ data: { username: derivedUsername } });
            }).catch(err => console.warn('[useAuthSession] Google profile sync failed:', err));
          }
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

