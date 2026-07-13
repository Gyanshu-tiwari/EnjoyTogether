import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import apiRouter from './routes/index.js';
import { setupSockets } from './sockets/index.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { validateEnv, getAllowedOrigins } from './config/env.js';

// ── Load .env first, then validate ────────────────────────────────────────────
dotenv.config();
// Validate early — exits process if required vars are missing.
// Skipped when SUPABASE_URL is absent (in-memory / local dev without Supabase).
if (process.env.SUPABASE_URL) {
  validateEnv();
} else {
  console.warn('⚠️  SUPABASE_URL not set — running in local in-memory mode. validateEnv() skipped.');
}

const app = express();
const httpServer = createServer(app);
const allowedOrigins = getAllowedOrigins();

// ── CORS ─────────────────────────────────────────────────────────────────────
// Whitelist only explicitly configured origins. Reject all others.
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*')) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: Origin "${origin}" is not permitted.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));
app.use(express.json());

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Heartbeat tuning — detects dropped mobile/flaky connections faster.
  pingInterval: 10_000,   // send ping every 10s (default: 25s)
  pingTimeout: 5_000,     // disconnect if no pong in 5s  (default: 20s)
  connectTimeout: 10_000,
  transports: ['websocket', 'polling'], // polling fallback for restricted networks
});

// ── HLS Static Files ──────────────────────────────────────────────────────────
const HLS_DIR = path.join(process.cwd(), 'output_hls');
app.use(
  '/api/video/hls-local',
  express.static(HLS_DIR, {
    maxAge: '1y',
    setHeaders: (res, filePath) => {
      res.set('Access-Control-Allow-Origin', '*');
      if (filePath.endsWith('.m3u8')) {
        // Playlists must never be cached — viewers need fresh segment lists
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else {
        // Individual .ts segments are immutable once written
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);

// ── Health Check ──────────────────────────────────────────────────────────────
// Used by Docker HEALTHCHECK and load-balancer probes.
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ── Sockets ───────────────────────────────────────────────────────────────────
setupSockets(io);

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use(errorMiddleware);

// ── Server Listen ─────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 5000;
const server = httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Sync mesh listening globally on port ${PORT}`);
  console.log(`🔗 Allowed CORS origins: ${allowedOrigins.join(', ')}`);
});

// No timeout for large file uploads
server.timeout = 0;
server.keepAliveTimeout = 65_000; // > most load-balancer idle timeouts (60s)

export { app, httpServer };