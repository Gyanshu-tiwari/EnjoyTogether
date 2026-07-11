import { Router } from 'express';
import { RoomController } from '../controllers/room.controller.js';

const router = Router();

// Room lifecycle endpoints
router.post('/create', RoomController.createRoom);
router.get('/:roomId/metadata', RoomController.getMetadata);
router.post('/toggle-active', RoomController.toggleActiveStatus);

export default router;
