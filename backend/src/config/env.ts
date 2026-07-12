/**
 * env.ts — Fail-fast environment variable validation.
 * Called once at server startup. Exits with code 1 if any required var is missing.
 */

const REQUIRED_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'LIVEKIT_URL',
] as const;

const OPTIONAL_VARS_WITH_DEFAULTS: Record<string, string> = {
  PORT: '5000',
  NODE_ENV: 'development',
  CORS_ORIGIN: '*',
  BACKEND_URL: '',
};

export function validateEnv(): void {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    console.error(`\n❌ FATAL: Missing required environment variables:\n  ${missing.join('\n  ')}\n`);
    console.error('Please set these in your .env file and restart the server.');
    process.exit(1);
  }

  // Apply defaults for optional vars
  for (const [key, defaultVal] of Object.entries(OPTIONAL_VARS_WITH_DEFAULTS)) {
    if (!process.env[key]) {
      process.env[key] = defaultVal;
    }
  }

  console.log('✅ Environment configuration validated successfully.');
}

/** Returns the comma-separated CORS_ORIGIN split into an array. */
export function getAllowedOrigins(): string[] {
  return (process.env.CORS_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
