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
