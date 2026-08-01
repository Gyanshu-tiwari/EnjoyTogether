import { z } from 'zod';

export const searchFriendsSchema = z.object({
  query: z.object({
    q: z.string().min(1, 'Search query cannot be empty'),
  }),
});

export const sendFriendRequestSchema = z.object({
  body: z.object({
    addresseeId: z.string().min(1, 'addresseeId is required'),
  }),
});

export const respondToRequestSchema = z.object({
  body: z.object({
    friendshipId: z.string().min(1, 'friendshipId is required'),
    action: z.enum(['ACCEPT', 'REJECT']),
  }),
});
