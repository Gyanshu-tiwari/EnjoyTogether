import type { Request, Response, NextFunction } from 'express';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { AppError } from '../utils/appError.js';
import { RoomRepository } from '../repositories/room.repository.js';

// __dirname equivalent for ESM modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const activeUploads = new Map<string, Set<number>>();

export class RoomController {
  // ── Room Lifecycle ─────────────────────────────────────────────────────────

  static async createRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { hostId, movieUrl, mediaName } = req.body;
      const roomId = crypto.randomUUID();
      const actualHostId = req.user?.id || hostId || 'default-host-id';
      const metadata = await RoomRepository.createRoom(
        roomId,
        actualHostId,
        movieUrl || ''
      );

      // If a local media name is provided at creation time, store it
      if (mediaName) {
        await RoomRepository.updateRoomState(roomId, {
          mediaName,
          mediaSourceType: 'local'
        });
      }

      // createRoom() already calls assignRoomHost() internally
      res.status(201).json({ success: true, roomId, metadata });
    } catch (error) {
      next(new AppError('Failed to create a new watch room.', 500));
    }
  }

  static async getMetadata(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      if (!roomId) return next(new AppError('Missing room identifier parameter.', 400));
      const cleanRoomId = (Array.isArray(roomId) ? roomId[0] : roomId) as string;
      const metadata = await RoomRepository.getRoomMetadata(cleanRoomId);
      res.status(200).json({ success: true, metadata });
    } catch (error) {
      next(new AppError('Failed to retrieve room metadata.', 500));
    }
  }

  static async toggleActiveStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId, isActive } = req.body;
      if (!roomId) return next(new AppError('Missing room identifier parameter.', 400));
      if (typeof isActive !== 'boolean') return next(new AppError('Missing or invalid isActive flag.', 400));
      await RoomRepository.setSessionActiveStatus(roomId, isActive);
      res.status(200).json({ success: true, roomId, isActive });
    } catch (error) {
      next(new AppError('Failed to toggle room active status.', 500));
    }
  }

  // ── Video Upload Pipeline ──────────────────────────────────────────────────

  static async startUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // ── Zombie Process Cleanup (with grace period) ─────────────────────────
      // Kill any leftover ffmpeg/transcoder processes from a previous aborted session.
      // The 3s delay ensures the kill command doesn't race against a legitimately
      // running transcoder that was spawned by the final chunk of the previous upload.
      setTimeout(() => {
        exec('pkill -f ffmpeg', () => {});
        exec('pkill -f transcodeAndUpload', () => {});
      }, 3000);

      const { fileId } = req.body;
      const safeFileId = fileId ? path.basename(fileId).replace(/[^a-zA-Z0-9_-]/g, '') : null;
      // Write per-fileId status file so concurrent uploads track independently.
      // Also write the shared file for backwards compatibility.
      const payload = JSON.stringify({ status: 'uploading', progress: 0, eta: 'Uploading...', speed: '0x' }, null, 2);
      if (safeFileId) {
        fs.writeFileSync(path.join(process.cwd(), `transcode_status_${safeFileId}.json`), payload);
      }
      fs.writeFileSync(path.join(process.cwd(), 'transcode_status.json'), payload);
      res.status(200).json({ success: true });
    } catch (error) {
      next(new AppError('Failed to initialize upload status.', 500));
    }
  }

  static async uploadChunk(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.file) return next(new AppError('Missing binary payload stream fields.', 400));

      const chunkIndex = parseInt(req.body.chunkIndex, 10);
      const totalChunks = parseInt(req.body.totalChunks, 10);
      const rawFileId = req.body.fileId;
      const rawFileName: string = req.body.name || req.file.originalname || 'upload';

      if (isNaN(chunkIndex) || isNaN(totalChunks) || !rawFileId) {
        return next(new AppError('Missing chunking metadata.', 400));
      }

      // Security: Sanitize fileId and file extension to prevent directory traversal
      const safeFileId = path.basename(rawFileId).replace(/[^a-zA-Z0-9_-]/g, '');
      if (!safeFileId) {
        return next(new AppError('Invalid file identifier parameter.', 400));
      }

      // Preserve the sanitized original file extension so ffprobe identifies the container correctly
      const safeExt = path.extname(path.basename(rawFileName)).toLowerCase().replace(/[^a-zA-Z0-9.]/g, '') || '.mp4';
      const uploadedChunkPath = req.file.path;
      const targetFilePath = path.join(process.cwd(), 'uploads', `${safeFileId}${safeExt}`);
      const chunkFilePath = `${targetFilePath}.part${chunkIndex}`;

      // Rename multer temp file to the specific chunk file
      fs.renameSync(uploadedChunkPath, chunkFilePath);

      // Track received chunks
      if (!activeUploads.has(safeFileId)) {
        activeUploads.set(safeFileId, new Set<number>());
      }
      activeUploads.get(safeFileId)!.add(chunkIndex);

      console.log(`🚀 Chunk ${chunkIndex + 1}/${totalChunks} received for file ${safeFileId}`);

      // Check if all chunks have been received
      if (activeUploads.get(safeFileId)!.size === totalChunks) {
        console.log(`✅ All chunks received. Assembling file: ${targetFilePath}`);

        // Assemble chunks in order
        const writeStream = fs.createWriteStream(targetFilePath);
        for (let i = 0; i < totalChunks; i++) {
          const partPath = `${targetFilePath}.part${i}`;
          if (fs.existsSync(partPath)) {
            const data = fs.readFileSync(partPath);
            writeStream.write(data);
            fs.unlinkSync(partPath); // Clean up chunk
          }
        }
        writeStream.end();

        activeUploads.delete(safeFileId);

        // Wait for assemble to finish before launching transcoder
        writeStream.on('finish', () => {
          console.log(`🎬 File assembled. Launching transcoder pipeline for: ${targetFilePath}`);

          // Resolve script path relative to THIS compiled file's directory (__dirname).
          const isDev = process.env.NODE_ENV !== 'production';
          const jsScript = path.resolve(__dirname, '../utils/transcodeAndUpload.js');
          const tsScript = path.resolve(__dirname, '../utils/transcodeAndUpload.ts');

          const useTsx = isDev && fs.existsSync(tsScript);
          const cmd = useTsx ? 'npx' : 'node';
          const args = useTsx ? ['tsx', tsScript, targetFilePath, safeFileId] : [jsScript, targetFilePath, safeFileId];

          // Ensure output_hls dir exists before opening log file
          const hlsDir = path.join(process.cwd(), 'output_hls');
          if (!fs.existsSync(hlsDir)) fs.mkdirSync(hlsDir, { recursive: true });

          const logPath = path.join(hlsDir, 'transcoder.log');
          const out = fs.openSync(logPath, 'a');
          const err = fs.openSync(logPath, 'a');

          const child = spawn(cmd, args, {
            detached: true,
            stdio: ['ignore', out, err],
            env: process.env,
          });
          child.unref();

          child.on('error', (spawnErr) => {
            console.error('❌ Failed to spawn transcoder process:', spawnErr);
          });
        });
      }

      const fallbackStreamUrl = `${process.env.BACKEND_URL || ''}/api/video/hls-local/${safeFileId}.m3u8`;
      res.status(202).json({ success: true, fileId: `${safeFileId}.m3u8`, streamUrl: fallbackStreamUrl });
    } catch (error) {
      console.error('Chunk processing error:', error);
      next(new AppError('Failed to process uploaded chunk request.', 500));
    }
  }

  static async transcodeStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      const fileId = req.query.fileId as string | undefined;
      const safeFileId = fileId ? path.basename(fileId).replace(/[^a-zA-Z0-9_-]/g, '') : undefined;
      // Prefer the per-fileId status file when a fileId is provided.
      // This allows concurrent uploads to have independent status tracking.
      const candidates: string[] = safeFileId
        ? [
            path.join(process.cwd(), `transcode_status_${safeFileId}.json`),
            path.join(process.cwd(), 'transcode_status.json'),
          ]
        : [path.join(process.cwd(), 'transcode_status.json')];

      for (const statusFile of candidates) {
        if (fs.existsSync(statusFile)) {
          try {
            const data = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
            res.json(data);
            return;
          } catch {
            // Ignore parse error during write collision; try next candidate
          }
        }
      }
      res.json({ status: 'idle', progress: 0, eta: 'Calculating...', speed: '0x' });
    } catch (error) {
      next(error);
    }
  }

  static async getLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const logPath = path.join(process.cwd(), 'output_hls', 'transcoder.log');
      if (fs.existsSync(logPath)) {
        res.setHeader('Content-Type', 'text/plain');
        res.send(fs.readFileSync(logPath, 'utf-8'));
      } else {
        res.send('No logs found.');
      }
    } catch (error: any) {
      res.send('Error reading logs: ' + error.message);
    }
  }


}
