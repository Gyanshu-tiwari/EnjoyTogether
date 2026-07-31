import { Router } from 'express';
import { UserController } from '../controllers/user.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import { updateProfileSchema } from '../validations/user.validation.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.patch('/profile', authMiddleware, validate(updateProfileSchema), UserController.updateProfile);
router.get('/profile', authMiddleware, UserController.getProfile);

export default router;
