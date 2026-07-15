import axios from 'axios';
import { supabase } from '../lib/supabase';

function getBackendUrl(): string {
  return import.meta.env.VITE_BACKEND_URL || '';
}

export const apiClient = axios.create({
  baseURL: getBackendUrl(),
});

// Add a request interceptor to inject the Supabase JWT token
apiClient.interceptors.request.use(
  async (config) => {
    // Attempt to get the current session
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session?.access_token) {
      console.log('[apiClient] Attaching authorization token to request to', config.url);
      config.headers.set('Authorization', `Bearer ${session.access_token}`);
    } else {
      console.warn('[apiClient] No session found, sending unauthenticated request to', config.url);
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);
