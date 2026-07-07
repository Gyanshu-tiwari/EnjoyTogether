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
  console.log('⚡ Supabase Admin Client initialized successfully.');
}

/**
 * Shared flag: set to true once any repository detects a schema-cache miss (PGRST205).
 * All repositories must use this single instance instead of maintaining separate flags.
 */
let _supabaseDisabled = false;

export function isSupabaseDisabled(): boolean {
  return _supabaseDisabled;
}

export function handleSharedDbError(err: any, context: string): void {
  if (err && (err.code === 'PGRST205' || (err.message && err.message.includes('schema cache')))) {
    if (!_supabaseDisabled) {
      _supabaseDisabled = true;
      console.warn('⚠️ Supabase table(s) not found in schema cache. Falling back to in-memory mode for all repositories.');
    }
  } else {
    console.error(`❌ DB Error [${context}]:`, err);
  }
}
