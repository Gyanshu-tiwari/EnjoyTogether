import { z } from 'zod';

export const roomIdSchema = z.string().trim().min(1, 'Room ID is required');

export const getLivekitTokenSchema = z.object({
  query: z.object({
    room_id: roomIdSchema.optional(),
  }),
});

export const startUploadSchema = z.object({
  body: z.object({}).optional(),
});

export const changeVideoSrcSchema = z.object({
  body: z.object({
    roomId: roomIdSchema,
    streamUrl: z.string().url('Invalid video stream URL format').or(z.string().min(1)),
  }),
});
