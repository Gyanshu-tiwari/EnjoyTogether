import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import apiRouter from './routes/index.js';
import { setupSockets } from './sockets/index.js';
import { errorMiddleware } from './middleware/error.middleware.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json());

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Serve the static HLS manifest tracks safely
const HLS_DIR = path.join(process.cwd(), 'output_hls');
app.use(
  '/api/video/hls-local',
  express.static(HLS_DIR, {
    maxAge: '1y',
    setHeaders: (res, filePath) => {
      res.set('Access-Control-Allow-Origin', '*');
      if (filePath.endsWith('.m3u8')) {
        res.set('Cache-Control', 'no-cache');
      } else {
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);

// Register Express routes
app.use('/api', apiRouter);

// Register Socket.io events
setupSockets(io);

// Global Error Handler Middleware
app.use(errorMiddleware);

const PORT = Number(process.env.PORT) || 5000;
const server = httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Sync mesh listening globally on port ${PORT}`);
});

// Disable server request timeouts completely for large file uploads
server.timeout = 0;
server.keepAliveTimeout = 0;
export { app, httpServer };