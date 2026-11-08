import { Router } from 'express';
import multer from 'multer';
import { GuestController } from '../controllers/guest.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { guestSessionRateLimiter, guestRevokeRateLimiter } from '../middleware/rateLimit.middleware.js';

const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

// Guest session lifecycle endpoints protected by rate limiting and ownership checks
router.post('/session', guestSessionRateLimiter, GuestController.handleSession);
router.post('/revoke', guestRevokeRateLimiter, GuestController.handleRevoke);
router.post('/transition', authMiddleware, GuestController.handleTransition);
router.post('/avatar', upload.single('avatar'), GuestController.uploadAvatar);
router.delete('/avatar', GuestController.removeAvatar);

export default router;
