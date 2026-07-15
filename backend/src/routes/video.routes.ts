import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { RoomController } from '../controllers/room.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { startUploadSchema } from '../validations/room.validation.js';

const router = Router();

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// UUID-prefixed filenames to prevent concurrent upload collisions
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
router.post('/start-upload', authMiddleware, validate(startUploadSchema), RoomController.startUpload);
router.post('/upload-chunk', authMiddleware, uploadMovie.single('chunk'), RoomController.uploadChunk);
router.get('/transcode-status', authMiddleware, RoomController.transcodeStatus);
router.get('/logs', authMiddleware, RoomController.getLogs);

// Keep streaming endpoints public for <video> tags
router.get('/stream/:messageId', RoomController.streamVideo);

export default router;
