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
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-guest-secret', 'x-guest-id'],
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
  // Heartbeat tuning — extremely tolerant to accommodate background tab throttling on browsers
  pingInterval: 25_000,   // send ping every 25s
  pingTimeout: 60_000,    // allow up to 60s for pong response (protects background tabs)
  connectTimeout: 20_000,
  transports: ['websocket', 'polling'], // polling fallback for restricted networks
});

// ── Avatars Local Static Fallback ─────────────────────────────────────────────
const AVATARS_DIR = path.join(process.cwd(), 'public', 'avatars');
app.use('/api/avatars/local', express.static(AVATARS_DIR, { maxAge: '1d' }));

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

// ── Process-Level Resilience Handlers ─────────────────────────────────────────
process.on('unhandledRejection', (reason: any) => {
  console.error('⚠️ Unhandled Promise Rejection caught at process level:', reason?.message || reason);
});

process.on('uncaughtException', (err: Error) => {
  console.error('❌ Uncaught Exception caught at process level:', err);
});

export { app, httpServer };
