import { createClient } from '@supabase/supabase-js';
import Cookies from 'js-cookie';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase Environment Variables inside your client configurations!');
}

const cookieOptions = {
  secure: true,
  sameSite: 'None' as const,
  path: '/',
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: {
      getItem: (key) => Cookies.get(key) || null,
      setItem: (key, value) => {
        Cookies.set(key, value, { ...cookieOptions, expires: 365 });
      },
      removeItem: (key) => {
        Cookies.remove(key, cookieOptions);
      },
    },
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
