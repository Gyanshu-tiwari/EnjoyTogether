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
