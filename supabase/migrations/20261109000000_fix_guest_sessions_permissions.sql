-- Migration: 20261109000000_fix_guest_sessions_permissions.sql
-- Description: Grant table access on guest_sessions and friend_codes to anon and authenticated roles
-- Resolves PostgreSQL error 42501 (permission denied for table guest_sessions) when connecting via public or unprivileged keys.

-- 1. Grant schema usage
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 2. Grant table permissions on guest_sessions
GRANT ALL ON TABLE public.guest_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.guest_sessions TO anon, authenticated;

-- 3. Grant table permissions on friend_codes
GRANT ALL ON TABLE public.friend_codes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.friend_codes TO anon, authenticated;

-- 4. Enable RLS and define permissive policies so that queries authenticated as anon/authenticated succeed
ALTER TABLE public.guest_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friend_codes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'guest_sessions'
          AND policyname = 'Allow anon and authenticated access to guest_sessions'
    ) THEN
        CREATE POLICY "Allow anon and authenticated access to guest_sessions"
            ON public.guest_sessions
            FOR ALL
            TO anon, authenticated
            USING (true)
            WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'friend_codes'
          AND policyname = 'Allow anon and authenticated access to friend_codes'
    ) THEN
        CREATE POLICY "Allow anon and authenticated access to friend_codes"
            ON public.friend_codes
            FOR ALL
            TO anon, authenticated
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;
