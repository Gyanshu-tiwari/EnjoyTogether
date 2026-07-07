import { Router } from 'express';
import roomRoutes from './room.routes.js';
import videoRoutes from './video.routes.js';
import livekitRoutes from './livekit.routes.js';

const router = Router();

router.use('/rooms', roomRoutes);
router.use('/video', videoRoutes);
router.use('/livekit', livekitRoutes);

export default router;
