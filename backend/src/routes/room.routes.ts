import { Router } from 'express';
import { RoomController } from '../controllers/room.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createRoomSchema, getMetadataSchema, toggleActiveStatusSchema } from '../validations/room.validation.js';

const router = Router();

// Room lifecycle endpoints
router.post('/create', authMiddleware, validate(createRoomSchema), RoomController.createRoom);
router.get('/:roomId/metadata', authMiddleware, validate(getMetadataSchema), RoomController.getMetadata);
router.post('/toggle-active', authMiddleware, validate(toggleActiveStatusSchema), RoomController.toggleActiveStatus);

export default router;
