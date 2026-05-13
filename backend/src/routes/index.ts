import { Router } from 'express';
import authRouter from './auth';
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
import wayfairPartsRouter from './wayfairParts';
import walmartSettingsRouter from './walmartSettings';
import walmartOrdersRouter from './walmartOrders';
import walmartMappingsRouter from './walmartMappings';
import bolSettingsRouter from './bolSettings';
import bolOrdersRouter from './bolOrders';
import bolMappingsRouter from './bolMappings';
import takealotSettingsRouter from './takealotSettings';
import takealotOrdersRouter from './takealotOrders';
import takealotMappingsRouter from './takealotMappings';
import takealotInventoryRouter from './takealotInventory';
import kauflandSettingsRouter from './kauflandSettings';
import kauflandOrdersRouter from './kauflandOrders';
import kauflandMappingsRouter from './kauflandMappings';
import kauflandInventoryRouter from './kauflandInventory';
import reviewsRouter from './reviews';
import inventoryAgingRouter from './inventoryAging';
import adsRouter from './ads';
import adsAnalysisRouter from './adsAnalysis';
import { ssoAuthMiddleware } from '../middleware/ssoAuth';

const router = Router();

// Public endpoints (no auth)
router.use('/auth', authRouter);
router.use('/amazonsales', salesRouter);   // StockPulse reads these
router.use('/amazonfba', inventoryRouter); // StockPulse reads these
router.use('/status', statusRouter);       // Monitoring (UptimeRobot)
router.use('/sync', syncRouter);           // Internal tool — localhost only

// Auth gate — everything below requires SSO session
router.use(ssoAuthMiddleware);

// Browse endpoints
router.use('/orders', ordersRouter);
router.use('/inventory-detail', inventoryDetailRouter);
router.use('/catalog', catalogRouter);
router.use('/wisersell-settings', wisersellSettingsRouter);
router.use('/wayfair/settings', wayfairSettingsRouter);
router.use('/wayfair/mappings', wayfairMappingsRouter);
router.use('/wayfair/orders', wayfairOrdersRouter);
router.use('/wayfair/inventory', wayfairInventoryRouter);
router.use('/wayfair/parts', wayfairPartsRouter);
router.use('/walmart/settings', walmartSettingsRouter);
router.use('/walmart/orders', walmartOrdersRouter);
router.use('/walmart/mappings', walmartMappingsRouter);
router.use('/bol/settings', bolSettingsRouter);
router.use('/bol/orders', bolOrdersRouter);
router.use('/bol/mappings', bolMappingsRouter);
router.use('/takealot/settings', takealotSettingsRouter);
router.use('/takealot/orders', takealotOrdersRouter);
router.use('/takealot/mappings', takealotMappingsRouter);
router.use('/takealot/inventory', takealotInventoryRouter);
router.use('/kaufland/settings', kauflandSettingsRouter);
router.use('/kaufland/orders', kauflandOrdersRouter);
router.use('/kaufland/mappings', kauflandMappingsRouter);
router.use('/kaufland/inventory', kauflandInventoryRouter);
router.use('/reviews', reviewsRouter);
router.use('/inventory-aging', inventoryAgingRouter);
router.use('/ads', adsRouter);
router.use('/ads-analysis', adsAnalysisRouter);
router.use('/credentials', credentialsRouter);

export default router;
