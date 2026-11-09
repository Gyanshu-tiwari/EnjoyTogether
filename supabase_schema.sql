-- 1. Create the rooms table
CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    movie_url TEXT DEFAULT '',
    stream_url TEXT DEFAULT '',
    is_active BOOLEAN DEFAULT FALSE,
    is_playing BOOLEAN DEFAULT FALSE,
    position DOUBLE PRECISION DEFAULT 0.0,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create the chats table
CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_name TEXT NOT NULL,
    message_text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Enable Row Level Security (RLS) optionally, or grant permissions
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies to allow public or authenticated access (adjust as needed for production)
CREATE POLICY "Allow public select rooms" ON rooms FOR SELECT USING (true);
CREATE POLICY "Allow public insert rooms" ON rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update rooms" ON rooms FOR UPDATE USING (true);
CREATE POLICY "Allow public delete rooms" ON rooms FOR DELETE USING (true);

CREATE POLICY "Allow public select chats" ON chats FOR SELECT USING (true);
CREATE POLICY "Allow public insert chats" ON chats FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update chats" ON chats FOR UPDATE USING (true);
CREATE POLICY "Allow public delete chats" ON chats FOR DELETE USING (true);

-- 5. Create the profiles table
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    username TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add username column if profiles table already exists (idempotent migration)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT DEFAULT '';

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public select profiles" ON profiles FOR SELECT USING (true);
CREATE POLICY "Allow public insert profiles" ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update profiles" ON profiles FOR UPDATE USING (true);
CREATE POLICY "Allow public delete profiles" ON profiles FOR DELETE USING (true);

-- 6. Create the friendships table
CREATE TABLE IF NOT EXISTS friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id TEXT NOT NULL,
    addressee_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_friendship UNIQUE (requester_id, addressee_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id);

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public select friendships" ON friendships FOR SELECT USING (true);
CREATE POLICY "Allow public insert friendships" ON friendships FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update friendships" ON friendships FOR UPDATE USING (true);
CREATE POLICY "Allow public delete friendships" ON friendships FOR DELETE USING (true);

-- 7. Add friend_code column to profiles (idempotent)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS friend_code VARCHAR(6) UNIQUE;

-- 8. Create the unified friend_codes table with surrogate UUID primary key and partial unique index
CREATE TABLE IF NOT EXISTS friend_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(6) NOT NULL,
    identity_id TEXT NOT NULL,
    identity_type TEXT NOT NULL CHECK (identity_type IN ('REGISTERED', 'GUEST')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NULL,
    is_active BOOLEAN DEFAULT TRUE,
    revoked_at TIMESTAMPTZ NULL
);

-- Partial unique index guarantees active uniqueness while allowing recycling of expired/revoked codes
CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_codes_active_code ON friend_codes(code) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_friend_codes_identity ON friend_codes(identity_id);

-- Enable RLS: Restrict all mutations to backend service-role only
ALTER TABLE friend_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public select friend_codes" ON friend_codes;
DROP POLICY IF EXISTS "Allow public insert friend_codes" ON friend_codes;
DROP POLICY IF EXISTS "Allow public update friend_codes" ON friend_codes;
DROP POLICY IF EXISTS "Allow public delete friend_codes" ON friend_codes;

-- 9. Create the guest_sessions table with cryptographic secret_hash
CREATE TABLE IF NOT EXISTS guest_sessions (
    id TEXT PRIMARY KEY,
    friend_code VARCHAR(6) NOT NULL,
    secret_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    revoked_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_code ON guest_sessions(friend_code);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_active ON guest_sessions(id) WHERE is_active = TRUE;

-- Enable RLS: No public anonymous read or mutation; backend service role handles all lifecycle operations
ALTER TABLE guest_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public select guest_sessions" ON guest_sessions;
DROP POLICY IF EXISTS "Allow public insert guest_sessions" ON guest_sessions;
DROP POLICY IF EXISTS "Allow public update guest_sessions" ON guest_sessions;
DROP POLICY IF EXISTS "Allow public delete guest_sessions" ON guest_sessions;
