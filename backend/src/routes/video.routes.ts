import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { RoomController } from '../rooms/room.controller.js';

const router = Router();

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Fix #7: Use UUID-prefixed filenames to prevent concurrent upload collisions
const movieStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    const uniqueName = `upload_${crypto.randomUUID()}${ext}`;
    cb(null, uniqueName);
  },
});

const uploadMovie = multer({
  storage: movieStorage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB max
});

// Video pipeline endpoints
router.post('/start-upload', RoomController.startUpload);
router.post('/upload-chunk', uploadMovie.single('chunk'), RoomController.uploadChunk);
router.get('/transcode-status', RoomController.transcodeStatus);
router.get('/stream/:messageId', RoomController.streamVideo);

export default router;
