import { Router } from 'express';
import multer from 'multer';
import { UserController } from '../controllers/user.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import { updateProfileSchema, syncGoogleProfileSchema } from '../validations/user.validation.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

router.patch('/profile', authMiddleware, validate(updateProfileSchema), UserController.updateProfile);
router.get('/profile', authMiddleware, UserController.getProfile);
router.post('/sync-google', authMiddleware, validate(syncGoogleProfileSchema), UserController.syncGoogleProfile);
router.post('/avatar', authMiddleware, upload.single('avatar'), UserController.uploadAvatar);
router.delete('/avatar', authMiddleware, UserController.removeAvatar);

export default router;
