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

// ─── Telegram Lazy Singleton ────────────────────────────────────────────────
// Initialised only on first use to avoid crashing the server if credentials
// are missing at startup.
let _telegramClient: import('telegram').TelegramClient | null = null;

async function getTelegramClient(): Promise<import('telegram').TelegramClient> {
  if (_telegramClient) return _telegramClient;

  const { TelegramClient, sessions } = await import('telegram');
  const bigInt = (await import('big-integer')).default;

  const stringSession = new sessions.StringSession(process.env.TELEGRAM_SESSION || '');
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH || '';

  if (!apiId || !apiHash) {
    throw new AppError('Telegram credentials not configured.', 503);
  }

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });
  await client.connect();
  _telegramClient = client;
  console.log('⚡ Telegram Client connected on first use.');
  return client;
}

const channelId: string = process.env.TELEGRAM_CHANNEL_ID || '';

export class RoomController {
  // ── Room Lifecycle ─────────────────────────────────────────────────────────

  static async createRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { hostId, movieUrl } = req.body;
      const roomId = crypto.randomUUID();
      const metadata = await RoomRepository.createRoom(
        roomId,
        hostId || 'default-host-id',
        movieUrl || `${process.env.BACKEND_URL || ''}/api/video/hls-local/master_party.m3u8`
      );
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
      // ── Zombie Process Cleanup ─────────────────────────────────────────────
      // If a previous upload was aborted, detached ffmpeg/transcoder processes
      // may still be consuming 100% CPU on the Railway instance, choking the network.
      // Force kill them before starting a new session.
      exec('pkill -f ffmpeg', () => {});
      exec('pkill -f transcodeAndUpload', () => {});

      const { fileId } = req.body;
      // Write per-fileId status file so concurrent uploads track independently.
      // Also write the shared file for backwards compatibility.
      const payload = JSON.stringify({ status: 'uploading', progress: 0, eta: 'Uploading...', speed: '0x' }, null, 2);
      if (fileId) {
        fs.writeFileSync(path.join(process.cwd(), `transcode_status_${fileId}.json`), payload);
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
      const fileId = req.body.fileId;
      
      if (isNaN(chunkIndex) || isNaN(totalChunks) || !fileId) {
        return next(new AppError('Missing chunking metadata.', 400));
      }

      const uploadedChunkPath = req.file.path;
      const targetFilePath = path.join(process.cwd(), 'uploads', `${fileId}.mp4`);

      // Append this chunk to the master file
      fs.appendFileSync(targetFilePath, fs.readFileSync(uploadedChunkPath));
      
      // Cleanup the temporary multer chunk file
      fs.unlinkSync(uploadedChunkPath);

      console.log(`🚀 Chunk ${chunkIndex + 1}/${totalChunks} appended for file ${fileId}`);

      if (chunkIndex === totalChunks - 1) {
        console.log(`✅ All chunks received. Launching transcoder pipeline for: ${targetFilePath}`);

        // Resolve script path relative to THIS compiled file's directory (__dirname).
        // This is robust regardless of what process.cwd() happens to be.
        const isDev = process.env.NODE_ENV !== 'production';
        const jsScript = path.resolve(__dirname, '../utils/transcodeAndUpload.js');
        const tsScript = path.resolve(__dirname, '../utils/transcodeAndUpload.ts');

        const useTsx = isDev && fs.existsSync(tsScript);
        const cmd = useTsx ? 'npx' : 'node';
        const args = useTsx ? ['tsx', tsScript, targetFilePath, fileId] : [jsScript, targetFilePath, fileId];

        // spawn with detached:true + stdio redirected to a log file
        // → child process is fully independent of Express; no stdout buffer overflow
        const logPath = path.join(process.cwd(), 'output_hls', 'transcoder.log');
        const out = fs.openSync(logPath, 'a');
        const err = fs.openSync(logPath, 'a');
        
        const child = spawn(cmd, args, {
          detached: true,
          stdio: ['ignore', out, err],
          env: process.env,
        });
        child.unref();

        child.on('error', (err) => {
          console.error('❌ Failed to spawn transcoder process:', err);
        });
      }

      const fallbackStreamUrl = `${process.env.BACKEND_URL || ''}/api/video/hls-local/${fileId}.m3u8`;
      res.status(202).json({ success: true, fileId: `${fileId}.m3u8`, streamUrl: fallbackStreamUrl });
    } catch (error) {
      console.error('Chunk processing error:', error);
      next(new AppError('Failed to process uploaded chunk request.', 500));
    }
  }

  static async transcodeStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const fileId = req.query.fileId as string | undefined;
      // Prefer the per-fileId status file when a fileId is provided.
      // This allows concurrent uploads to have independent status tracking.
      const candidates: string[] = fileId
        ? [
            path.join(process.cwd(), `transcode_status_${fileId}.json`),
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

  // ── Telegram Media Streaming ───────────────────────────────────────────────

  static async streamVideo(req: Request, res: Response, next: NextFunction): Promise<any> {
    const messageIdParam = req.params.messageId;
    if (!messageIdParam) return next(new AppError('Missing identification parameter', 400));

    const parsedMessageId = parseInt(
      (Array.isArray(messageIdParam) ? messageIdParam[0] : messageIdParam) as string,
      10
    );
    if (isNaN(parsedMessageId)) return next(new AppError('Invalid message identification parameter', 400));

    try {
      const { default: bigInt } = await import('big-integer');
      const client = await getTelegramClient();

      const messages = await client.getMessages(channelId, { ids: [parsedMessageId] });
      const targetMessage = messages[0];
      if (!targetMessage || !targetMessage.media) {
        return next(new AppError('Target media file not found on Telegram servers', 404));
      }

      let fileSize = 0;
      const media = targetMessage.media;
      if ('document' in media && media.document && 'size' in media.document) {
        fileSize = Number((media.document as any).size);
      } else if ('photo' in media && media.photo && 'sizes' in media.photo) {
        const sizes = (media.photo as any).sizes;
        const largest = sizes?.[sizes.length - 1];
        if (largest && 'size' in largest) fileSize = Number((largest as any).size);
      }

      const rangeHeader = req.headers.range;
      let start = 0;
      let end = fileSize - 1;

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-cache');

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        start = parseInt(parts[0] || '0', 10);
        end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize) {
          res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
          return;
        }

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      } else {
        res.status(200);
      }

      const contentLength = end - start + 1;
      res.setHeader('Content-Length', contentLength);

      let bytesWritten = 0;
      let clientDisconnected = false;
      req.on('close', () => { clientDisconnected = true; });

      const chunkIterator = client.iterDownload({
        file: targetMessage.media,
        chunkSize: 512 * 1024,
        requestSize: 1024 * 1024,
        offset: bigInt(start),
      });

      for await (const chunk of chunkIterator) {
        if (clientDisconnected) break;
        const remaining = contentLength - bytesWritten;
        if (remaining <= 0) break;
        
        const dataToWrite = chunk.length <= remaining ? chunk : chunk.slice(0, remaining);
        const canContinue = res.write(dataToWrite);
        bytesWritten += dataToWrite.length;

        if (!canContinue && !clientDisconnected) {
          // ── Zero-Memory Proxy Backpressure ──
          // Wait for OS socket buffer to drain before pulling more chunks from Telegram
          await new Promise<void>((resolve) => {
            const onDrain = () => {
              req.off('close', onClose);
              resolve();
            };
            const onClose = () => {
              res.off('drain', onDrain);
              resolve();
            };
            res.once('drain', onDrain);
            req.once('close', onClose);
          });
        }
      }

      res.end();
    } catch (error) {
      console.error('🔴 Streaming pipeline failure:', error);
      if (!res.headersSent) {
        next(new AppError('Internal server media streaming pipeline failure', 500));
      }
    }
  }
}
