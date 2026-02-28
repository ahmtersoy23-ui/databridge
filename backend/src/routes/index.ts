import { Router } from 'express';
import salesRouter from './sales';
import inventoryRouter from './inventory';
import syncRouter from './sync';
import statusRouter from './status';
import credentialsRouter from './credentials';
import ordersRouter from './orders';
import inventoryDetailRouter from './inventoryDetail';

const router = Router();

// StockPulse-compatible endpoints (public - StockPulse authenticates internally)
router.use('/amazonsales', salesRouter);
router.use('/amazonfba', inventoryRouter);

// Browse endpoints (management UI)
router.use('/orders', ordersRouter);
router.use('/inventory-detail', inventoryDetailRouter);

// Management endpoints (auth required)
router.use('/sync', syncRouter);
router.use('/status', statusRouter);
router.use('/credentials', credentialsRouter);

export default router;
