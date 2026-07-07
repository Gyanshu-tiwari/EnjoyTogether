import { Router } from 'express';
import { RoomController } from '../rooms/room.controller.js';

const router = Router();

// Room lifecycle endpoints only
router.post('/create', RoomController.createRoom);
router.get('/:roomId/metadata', RoomController.getMetadata);
router.post('/toggle-active', RoomController.toggleActiveStatus);

export default router;
