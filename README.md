# 🍿 EnjoyTogether (Watch Stream Together)

A modern, local-first platform for synchronized video watching, real-time chat, and integrated WebRTC video/audio calls.

EnjoyTogether lets friends watch videos together with perfect playback synchronization without needing to upload huge video files to a server. The host selects a local video file from their computer, which is streamed peer-to-peer via **WebRTC**, while WebSocket signaling keeps everyone's play, pause, and seek positions in sync.

---

## 🚀 Key Features

- **Local-First WebRTC Streaming**: The host streams media directly from their local device. No server-side transcoding, no cloud storage costs, and zero upload wait times.
- **Perfect Sync Engine**: Real-time playback synchronization (play, pause, seek, drift correction) via WebSockets.
- **Integrated Video & Voice Calls**: WebRTC mesh powered by LiveKit for smooth camera and microphone communication during watch parties.
- **Friend Codes & Instant Lookup**: Unique 6-digit codes allow users and guests to easily connect and invite each other without exchanging emails.
- **Guest Sessions**: Frictionless access allowing friends to join watch parties as temporary guests without creating an account.
- **Global Real-Time Invitations**: In-app notification system with instant alerts, allowing recipients to accept invitations and jump straight into rooms.
- **Host Admission Control**: Pre-join lobby with knocking mechanism and real-time host admission alerts (approve, reject, kick, role management).
- **Role-Based Access Control (RBAC)**: Distinct permissions for `Host`, `Co-Host`, and `Viewer` to prevent unauthorized playback control.
- **Real-Time Social Interaction**: Live chat overlay and floating emoji reactions.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, LiveKit Client SDK, Socket.io-client, Lucide Icons, Framer Motion.
- **Backend**: Node.js (v22+), Express, Socket.io, LiveKit Server SDK, TypeScript.
- **Database & Auth**: Supabase (PostgreSQL, Row Level Security, Magic Link & Google OAuth).
- **Video Infrastructure**: Browser WebRTC (`captureStream`), LiveKit Cloud (WebRTC video/voice calls).

---

## 📂 Project Structure

```text
watch_stream_together/
├── frontend/             # React / Vite Single Page Application
│   ├── src/
│   │   ├── features/     # Feature-sliced modules (theater, friends, auth, invitations)
│   │   ├── shared/       # Shared UI components and utilities
│   │   └── pages/        # Route views (Landing, Room, Profile)
│   └── package.json
├── backend/              # Node.js / Express / Socket.io Signaling Server
│   ├── src/
│   │   ├── controllers/  # Route controllers (rooms, friends, auth)
│   │   ├── sockets/      # Socket.io signaling & notification handlers
│   │   └── repositories/ # Database & in-memory repositories
│   └── package.json
├── supabase/             # Supabase CLI database migrations
│   └── migrations/
└── supabase_schema.sql   # Consolidated database bootstrap schema
```

---

## 💻 Local Development Setup

### 1. Prerequisites
- **Node.js** (v22+)
- **npm** (v10+)
- **Supabase** account (Free tier)
- **LiveKit** Cloud account (Free tier for audio/video calls)

---

### 2. Database Setup

You can set up the database using either the consolidated SQL schema or the Supabase CLI:

- **Option A (Quickest - Supabase Dashboard)**:
  1. Open your Supabase project's **SQL Editor**.
  2. Copy and paste the contents of [`supabase_schema.sql`](./supabase_schema.sql).
  3. Click **Run** to provision all tables, indexes, and Row Level Security (RLS) policies.

- **Option B (Supabase CLI)**:
  ```bash
  supabase db push
  ```

---

### 3. Backend Setup

```bash
cd backend
npm install
```

Create a `backend/.env` file:
```env
PORT=5000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_secret_key
LIVEKIT_API_KEY=your_livekit_key
LIVEKIT_API_SECRET=your_livekit_secret
LIVEKIT_URL=wss://your-project.livekit.cloud
CORS_ORIGIN=http://localhost:5173
BACKEND_URL=http://localhost:5000
```

Start the backend development server:
```bash
npm run dev
```

---

### 4. Frontend Setup

```bash
cd frontend
npm install
```

Create a `frontend/.env` file:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_public_key
VITE_BACKEND_URL=http://localhost:5000
```

Start the frontend development server:
```bash
npm run dev
```

Visit `http://localhost:5173` in your browser.

---

## 🚢 Deployment

- **Backend**: Containerized via [`backend/Dockerfile`](./backend/Dockerfile), deployable to **Railway**, Render, or Fly.io.
- **Frontend**: Single-page application deployable to **Vercel** or Netlify with SPA fallback (`vercel.json` included).
- **Database**: Managed **Supabase** PostgreSQL instance.

---

*Built with ❤️ for watch parties.*
