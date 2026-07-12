# 🍿 EnjoyTogether (Watch Stream Together)

A production-ready platform for synchronized video watching, real-time chat, and integrated WebRTC video/audio calls. 

EnjoyTogether ensures that no matter where your friends are, your video playback is perfectly synced. With built-in Role-Based Access Control (RBAC), room hosts can seamlessly manage permissions, granting co-hosts the ability to control media and share their camera/microphone on the fly.

## 🚀 Features
- **Perfect Sync Engine**: Real-time HLS video playback synchronization via WebSockets.
- **WebRTC Voice & Video**: Integrated LiveKit mesh allowing hosts and co-hosts to share camera and microphone seamlessly.
- **Role-Based Access Control (RBAC)**: Distinct permissions for `Host`, `Co-Host`, and `Viewer`. Real-time authorization prevents viewers from hijacking media controls.
- **Real-Time Chat**: Live socket-based chat overlay with emoji support.
- **Dynamic Transcoding**: Backend safely transcodes and chunks media files using `ffmpeg`, ensuring smooth HLS streaming on all devices.
- **Zero-Localhost Architecture**: 100% decoupled frontend and backend ready for distributed cloud deployment.

## 🛠️ Tech Stack
- **Frontend**: React 18, Vite, Tailwind CSS, LiveKit Client SDK, Socket.io-client.
- **Backend**: Node.js, Express, Socket.io, LiveKit Server SDK, FFmpeg, TypeScript.
- **Database & Auth**: Supabase (PostgreSQL, Row Level Security, Magic Link / OAuth).
- **Video Infrastructure**: HLS (HTTP Live Streaming), LiveKit Cloud (WebRTC).

---

## 📂 Project Structure (Monorepo)
The project is structured as a monorepo containing two isolated services:

```text
watch_stream_together/
├── frontend/       # React / Vite SPA
│   ├── src/
│   └── .env
└── backend/        # Node.js / Express / Socket.io Server
    ├── src/
    ├── Dockerfile
    └── .env
```

---

## 💻 Local Development

### 1. Prerequisites
- **Node.js** (v22+)
- **Docker** (For local LiveKit testing and Backend containerization)
- **FFmpeg** installed on your host machine (if running backend outside Docker)
- **Supabase** Project (for Auth and Database)
- **LiveKit** Cloud or Local Server
- **Telegram** API Keys (for backend range proxy)

### 2. Backend Setup
```bash
cd backend
npm install
```
Create a `backend/.env` file:
```env
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
LIVEKIT_API_KEY=your_livekit_key
LIVEKIT_API_SECRET=your_livekit_secret
LIVEKIT_URL=wss://your-project.livekit.cloud
TELEGRAM_API_ID=your_telegram_api_id
TELEGRAM_API_HASH=your_telegram_api_hash
TELEGRAM_STRING_SESSION=your_telegram_string_session
CORS_ORIGIN=http://localhost:5173
BACKEND_URL=http://localhost:5000
```
Run the backend:
```bash
# Development Mode
npm run dev

# Or build and run via Docker
docker build -t enjoytogether-backend .
docker run -p 5000:5000 --env-file .env enjoytogether-backend
```

### 3. Frontend Setup
```bash
cd frontend
npm install
```
Create a `frontend/.env` file:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_BACKEND_URL=http://localhost:5000
VITE_TMDB_ACCESS_TOKEN=your_tmdb_token
```
Run the frontend:
```bash
npm run dev
```

---
*Built with ❤️ for watch parties.*
