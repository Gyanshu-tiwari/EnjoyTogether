import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');

describe('Task 2.0 & Task 2.1 Static Migration Chain Verification', () => {
  const prereqFileName = '20261026000000_task2_0_friend_codes_prerequisite.sql';
  const task21FileName = '20261026000001_task2_1_friend_codes_and_guest_sessions.sql';

  const prereqPath = path.join(MIGRATIONS_DIR, prereqFileName);
  const task21Path = path.join(MIGRATIONS_DIR, task21FileName);

  it('1. Verifies migration file existence and strict chronological ordering', () => {
    assert.ok(fs.existsSync(prereqPath), `Prerequisite migration must exist at ${prereqPath}`);
    assert.ok(fs.existsSync(task21Path), `Task 2.1 migration must exist at ${task21Path}`);

    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const prereqIndex = files.indexOf(prereqFileName);
    const task21Index = files.indexOf(task21FileName);

    assert.ok(prereqIndex !== -1, 'Prerequisite file must be present in migrations directory');
    assert.ok(task21Index !== -1, 'Task 2.1 file must be present in migrations directory');
    assert.ok(
      prereqIndex < task21Index,
      `Prerequisite migration (${prereqFileName}) must strictly precede Task 2.1 (${task21FileName}) in alphanumeric order`
    );
  });

  it('2. Verifies Task 2.0 prerequisite migration schema, constraints, and safety guards', () => {
    const prereqSql = fs.readFileSync(prereqPath, 'utf8');

    // Transaction boundaries
    assert.match(prereqSql, /^\s*BEGIN;/m, 'Migration must start with BEGIN;');
    assert.match(prereqSql, /COMMIT;\s*$/m, 'Migration must end with COMMIT;');

    // Fail-stop guard for public.profiles
    assert.match(
        prereqSql,
        /table_name\s*=\s*'profiles'/i,
        'Prerequisite must verify public.profiles table exists'
    );
    assert.match(
        prereqSql,
        /RAISE EXCEPTION.*profiles.*does not exist/i,
        'Prerequisite must fail-stop if profiles does not exist'
    );

    // View collision guard
    assert.match(
        prereqSql,
        /information_schema\.views/i,
        'Prerequisite must guard against friend_codes existing as a view'
    );

    // profiles.friend_code column provisioning
    assert.match(
      prereqSql,
      /ALTER TABLE\s+(?:public\.)?profiles\s+ADD COLUMN IF NOT EXISTS\s+friend_code\s+VARCHAR\(6\);/i,
      'Must add profiles.friend_code VARCHAR(6) column'
    );

    // Must NOT add an unconditional UNIQUE constraint on profiles.friend_code
    assert.doesNotMatch(
      prereqSql,
      /ADD COLUMN IF NOT EXISTS\s+friend_code\s+VARCHAR\(6\)\s+UNIQUE/i,
      'Must NOT place an unconditional UNIQUE constraint on profiles.friend_code'
    );
    assert.doesNotMatch(
      prereqSql,
      /CONSTRAINT.*UNIQUE\s*\(\s*friend_code\s*\)/i,
      'Must NOT add an unconditional UNIQUE table constraint on profiles(friend_code)'
    );

    // Legacy friend_codes table definition
    assert.match(
      prereqSql,
      /CREATE TABLE IF NOT EXISTS\s+(?:public\.)?friend_codes\s*\(/i,
      'Must create public.friend_codes table if not exists'
    );
    assert.match(
      prereqSql,
      /code\s+VARCHAR\(6\)\s+PRIMARY KEY/i,
      'Must establish legacy code VARCHAR(6) PRIMARY KEY'
    );
    assert.match(
      prereqSql,
      /identity_id\s+TEXT\s+NOT NULL/i,
      'Must define identity_id TEXT NOT NULL'
    );
    assert.match(
      prereqSql,
      /identity_type\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*identity_type\s+IN\s*\(\s*'REGISTERED'\s*,\s*'GUEST'\s*\)\s*\)/i,
      'Must define identity_type CHECK constraint for REGISTERED and GUEST'
    );
    assert.match(
      prereqSql,
      /created_at\s+TIMESTAMPTZ\s+DEFAULT\s+NOW\(\)/i,
      'Must define created_at with DEFAULT NOW()'
    );
    assert.match(prereqSql, /expires_at\s+TIMESTAMPTZ\s+NULL/i, 'Must define expires_at TIMESTAMPTZ NULL');
    assert.match(prereqSql, /is_active\s+BOOLEAN\s+DEFAULT\s+TRUE/i, 'Must define is_active BOOLEAN DEFAULT TRUE');
    assert.match(prereqSql, /revoked_at\s+TIMESTAMPTZ\s+NULL/i, 'Must define revoked_at TIMESTAMPTZ NULL');

    // RLS enabled
    assert.match(
      prereqSql,
      /ALTER TABLE\s+(?:public\.)?friend_codes\s+ENABLE ROW LEVEL SECURITY;/i,
      'Must enable RLS on friend_codes'
    );

    // Must NOT duplicate guest_sessions creation in prerequisite (Task 2.1 handles guest_sessions)
    assert.doesNotMatch(
      prereqSql,
      /CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?guest_sessions/i,
      'Must NOT duplicate guest_sessions table creation in prerequisite migration'
    );
  });

  it('3. Verifies handshake alignment with Task 2.1 incremental migration', () => {
    const task21Sql = fs.readFileSync(task21Path, 'utf8');

    // Section 1.1 checks that profiles and friend_codes exist
    assert.match(
      task21Sql,
      /IF NOT EXISTS\s*\(SELECT 1 FROM information_schema\.tables WHERE table_schema = 'public' AND table_name = 'profiles'\)/,
      'Task 2.1 Section 1.1 requires profiles'
    );
    assert.match(
      task21Sql,
      /IF NOT EXISTS\s*\(SELECT 1 FROM information_schema\.tables WHERE table_schema = 'public' AND table_name = 'friend_codes'\)/,
      'Task 2.1 Section 1.1 requires friend_codes'
    );

    // Section 3 upgrades surrogate UUID id with gen_random_uuid()
    assert.match(
      task21Sql,
      /ALTER TABLE public\.friend_codes ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid\(\);/,
      'Task 2.1 Section 3 adds id UUID with gen_random_uuid()'
    );
    assert.match(
      task21Sql,
      /ALTER TABLE public\.friend_codes ALTER COLUMN id SET DEFAULT gen_random_uuid\(\);/,
      'Task 2.1 Section 3 ensures id DEFAULT gen_random_uuid()'
    );
    assert.match(
      task21Sql,
      /EXECUTE 'ALTER TABLE public\.friend_codes ADD PRIMARY KEY \(id\)';/,
      'Task 2.1 Section 3 transitions primary key to (id)'
    );

    // Section 5 repairs profiles.friend_code
    assert.match(
      task21Sql,
      /UPDATE public\.profiles p\s+SET friend_code = NULL/,
      'Task 2.1 Section 5 updates profiles.friend_code'
    );

    // Section 6 creates partial unique index
    assert.match(
      task21Sql,
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_codes_active_code\s+ON public\.friend_codes\(code\)\s+WHERE is_active = TRUE;/,
      'Task 2.1 Section 6 creates idx_friend_codes_active_code'
    );

    // Section 7 creates guest_sessions with secret_hash
    assert.match(
      task21Sql,
      /CREATE TABLE IF NOT EXISTS public\.guest_sessions/,
      'Task 2.1 Section 7 creates guest_sessions'
    );
    assert.match(
      task21Sql,
      /ALTER TABLE public\.guest_sessions ALTER COLUMN secret_hash SET NOT NULL;/,
      'Task 2.1 Section 7 enforces secret_hash NOT NULL'
    );
  });
});
