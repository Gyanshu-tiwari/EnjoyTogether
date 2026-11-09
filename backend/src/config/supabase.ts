import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = (supabaseUrl && supabaseServiceKey)
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

if (!supabase) {
  console.warn('⚠️ Supabase credentials not found in environment variables. Running in localized in-memory mode.');
} else {
  if (supabaseServiceKey) {
    try {
      const parts = supabaseServiceKey.split('.');
      if (parts.length >= 2 && parts[1]) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
        if (payload.role === 'anon') {
          console.warn('⚠️ [Supabase Config] SUPABASE_SERVICE_ROLE_KEY is set to the public "anon" key!');
          console.warn('👉 In Railway environment variables, set SUPABASE_SERVICE_ROLE_KEY to the secret service_role key from Supabase Dashboard > Project Settings > API.');
        } else if (payload.role === 'service_role') {
          console.log('⚡ Supabase Admin Client initialized with authoritative service_role key.');
        }
      }
    } catch {
      console.log('⚡ Supabase Admin Client initialized.');
    }
  }
}

/**
 * Shared flag: set to true once any repository detects a schema-cache miss (PGRST205) or permission error (42501).
 * All repositories must use this single instance instead of maintaining separate flags.
 */
let _supabaseDisabled = false;

export function isSupabaseDisabled(): boolean {
  return _supabaseDisabled;
}

export function handleSharedDbError(err: any, context: string): void {
  if (
    err &&
    (err.code === 'PGRST205' ||
      err.code === '42501' ||
      (err.message &&
        (err.message.includes('schema cache') ||
          err.message.includes('permission denied') ||
          err.message.includes('fetch failed') ||
          err.message.includes('ENOTFOUND') ||
          err.message.includes('ECONNREFUSED'))))
  ) {
    if (!_supabaseDisabled) {
      _supabaseDisabled = true;
      if (err.code === '42501' || (err.message && err.message.includes('permission denied'))) {
        console.warn('⚠️ Supabase permission denied (42501): The API key lacks table access privileges. Falling back to in-memory mode for all repositories.');
        console.warn('👉 Ensure SUPABASE_SERVICE_ROLE_KEY is set to the secret service_role key in Railway, or apply the latest database migration.');
      } else {
        console.warn('⚠️ Supabase unavailable or table(s) not found. Falling back to in-memory mode for all repositories.');
      }
    }
  } else {
    console.error(`❌ DB Error [${context}]:`, err);
  }
}
