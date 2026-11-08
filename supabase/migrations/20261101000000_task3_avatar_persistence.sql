-- ======================================================================================
-- Migration: 20261101000000_task3_avatar_persistence.sql
-- Description: Task 3 - Forward-only non-destructive schema update for persistent avatars
-- ======================================================================================

BEGIN;

-- Add avatar_url to guest_sessions if not present
ALTER TABLE public.guest_sessions
    ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Verify profiles has avatar_url (idempotent guard)
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS avatar_url TEXT;

COMMIT;
