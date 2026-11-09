-- ======================================================================================
-- Migration: 20261026000001_task2_1_friend_codes_and_guest_sessions.sql
-- Description: Task 2.1 Incremental Migration for Friend Codes & Guest Sessions
-- Targets:
--   1. Comprehensive cross-schema foreign-key precondition safety check
--   2. friend_codes surrogate UUID primary key upgrade (single/composite/absent handling)
--   3. Duplicate active code quarantine (_migration_deactivated_duplicate_codes) & profile repair
--   4. Selective cleanup of conflicting unique constraints & indexes on friend_codes(code)
--      using pg_index.indnkeyatts and indnatts to distinguish key vs INCLUDE columns
--      and detecting expression keys (attnum = 0) without silent omission
--   5. Partial unique index for code recycling (idx_friend_codes_active_code)
--   6. guest_sessions secret_hash column & legacy unauthenticated session deactivation
--   7. Granular RLS policy review (inspect command, mode, expressions; re-scope/drop safely)
--      and catalog ACL-based verification of direct PUBLIC privileges and effective role grants
--   8. Automated post-migration verification assertions (PK, duplicates, profiles, index definition)
-- ======================================================================================

BEGIN;

-- --------------------------------------------------------------------------------------
-- SECTION 1: PRECONDITION CHECKS (CROSS-SCHEMA FAIL-SAFE ABORT)
-- --------------------------------------------------------------------------------------
DO $$
DECLARE
    v_fk_details TEXT;
BEGIN
    -- 1.1 Verify required core tables exist in public schema
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'profiles') THEN
        RAISE EXCEPTION 'Precondition failed: table "public.profiles" does not exist.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'friend_codes') THEN
        RAISE EXCEPTION 'Precondition failed: table "public.friend_codes" does not exist.';
    END IF;

    -- 1.2 Inspect foreign-key constraints referencing public.friend_codes across ANY database schema.
    -- Any foreign key referencing friend_codes would be broken by dropping or altering the primary key.
    -- If unexpected foreign keys exist, abort immediately to preserve referential integrity.
    SELECT string_agg(format('%I.%I (%I)', n.nspname, cl.relname, c.conname), ', ')
    INTO v_fk_details
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE c.confrelid = 'public.friend_codes'::regclass
      AND c.contype = 'f';

    IF v_fk_details IS NOT NULL THEN
        RAISE EXCEPTION 'Precondition failed: detected foreign key constraint(s) referencing public.friend_codes from schema(s): [%]. Aborting migration to avoid unintended referential damage.', v_fk_details;
    END IF;

    RAISE NOTICE 'Precondition checks passed successfully: No dependent foreign keys detected across any schema.';
END $$;

-- --------------------------------------------------------------------------------------
-- SECTION 2: QUARANTINE TABLE INITIALIZATION
-- --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._migration_deactivated_duplicate_codes (
    friend_code_id UUID PRIMARY KEY,
    code VARCHAR(6) NOT NULL,
    identity_id TEXT NOT NULL,
    identity_type TEXT NOT NULL,
    created_at TIMESTAMPTZ,
    deactivated_at TIMESTAMPTZ DEFAULT NOW(),
    reason TEXT NOT NULL
);

-- --------------------------------------------------------------------------------------
-- SECTION 3: FRIEND_CODES SURROGATE UUID PRIMARY KEY UPGRADE
-- --------------------------------------------------------------------------------------

-- 3.1 Ensure surrogate UUID column exists
ALTER TABLE public.friend_codes ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

-- 3.2 Backfill any existing rows with NULL id
UPDATE public.friend_codes SET id = gen_random_uuid() WHERE id IS NULL;

-- 3.3 Ensure column is NOT NULL with default
ALTER TABLE public.friend_codes ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.friend_codes ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 3.4 Pre-PK Integrity Check: Detect NULL or duplicate IDs before constraint creation
DO $$
DECLARE
    v_null_id_count INTEGER;
    v_dup_id_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_null_id_count FROM public.friend_codes WHERE id IS NULL;
    IF v_null_id_count > 0 THEN
        RAISE EXCEPTION 'Pre-PK assertion failed: found % row(s) with NULL id in friend_codes.', v_null_id_count;
    END IF;

    SELECT COUNT(*) INTO v_dup_id_count
    FROM (
        SELECT id FROM public.friend_codes GROUP BY id HAVING COUNT(*) > 1
    ) sub;
    IF v_dup_id_count > 0 THEN
        RAISE EXCEPTION 'Pre-PK assertion failed: found % duplicate id value(s) in friend_codes.', v_dup_id_count;
    END IF;
END $$;

-- 3.5 Inspect complete ordered primary-key column list and handle absent, legacy, composite, or already-correct PK
DO $$
DECLARE
    v_pk_name TEXT;
    v_pk_cols TEXT[];
BEGIN
    SELECT
        c.conname,
        array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum))
    INTO v_pk_name, v_pk_cols
    FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
    WHERE c.conrelid = 'public.friend_codes'::regclass
      AND c.contype = 'p'
    GROUP BY c.conname;

    IF v_pk_name IS NOT NULL AND v_pk_cols = ARRAY['id'] THEN
        RAISE NOTICE 'Primary key on friend_codes(id) already exists and is correct.';
    ELSIF v_pk_name IS NOT NULL THEN
        RAISE NOTICE 'Dropping conflicting primary key constraint "%" on friend_codes columns: (%).', v_pk_name, array_to_string(v_pk_cols, ', ');
        EXECUTE format('ALTER TABLE public.friend_codes DROP CONSTRAINT %I', v_pk_name);
        EXECUTE 'ALTER TABLE public.friend_codes ADD PRIMARY KEY (id)';
        RAISE NOTICE 'Added new primary key on friend_codes(id).';
    ELSE
        RAISE NOTICE 'No primary key constraint found. Adding primary key on friend_codes(id).';
        EXECUTE 'ALTER TABLE public.friend_codes ADD PRIMARY KEY (id)';
    END IF;
END $$;

-- --------------------------------------------------------------------------------------
-- SECTION 4: DETERMINISTIC DUPLICATE DEACTIVATION & QUARANTINE
-- --------------------------------------------------------------------------------------
-- Selection priority for surviving active code:
--   1. REGISTERED identity_type takes priority over GUEST
--   2. Oldest created_at takes priority (earliest active allocation)
--   3. Lowest surrogate UUID breaks ties deterministically
-- All superseded duplicates (rn > 1) are quarantined and deactivated.
WITH ranked_codes AS (
    SELECT
        id,
        code,
        identity_id,
        identity_type,
        created_at,
        ROW_NUMBER() OVER (
            PARTITION BY code
            ORDER BY
                CASE WHEN identity_type = 'REGISTERED' THEN 0 ELSE 1 END ASC,
                created_at ASC,
                id ASC
        ) AS rn
    FROM public.friend_codes
    WHERE is_active = TRUE
),
duplicates_to_deactivate AS (
    SELECT id, code, identity_id, identity_type, created_at
    FROM ranked_codes
    WHERE rn > 1
),
quarantine_insert AS (
    INSERT INTO public._migration_deactivated_duplicate_codes (
        friend_code_id,
        code,
        identity_id,
        identity_type,
        created_at,
        deactivated_at,
        reason
    )
    SELECT
        d.id,
        d.code,
        d.identity_id,
        d.identity_type,
        d.created_at,
        NOW(),
        'Duplicate active 6-digit code deactivated during Task 2.1 migration'
    FROM duplicates_to_deactivate d
    ON CONFLICT (friend_code_id) DO NOTHING
    RETURNING friend_code_id
)
UPDATE public.friend_codes f
SET
    is_active = FALSE,
    revoked_at = COALESCE(f.revoked_at, NOW())
FROM duplicates_to_deactivate d
WHERE f.id = d.id;

-- --------------------------------------------------------------------------------------
-- SECTION 5: SCOPED PROFILES SELECTIVE REPAIR
-- --------------------------------------------------------------------------------------
-- Nullify profiles.friend_code ONLY for registered identities whose active mapping was
-- specifically deactivated in Section 4, avoiding any collateral mutation of valid identities.
UPDATE public.profiles p
SET friend_code = NULL
FROM public._migration_deactivated_duplicate_codes q
WHERE p.id::text = q.identity_id
  AND p.friend_code = q.code
  AND q.identity_type = 'REGISTERED'
  AND NOT EXISTS (
      SELECT 1
      FROM public.friend_codes f2
      WHERE f2.identity_id = p.id::text
        AND f2.code = p.friend_code
        AND f2.is_active = TRUE
  );

-- --------------------------------------------------------------------------------------
-- SECTION 6: SELECTIVE CONFLICT CLEANUP & PARTIAL UNIQUE INDEX CREATION
-- --------------------------------------------------------------------------------------
-- Drop ONLY unique constraints and indexes whose definitions conflict with the intended
-- reusable friend-code design (i.e. unconditional uniqueness on key column 'code' preventing recycling).
-- Uses pg_index.indnkeyatts and indnatts to distinguish actual index key columns from INCLUDE columns,
-- and detects expression keys (attnum = 0) without silent omission.
-- Preserves all unrelated constraints, unrelated indexes, and indexes owned by constraints.
DO $$
DECLARE
    r RECORD;
BEGIN
    -- 6.1 Drop only unique constraints strictly on ('code')
    FOR r IN
        SELECT c.conname,
               (
                   SELECT array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum))
                   FROM unnest(c.conkey) AS u(attnum)
                   JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
               ) AS cols
        FROM pg_constraint c
        WHERE c.conrelid = 'public.friend_codes'::regclass
          AND c.contype = 'u'
    LOOP
        IF r.cols = ARRAY['code'] THEN
            RAISE NOTICE 'Dropping conflicting unconditional unique constraint "%" on friend_codes(code).', r.conname;
            EXECUTE format('ALTER TABLE public.friend_codes DROP CONSTRAINT %I', r.conname);
        ELSE
            RAISE NOTICE 'Preserving unrelated unique constraint "%" on friend_codes(%).', r.conname, array_to_string(r.cols, ', ');
        END IF;
    END LOOP;

    -- 6.2 Drop only standalone unique indexes whose KEY columns are strictly ('code') that conflict with recycling
    FOR r IN
        SELECT
            ci.oid AS index_oid,
            ci.relname AS index_name,
            i.indnkeyatts,
            i.indnatts,
            bool_or(u.attnum = 0) FILTER (WHERE u.ord <= i.indnkeyatts) AS has_expression_key,
            (
                SELECT array_agg(
                    CASE WHEN u_key.attnum = 0 THEN '<EXPR>' ELSE a_key.attname::text END
                    ORDER BY u_key.ord
                )
                FROM unnest(string_to_array(i.indkey::text, ' ')::smallint[]) WITH ORDINALITY AS u_key(attnum, ord)
                LEFT JOIN pg_attribute a_key ON a_key.attrelid = i.indrelid AND a_key.attnum = u_key.attnum
                WHERE u_key.ord <= i.indnkeyatts
            ) AS key_cols,
            (
                SELECT array_agg(
                    CASE WHEN u_inc.attnum = 0 THEN '<EXPR>' ELSE a_inc.attname::text END
                    ORDER BY u_inc.ord
                )
                FROM unnest(string_to_array(i.indkey::text, ' ')::smallint[]) WITH ORDINALITY AS u_inc(attnum, ord)
                LEFT JOIN pg_attribute a_inc ON a_inc.attrelid = i.indrelid AND a_inc.attnum = u_inc.attnum
                WHERE u_inc.ord > i.indnkeyatts
            ) AS included_cols,
            pg_get_expr(i.indpred, i.indrelid) AS predicate
        FROM pg_index i
        JOIN pg_class ci ON ci.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = ci.relnamespace
        CROSS JOIN LATERAL unnest(string_to_array(i.indkey::text, ' ')::smallint[]) WITH ORDINALITY AS u(attnum, ord)
        WHERE i.indrelid = 'public.friend_codes'::regclass
          AND i.indisunique = TRUE
          AND n.nspname = 'public'
          -- Exclude table constraints already handled in 6.1
          AND NOT EXISTS (
              SELECT 1 FROM pg_constraint c
              WHERE c.conindid = i.indexrelid
          )
        GROUP BY ci.oid, ci.relname, i.indnkeyatts, i.indnatts, i.indkey, i.indpred, i.indrelid
    LOOP
        -- If the index key contains expressions (attnum = 0):
        IF COALESCE(r.has_expression_key, FALSE) THEN
            -- Check if expression references 'code'
            IF pg_get_indexdef(r.index_oid) ILIKE '%code%' THEN
                RAISE EXCEPTION 'Safety check failed: found unique expression index "%" referencing "code" (definition: %). Manual review required to avoid misclassifying expression-based uniqueness.',
                    r.index_name, pg_get_indexdef(r.index_oid);
            ELSE
                RAISE NOTICE 'Preserving unrelated unique expression index "%" on friend_codes (definition: %).',
                    r.index_name, pg_get_indexdef(r.index_oid);
            END IF;

        -- Ordinary column key: check if the actual uniqueness key is strictly ('code')
        ELSIF r.key_cols = ARRAY['code'] THEN
            -- An index whose key is 'code' enforces uniqueness on 'code' regardless of any included columns.
            -- Determine whether its complete definition matches the intended partial index:
            -- 1. Named 'idx_friend_codes_active_code'
            -- 2. No extra included columns (indnkeyatts = indnatts = 1)
            -- 3. Normalized predicate is exactly '(is_active = true)'
            IF r.index_name = 'idx_friend_codes_active_code'
               AND r.indnkeyatts = 1
               AND r.indnatts = 1
               AND r.included_cols IS NULL
               AND r.predicate IS NOT NULL
               AND lower(replace(r.predicate, ' ', '')) = '(is_active=true)' THEN
                RAISE NOTICE 'Preserving existing matching partial unique index "%" on friend_codes(code).', r.index_name;
            ELSE
                RAISE NOTICE 'Dropping conflicting unique index "%" on friend_codes (key: %, included: %, predicate: %).',
                    r.index_name,
                    r.key_cols,
                    COALESCE(array_to_string(r.included_cols, ', '), 'NONE'),
                    COALESCE(r.predicate, 'NONE (unconditional)');
                EXECUTE format('DROP INDEX public.%I', r.index_name);
            END IF;
        ELSE
            RAISE NOTICE 'Preserving unrelated unique index "%" on friend_codes (keys: %, included: %).',
                r.index_name,
                r.key_cols,
                COALESCE(array_to_string(r.included_cols, ', '), 'NONE');
        END IF;
    END LOOP;
END $$;

-- 6.3 Create intended partial unique index and identity lookup index
CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_codes_active_code
    ON public.friend_codes(code)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_friend_codes_identity
    ON public.friend_codes(identity_id);

-- --------------------------------------------------------------------------------------
-- SECTION 7: GUEST_SESSIONS SECRET_HASH UPGRADE & LEGACY SANITIZATION
-- --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_sessions (
    id TEXT PRIMARY KEY,
    friend_code VARCHAR(6) NOT NULL,
    secret_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    revoked_at TIMESTAMPTZ NULL
);

ALTER TABLE public.guest_sessions ADD COLUMN IF NOT EXISTS secret_hash TEXT;

-- Deactivate legacy unauthenticated sessions without cryptographic secret hash
UPDATE public.guest_sessions
SET
    is_active = FALSE,
    revoked_at = COALESCE(revoked_at, NOW())
WHERE secret_hash IS NULL AND is_active = TRUE;

-- Populate sentinel tombstone for historical legacy records to satisfy NOT NULL
UPDATE public.guest_sessions
SET secret_hash = 'LEGACY_REVOKED_NO_SECRET'
WHERE secret_hash IS NULL;

ALTER TABLE public.guest_sessions ALTER COLUMN secret_hash SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guest_sessions_code ON public.guest_sessions(friend_code);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_active ON public.guest_sessions(id) WHERE is_active = TRUE;

-- --------------------------------------------------------------------------------------
-- SECTION 8: ROW LEVEL SECURITY, GRANULAR POLICY REVIEW & PRIVILEGE LOCKDOWN
-- --------------------------------------------------------------------------------------
-- Enable RLS on all 3 tables
ALTER TABLE public.friend_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._migration_deactivated_duplicate_codes ENABLE ROW LEVEL SECURITY;

-- 8.1 Granular Policy Inspection & Remediation
-- Inspects roles, command, permissive/restrictive mode, and expressions before modifying any policy.
-- Re-scopes multi-role policies to service_role, drops known template/wide-open client policies,
-- preserves authorized service_role policies, and aborts safely if an unrecognized policy cannot be determined.
DO $$
DECLARE
    r RECORD;
    v_has_client_role BOOLEAN;
    v_has_service_role BOOLEAN;
    v_is_wide_open BOOLEAN;
    v_is_template_name BOOLEAN;
BEGIN
    FOR r IN
        SELECT schemaname, tablename, policyname, roles, cmd, permissive, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('friend_codes', 'guest_sessions', '_migration_deactivated_duplicate_codes')
    LOOP
        v_has_client_role := ('public' = ANY(r.roles) OR 'anon' = ANY(r.roles) OR 'authenticated' = ANY(r.roles));
        v_has_service_role := ('service_role' = ANY(r.roles));
        v_is_wide_open := (r.permissive = 'PERMISSIVE' AND (r.qual = 'true' OR r.with_check = 'true' OR (r.qual IS NULL AND r.with_check IS NULL)));
        v_is_template_name := (r.policyname ILIKE 'allow public%' OR r.policyname ILIKE 'enable read access for all users%');

        -- Case 1: Pure service_role / internal policy without client access -> Preserve as-is
        IF v_has_service_role AND NOT v_has_client_role THEN
            RAISE NOTICE 'Preserving authorized service-role policy "%" on %.% (cmd: %, permissive: %).',
                r.policyname, r.schemaname, r.tablename, r.cmd, r.permissive;

        -- Case 2: Multi-role policy combining service_role with client roles -> Re-scope to service_role only
        ELSIF v_has_service_role AND v_has_client_role THEN
            RAISE NOTICE 'Re-scoping policy "%" on %.% to service_role only (removing client roles: %).',
                r.policyname, r.schemaname, r.tablename, array_to_string(r.roles, ', ');
            EXECUTE format('ALTER POLICY %I ON %I.%I TO service_role', r.policyname, r.schemaname, r.tablename);

        -- Case 3: Known template boilerplate or wide-open permissive client policy -> Safe to drop
        ELSIF v_has_client_role AND (v_is_template_name OR v_is_wide_open) THEN
            RAISE NOTICE 'Dropping unintended client access policy "%" on %.% (roles: %, cmd: %, qual: %, with_check: %).',
                r.policyname, r.schemaname, r.tablename, array_to_string(r.roles, ', '), r.cmd, COALESCE(r.qual, 'NONE'), COALESCE(r.with_check, 'NONE');
            EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);

        -- Case 4: Policy does not target client roles (custom internal role) -> Preserve
        ELSIF NOT v_has_client_role THEN
            RAISE NOTICE 'Preserving unrelated internal policy "%" on %.% (roles: %, cmd: %).',
                r.policyname, r.schemaname, r.tablename, array_to_string(r.roles, ', '), r.cmd;

        -- Case 5: Unrecognized client policy with custom conditional expressions -> Abort safely
        ELSE
            RAISE EXCEPTION 'Safety check failed: cannot automatically determine safe resolution for unrecognized client policy "%" on %.% (roles: %, cmd: %, permissive: %, qual: %, with_check: %). Manual operator review required to prevent unintended policy loss.',
                r.policyname, r.schemaname, r.tablename, array_to_string(r.roles, ', '), r.cmd, r.permissive, COALESCE(r.qual, 'NONE'), COALESCE(r.with_check, 'NONE');
        END IF;
    END LOOP;
END $$;

-- 8.2 Revoke table privileges from PUBLIC, anon, and authenticated roles
REVOKE ALL ON TABLE public.friend_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.friend_codes TO service_role;

REVOKE ALL ON TABLE public.guest_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.guest_sessions TO service_role;

REVOKE ALL ON TABLE public._migration_deactivated_duplicate_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public._migration_deactivated_duplicate_codes TO service_role;

-- 8.3 Ensure dedicated service-role full access policy exists for each table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'friend_codes'
          AND policyname = 'Service role full access friend_codes'
    ) THEN
        CREATE POLICY "Service role full access friend_codes"
            ON public.friend_codes
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'guest_sessions'
          AND policyname = 'Service role full access guest_sessions'
    ) THEN
        CREATE POLICY "Service role full access guest_sessions"
            ON public.guest_sessions
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = '_migration_deactivated_duplicate_codes'
          AND policyname = 'Service role full access quarantine'
    ) THEN
        CREATE POLICY "Service role full access quarantine"
            ON public._migration_deactivated_duplicate_codes
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

-- 8.4 Explicit Verification: Verify resulting policy configuration and effective table privileges
DO $$
DECLARE
    v_tbl TEXT;
    v_role TEXT;
    v_priv TEXT;
    v_has_priv BOOLEAN;
    v_unauthorized_policy RECORD;
    v_public_privs TEXT;
BEGIN
    -- A. Verify that no permissive client-accessible policies remain
    SELECT schemaname, tablename, policyname, roles
    INTO v_unauthorized_policy
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('friend_codes', 'guest_sessions', '_migration_deactivated_duplicate_codes')
      AND permissive = 'PERMISSIVE'
      AND ('public' = ANY(roles) OR 'anon' = ANY(roles) OR 'authenticated' = ANY(roles))
    LIMIT 1;

    IF v_unauthorized_policy IS NOT NULL THEN
        RAISE EXCEPTION 'Policy verification failed: unauthorized client policy "%" on %.% still grants access to roles (%).',
            v_unauthorized_policy.policyname, v_unauthorized_policy.schemaname, v_unauthorized_policy.tablename, array_to_string(v_unauthorized_policy.roles, ', ');
    END IF;

    -- B. Verify each table has an active policy for service_role
    FOR v_tbl IN SELECT unnest(ARRAY['friend_codes', 'guest_sessions', '_migration_deactivated_duplicate_codes']) LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = v_tbl
              AND 'service_role' = ANY(roles)
        ) THEN
            RAISE EXCEPTION 'Policy verification failed: table "public.%" has no active RLS policy for service_role.', v_tbl;
        END IF;
    END LOOP;

    -- C. Verify table privileges
    FOR v_tbl IN SELECT unnest(ARRAY['friend_codes', 'guest_sessions', '_migration_deactivated_duplicate_codes']) LOOP
        -- 1. Direct grants to PUBLIC via PostgreSQL catalog ACL (grantee = 0 in aclexplode)
        SELECT string_agg(a.privilege_type, ', ')
        INTO v_public_privs
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE n.nspname = 'public'
          AND c.relname = v_tbl
          AND a.grantee = 0
          AND a.privilege_type = ANY(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']);

        IF v_public_privs IS NOT NULL THEN
            RAISE EXCEPTION 'Privilege verification failed: direct grant to PUBLIC still retains privilege(s) [%] on public.%.',
                v_public_privs, v_tbl;
        END IF;

        -- 2. Effective privileges for anon & authenticated (if present in pg_roles) must be FALSE
        FOR v_role IN SELECT unnest(ARRAY['anon', 'authenticated']) LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
                FOR v_priv IN SELECT unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) LOOP
                    SELECT has_table_privilege(v_role, format('public.%I', v_tbl), v_priv) INTO v_has_priv;
                    IF v_has_priv THEN
                        RAISE EXCEPTION 'Privilege verification failed: role "%" retains effective % privilege on public.%.',
                            v_role, v_priv, v_tbl;
                    END IF;
                END LOOP;
            END IF;
        END LOOP;

        -- 3. Effective privileges for service_role (if present in pg_roles) must be TRUE
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
            FOR v_priv IN SELECT unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) LOOP
                SELECT has_table_privilege('service_role', format('public.%I', v_tbl), v_priv) INTO v_has_priv;
                IF NOT v_has_priv THEN
                    RAISE EXCEPTION 'Privilege verification failed: role "service_role" lacks % privilege on public.%.',
                        v_priv, v_tbl;
                END IF;
            END LOOP;
        END IF;
    END LOOP;

    RAISE NOTICE 'RLS policy configuration and effective table privileges successfully verified for all tables.';
END $$;

-- --------------------------------------------------------------------------------------
-- SECTION 9: AUTOMATED POST-MIGRATION VERIFICATION ASSERTIONS
-- --------------------------------------------------------------------------------------
DO $$
DECLARE
    v_dup_count INTEGER;
    v_dangling_count INTEGER;
    v_null_hash_count INTEGER;
    v_pk_cols TEXT[];
    v_idx_record RECORD;
BEGIN
    -- 9.1 Assert 0 duplicate active friend codes
    SELECT COUNT(*)
    INTO v_dup_count
    FROM (
        SELECT code
        FROM public.friend_codes
        WHERE is_active = TRUE
        GROUP BY code
        HAVING COUNT(*) > 1
    ) sub;

    IF v_dup_count > 0 THEN
        RAISE EXCEPTION 'Post-migration assertion failed: % active code collision(s) still exist.', v_dup_count;
    END IF;

    -- 9.2 Assert 0 dangling or mismatched active profiles
    SELECT COUNT(*)
    INTO v_dangling_count
    FROM public.profiles p
    WHERE p.friend_code IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.friend_codes fc
          WHERE fc.code = p.friend_code
            AND fc.identity_id = p.id::text
            AND fc.identity_type = 'REGISTERED'
            AND fc.is_active = TRUE
      );

    IF v_dangling_count > 0 THEN
        RAISE EXCEPTION 'Post-migration assertion failed: % profile(s) have dangling/mismatched friend_code mappings.', v_dangling_count;
    END IF;

    -- 9.3 Assert 0 guest_sessions with NULL or blank secret_hash
    SELECT COUNT(*)
    INTO v_null_hash_count
    FROM public.guest_sessions
    WHERE secret_hash IS NULL OR secret_hash = '';

    IF v_null_hash_count > 0 THEN
        RAISE EXCEPTION 'Post-migration assertion failed: % guest_session(s) have NULL or empty secret_hash.', v_null_hash_count;
    END IF;

    -- 9.4 Assert friend_codes primary key is exactly on single column ('id')
    SELECT array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum))
    INTO v_pk_cols
    FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
    WHERE c.conrelid = 'public.friend_codes'::regclass
      AND c.contype = 'p';

    IF v_pk_cols IS NULL OR v_pk_cols <> ARRAY['id'] THEN
        RAISE EXCEPTION 'Post-migration assertion failed: friend_codes primary key columns (%) do not match expected ("id").', COALESCE(v_pk_cols::text, 'NONE');
    END IF;

    -- 9.5 Verify the complete definition of idx_friend_codes_active_code:
    --     Must exist, must be UNIQUE, indnkeyatts = 1, indnatts = 1,
    --     no expression keys (has_expression_key = FALSE),
    --     key column strictly ('code'), no unexpected INCLUDE columns,
    --     and partial predicate strictly (is_active = true).
    SELECT
        i.indisunique,
        i.indnkeyatts,
        i.indnatts,
        bool_or(u.attnum = 0) FILTER (WHERE u.ord <= i.indnkeyatts) AS has_expression_key,
        (
            SELECT array_agg(
                CASE WHEN u_key.attnum = 0 THEN '<EXPR>' ELSE a_key.attname::text END
                ORDER BY u_key.ord
            )
            FROM unnest(string_to_array(i.indkey::text, ' ')::smallint[]) WITH ORDINALITY AS u_key(attnum, ord)
            LEFT JOIN pg_attribute a_key ON a_key.attrelid = i.indrelid AND a_key.attnum = u_key.attnum
            WHERE u_key.ord <= i.indnkeyatts
        ) AS key_cols,
        (
            SELECT array_agg(
                CASE WHEN u_inc.attnum = 0 THEN '<EXPR>' ELSE a_inc.attname::text END
                ORDER BY u_inc.ord
            )
            FROM unnest(string_to_array(i.indkey::text, ' ')::smallint[]) WITH ORDINALITY AS u_inc(attnum, ord)
            LEFT JOIN pg_attribute a_inc ON a_inc.attrelid = i.indrelid AND a_inc.attnum = u_inc.attnum
            WHERE u_inc.ord > i.indnkeyatts
        ) AS included_cols,
        pg_get_expr(i.indpred, i.indrelid) AS predicate
    INTO v_idx_record
    FROM pg_index i
    JOIN pg_class ci ON ci.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = ci.relnamespace
    CROSS JOIN LATERAL unnest(string_to_array(i.indkey::text, ' ')::smallint[]) WITH ORDINALITY AS u(attnum, ord)
    WHERE n.nspname = 'public'
      AND ci.relname = 'idx_friend_codes_active_code'
      AND i.indrelid = 'public.friend_codes'::regclass
    GROUP BY i.indisunique, i.indnkeyatts, i.indnatts, i.indkey, i.indpred, i.indrelid;

    IF v_idx_record IS NULL THEN
        RAISE EXCEPTION 'Post-migration assertion failed: index "idx_friend_codes_active_code" does not exist on public.friend_codes.';
    END IF;

    IF NOT v_idx_record.indisunique THEN
        RAISE EXCEPTION 'Post-migration assertion failed: index "idx_friend_codes_active_code" is not UNIQUE.';
    END IF;

    IF COALESCE(v_idx_record.has_expression_key, FALSE) THEN
        RAISE EXCEPTION 'Post-migration assertion failed: index "idx_friend_codes_active_code" contains expression keys.';
    END IF;

    IF v_idx_record.indnkeyatts <> 1 OR v_idx_record.key_cols <> ARRAY['code'] THEN
        RAISE EXCEPTION 'Post-migration assertion failed: index "idx_friend_codes_active_code" key columns (%) do not match expected ("code").', array_to_string(v_idx_record.key_cols, ', ');
    END IF;

    IF v_idx_record.indnatts <> 1 OR v_idx_record.included_cols IS NOT NULL THEN
        RAISE EXCEPTION 'Post-migration assertion failed: index "idx_friend_codes_active_code" has unexpected included columns: %', array_to_string(v_idx_record.included_cols, ', ');
    END IF;

    IF v_idx_record.predicate IS NULL OR lower(replace(v_idx_record.predicate, ' ', '')) <> '(is_active=true)' THEN
        RAISE EXCEPTION 'Post-migration assertion failed: index "idx_friend_codes_active_code" predicate (%) does not match expected "(is_active = true)".', v_idx_record.predicate;
    END IF;

    RAISE NOTICE 'All post-migration assertions verified successfully.';
END $$;

COMMIT;
