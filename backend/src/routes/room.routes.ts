import { Router } from 'express';
import { RoomController } from '../controllers/room.controller.js';
import { RoomInvitationController } from '../controllers/roomInvitation.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createRoomSchema, getMetadataSchema, toggleActiveStatusSchema } from '../validations/room.validation.js';

const router = Router();

// Room invitation endpoints
router.get('/invitations/pending', RoomInvitationController.getPendingInvitations);
router.post('/invitations/:invitationId/respond', RoomInvitationController.respondToInvitation);

// Room lifecycle endpoints
router.post('/create', authMiddleware, validate(createRoomSchema), RoomController.createRoom);
router.get('/:roomId/metadata', validate(getMetadataSchema), RoomController.getMetadata);
router.post('/toggle-active', authMiddleware, validate(toggleActiveStatusSchema), RoomController.toggleActiveStatus);
router.post('/:roomId/invite', authMiddleware, RoomInvitationController.sendInvitation);

export default router;
