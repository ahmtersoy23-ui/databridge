import { Router } from 'express';
import salesRouter from './sales';
import inventoryRouter from './inventory';
import syncRouter from './sync';
import statusRouter from './status';
import credentialsRouter from './credentials';
import ordersRouter from './orders';
import inventoryDetailRouter from './inventoryDetail';
import catalogRouter from './catalog';
import wisersellSettingsRouter from './wisersellSettings';
import wayfairSettingsRouter from './wayfairSettings';
import wayfairMappingsRouter from './wayfairMappings';
import wayfairOrdersRouter from './wayfairOrders';
import wayfairInventoryRouter from './wayfairInventory';

const router = Router();

// StockPulse-compatible endpoints (public - StockPulse authenticates internally)
router.use('/amazonsales', salesRouter);
router.use('/amazonfba', inventoryRouter);

// Browse endpoints (management UI)
router.use('/orders', ordersRouter);
router.use('/inventory-detail', inventoryDetailRouter);

// Catalog endpoint
router.use('/catalog', catalogRouter);
router.use('/wisersell-settings', wisersellSettingsRouter);
router.use('/wayfair/settings', wayfairSettingsRouter);
router.use('/wayfair/mappings', wayfairMappingsRouter);
router.use('/wayfair/orders', wayfairOrdersRouter);
router.use('/wayfair/inventory', wayfairInventoryRouter);

// Management endpoints (auth required)
router.use('/sync', syncRouter);
router.use('/status', statusRouter);
router.use('/credentials', credentialsRouter);

export default router;
