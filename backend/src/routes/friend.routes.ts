import { Router } from 'express';
import { FriendController } from '../controllers/friend.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  searchFriendsSchema,
  sendFriendRequestSchema,
  respondToRequestSchema,
} from '../validations/friend.validation.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

// All friend routes require authentication
router.get('/search', authMiddleware, validate(searchFriendsSchema), FriendController.searchUsers);
router.get('/pending', authMiddleware, FriendController.getPending);
router.get('/', authMiddleware, FriendController.getFriends);
router.post('/request', authMiddleware, validate(sendFriendRequestSchema), FriendController.sendRequest);
router.patch('/respond', authMiddleware, validate(respondToRequestSchema), FriendController.respondToRequest);
router.delete('/:friendshipId', authMiddleware, FriendController.deleteFriendship);

export default router;
