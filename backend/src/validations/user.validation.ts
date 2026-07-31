import { z } from 'zod';

export const updateProfileSchema = z.object({
  body: z.object({
    avatarUrl: z.string().url('Avatar URL must be a valid URL'),
  }),
});
