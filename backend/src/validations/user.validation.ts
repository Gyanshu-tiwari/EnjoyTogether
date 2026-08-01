import { z } from 'zod';

export const updateProfileSchema = z.object({
  body: z.object({
    avatarUrl: z.string().url('Avatar URL must be a valid URL').optional(),
    username: z.string().min(1).max(50).optional(),
  }).refine((b) => b.avatarUrl !== undefined || b.username !== undefined, {
    message: 'At least one of avatarUrl or username must be provided',
  }),
});

export const syncGoogleProfileSchema = z.object({
  body: z.object({
    username: z.string().min(1).max(100),
    avatarUrl: z.string().url().optional(),
  }),
});
