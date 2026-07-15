import { Router } from 'express';
import { LiveKitController } from '../controllers/livekit.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import { getLivekitTokenSchema } from '../validations/room.validation.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/token', authMiddleware, validate(getLivekitTokenSchema), LiveKitController.getToken);

export default router;
