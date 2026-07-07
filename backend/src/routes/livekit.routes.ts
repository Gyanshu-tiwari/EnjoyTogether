import { Router } from 'express';
import { LiveKitController } from '../livekit/livekit.controller.js';
import { validate } from '../middleware/validate.middleware.js';
import { getLivekitTokenSchema } from '../validations/room.validation.js';

const router = Router();

router.get('/token', validate(getLivekitTokenSchema), LiveKitController.getToken);

export default router;
