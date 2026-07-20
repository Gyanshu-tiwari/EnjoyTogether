import { z } from 'zod';

export const roomIdSchema = z.string().trim().min(1, 'Room ID is required');

export const getLivekitTokenSchema = z.object({
  query: z.object({
    room_id: roomIdSchema.optional(),
  }),
});

export const startUploadSchema = z.object({
  body: z.object({
    fileId: z.string().uuid('fileId must be a valid UUID').optional(),
  }).optional(),
});

export const changeVideoSrcSchema = z.object({
  body: z.object({
    roomId: roomIdSchema,
    streamUrl: z.string().trim().min(1, 'Video source path cannot be empty'),
  }),
});

export const createRoomSchema = z.object({
  body: z.object({
    hostId: z.string().optional(),
    movieUrl: z.string().trim().min(1, 'Video source path cannot be empty').optional(),
  }),
});

export const getMetadataSchema = z.object({
  params: z.object({
    roomId: roomIdSchema,
  }),
});

export const toggleActiveStatusSchema = z.object({
  body: z.object({
    roomId: roomIdSchema,
    isActive: z.boolean(),
  }),
});
