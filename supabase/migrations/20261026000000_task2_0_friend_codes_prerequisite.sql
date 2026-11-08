-- ======================================================================================
-- Migration: 20261026000000_task2_0_friend_codes_prerequisite.sql
-- Description: Provision missing Task 2.0 legacy prerequisites (profiles.friend_code and
--              legacy friend_codes table) required by Task 2.1 incremental migration.
-- Targets:
--   1. Transactional fail-stop prechecks (verify core profiles table exists, no conflicting views)
--   2. Add public.profiles.friend_code VARCHAR(6) without unconditional UNIQUE constraint
--   3. Create legacy public.friend_codes table with code VARCHAR(6) PRIMARY KEY
--   4. Enable Row Level Security (RLS) on public.friend_codes
-- ======================================================================================

BEGIN;

-- --------------------------------------------------------------------------------------
-- SECTION 1: FAIL-STOP PRECHECKS
-- --------------------------------------------------------------------------------------
DO $$
BEGIN
    -- 1.1 Verify public.profiles exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'profiles'
    ) THEN
        RAISE EXCEPTION 'Prerequisite migration failed: core table "public.profiles" does not exist.';
    END IF;

    -- 1.2 Verify friend_codes does not already exist as a view or foreign table
    IF EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_schema = 'public' AND table_name = 'friend_codes'
    ) THEN
        RAISE EXCEPTION 'Prerequisite migration failed: "public.friend_codes" already exists as a view.';
    END IF;

    -- 1.3 If profiles.friend_code column already exists, verify its type is compatible
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'friend_code'
          AND (
              data_type NOT IN ('character varying', 'text')
              OR (data_type = 'character varying' AND character_maximum_length IS NOT NULL AND character_maximum_length < 6)
          )
    ) THEN
        RAISE EXCEPTION 'Prerequisite migration failed: existing column "public.profiles.friend_code" has an incompatible data type or length.';
    END IF;

    -- 1.4 If friend_codes table already exists, verify it contains required baseline columns
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'friend_codes'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'friend_codes' AND column_name = 'code'
        ) THEN
            RAISE EXCEPTION 'Prerequisite migration failed: existing table "public.friend_codes" is missing required column "code".';
        END IF;
    END IF;

    RAISE NOTICE 'Task 2.0 prerequisite prechecks passed successfully.';
END $$;

-- --------------------------------------------------------------------------------------
-- SECTION 2: PROFILES FRIEND_CODE COLUMN PROVISIONING
-- --------------------------------------------------------------------------------------
-- Add friend_code column to profiles without an unconditional UNIQUE constraint.
-- Active code uniqueness is enforced via friend_codes partial index; omitting unconditional
-- table-level uniqueness prevents constraint conflicts during recycling and repair.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS friend_code VARCHAR(6);

-- --------------------------------------------------------------------------------------
-- SECTION 3: LEGACY FRIEND_CODES TABLE PROVISIONING
-- --------------------------------------------------------------------------------------
-- Creates the legacy friend_codes table with code VARCHAR(6) PRIMARY KEY.
-- This establishes the baseline schema expected by Task 2.1 Section 1.1 and allows
-- Task 2.1 Section 3 to perform the planned migration to surrogate UUID (id).
CREATE TABLE IF NOT EXISTS public.friend_codes (
    code VARCHAR(6) PRIMARY KEY,
    identity_id TEXT NOT NULL,
    identity_type TEXT NOT NULL CHECK (identity_type IN ('REGISTERED', 'GUEST')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NULL,
    is_active BOOLEAN DEFAULT TRUE,
    revoked_at TIMESTAMPTZ NULL
);

-- --------------------------------------------------------------------------------------
-- SECTION 4: ROW LEVEL SECURITY BASELINE
-- --------------------------------------------------------------------------------------
ALTER TABLE public.friend_codes ENABLE ROW LEVEL SECURITY;

COMMIT;
