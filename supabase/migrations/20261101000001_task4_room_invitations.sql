-- ======================================================================================
-- Migration: 20261101000001_task4_room_invitations.sql
-- Description: Task 4 - Persistent room invitations schema for registered and guest users
-- ======================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.room_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id TEXT NOT NULL,
    host_id TEXT NOT NULL,
    host_name TEXT NOT NULL,
    host_avatar TEXT,
    recipient_id TEXT NOT NULL,
    recipient_username TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on recipient_id and status for fast pending invitation retrieval
CREATE INDEX IF NOT EXISTS idx_room_invitations_recipient_status
    ON public.room_invitations(recipient_id, status);

CREATE INDEX IF NOT EXISTS idx_room_invitations_room_id
    ON public.room_invitations(room_id);

-- Enable Row Level Security
ALTER TABLE public.room_invitations ENABLE ROW LEVEL SECURITY;

-- Allow users to view invitations where they are host or recipient, or service role
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'room_invitations'
        AND policyname = 'Users and service role can view their invitations'
    ) THEN
        CREATE POLICY "Users and service role can view their invitations"
            ON public.room_invitations
            FOR SELECT
            USING (
                auth.uid()::text = recipient_id
                OR auth.uid()::text = host_id
                OR auth.role() = 'service_role'
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'room_invitations'
        AND policyname = 'Hosts and service role can create invitations'
    ) THEN
        CREATE POLICY "Hosts and service role can create invitations"
            ON public.room_invitations
            FOR INSERT
            WITH CHECK (
                auth.uid()::text = host_id
                OR auth.role() = 'service_role'
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'room_invitations'
        AND policyname = 'Recipients, hosts and service role can update invitations'
    ) THEN
        CREATE POLICY "Recipients, hosts and service role can update invitations"
            ON public.room_invitations
            FOR UPDATE
            USING (
                auth.uid()::text = recipient_id
                OR auth.uid()::text = host_id
                OR auth.role() = 'service_role'
            );
    END IF;
END $$;

COMMIT;
