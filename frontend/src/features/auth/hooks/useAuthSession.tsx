import React, { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase } from '@/shared/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { syncGoogleProfile, initGuestSession, revokeGuestSession, transitionGuestSession } from '@/features/friends/api/friendApi';
import { getAnonymousUserId } from '@/shared/utils/anonymousUser';

interface AuthContextType {
  session: Session | null;
  loading: boolean;
  isGuest: boolean;
  startGuestSession: () => string;
  clearGuestSession: () => void;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  loading: true,
  isGuest: false,
  startGuestSession: () => '',
  clearGuestSession: () => {},
});

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isGuest, setIsGuest] = useState<boolean>(() => {
    return typeof window !== 'undefined' && sessionStorage.getItem('guest_session') === 'true';
  });

  const startGuestSession = useCallback((): string => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('guest_session', 'true');
    }
    const guestId = getAnonymousUserId();
    const existingSecret = typeof window !== 'undefined' ? (localStorage.getItem('et_anon_session_secret') || undefined) : undefined;
    setIsGuest(true);

    // Sync with backend guest code registry using secret proof of ownership
    initGuestSession(guestId, existingSecret).then((data) => {
      if (typeof window !== 'undefined' && data) {
        localStorage.setItem('et_anon_user_id', data.guestId);
        localStorage.setItem('et_anon_friend_code', data.friendCode);
        localStorage.setItem('et_anon_session_secret', data.sessionSecret);
      }
    }).catch((err) => console.warn('[useAuthSession] initGuestSession failed:', err));

    return guestId;
  }, []);

  const clearGuestSession = useCallback(() => {
    if (typeof window !== 'undefined') {
      const guestId = localStorage.getItem('et_anon_user_id');
      const sessionSecret = localStorage.getItem('et_anon_session_secret') || undefined;
      if (guestId && sessionSecret) {
        revokeGuestSession(guestId, sessionSecret).catch((err) => console.warn('[useAuthSession] revokeGuestSession failed:', err));
      }
      sessionStorage.removeItem('guest_session');
      localStorage.removeItem('et_anon_friend_code');
      localStorage.removeItem('et_anon_session_secret');
    }
    setIsGuest(false);
  }, []);

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

    const timer = setTimeout(() => {
      setLoading(false);
    }, 1500);

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        clearTimeout(timer);
        setSession(session);
        setLoading(false);
        if (session) syncProfile(session);
      })
      .catch((error) => {
        clearTimeout(timer);
        console.error('[useAuthSession] getSession failed:', error);
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        // Upgrade to authenticated session from guest mode
        if (typeof window !== 'undefined') {
          const oldGuestId = localStorage.getItem('et_anon_user_id');
          const sessionSecret = localStorage.getItem('et_anon_session_secret') || undefined;
          if (oldGuestId && sessionSecret) {
            transitionGuestSession(oldGuestId, sessionSecret).catch((err) => console.warn('[useAuthSession] transitionGuestSession failed:', err));
            localStorage.removeItem('et_anon_friend_code');
            localStorage.removeItem('et_anon_session_secret');
          }
          sessionStorage.removeItem('guest_session');
        }
        setIsGuest(false);

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

  return (
    <AuthContext.Provider value={{ session, loading, isGuest, startGuestSession, clearGuestSession }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function useAuthSession() {
  return useContext(AuthContext);
}
