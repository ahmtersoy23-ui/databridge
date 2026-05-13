import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { ReactNode } from 'react';
import axios from 'axios';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import Orders from './pages/Orders';
import Inventory from './pages/Inventory';
import SalesAnalysis from './pages/SalesAnalysis';
import InventoryAnalysis from './pages/InventoryAnalysis';
import NJWarehouse from './pages/NJWarehouse';
import Catalog from './pages/Catalog';
import WayfairMappings from './pages/WayfairMappings';
import WayfairOrders from './pages/WayfairOrders';
import WayfairInventory from './pages/WayfairInventory';
import WayfairOrdersAnalysis from './pages/WayfairOrdersAnalysis';
import WayfairInventoryAnalysis from './pages/WayfairInventoryAnalysis';
import WalmartOrders from './pages/WalmartOrders';
import WalmartOrdersAnalysis from './pages/WalmartOrdersAnalysis';
import WalmartMappings from './pages/WalmartMappings';
import BolOrders from './pages/BolOrders';
import BolOrdersAnalysis from './pages/BolOrdersAnalysis';
import BolMappings from './pages/BolMappings';
import TakealotOrders from './pages/TakealotOrders';
import TakealotOrdersAnalysis from './pages/TakealotOrdersAnalysis';
import TakealotMappings from './pages/TakealotMappings';
import KauflandOrders from './pages/KauflandOrders';
import KauflandOrdersAnalysis from './pages/KauflandOrdersAnalysis';
import KauflandMappings from './pages/KauflandMappings';
import Reviews from './pages/Reviews';
import Ads from './pages/Ads';
import InventoryAging from './pages/InventoryAging';

// Axios global config — tüm isteklerde cookie gönder
axios.defaults.withCredentials = true;

// 401 interceptor — session expired ise SSO'ya yönlendir
const SSO_PORTAL_URL = import.meta.env.VITE_SSO_PORTAL_URL || 'https://apps.iwa.web.tr';
axios.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      const redirectUrl = encodeURIComponent(window.location.href);
      window.location.href = `${SSO_PORTAL_URL}?redirect=${redirectUrl}`;
    }
    return Promise.reject(err);
  }
);

const AMAZON_PATHS = ['/orders', '/inventory', '/inventory-aging', '/sales-analysis', '/inventory-analysis', '/reviews', '/ads'];
const WAYFAIR_PATHS = ['/wayfair/orders', '/wayfair/inventory', '/wayfair/orders-analysis', '/wayfair/inventory-analysis', '/wayfair/mappings'];
const WALMART_PATHS = ['/walmart/orders', '/walmart/orders-analysis', '/walmart/mappings'];
const BOL_PATHS = ['/bol/orders', '/bol/orders-analysis', '/bol/mappings'];
const TAKEALOT_PATHS = ['/takealot/orders', '/takealot/orders-analysis', '/takealot/mappings'];
const KAUFLAND_PATHS = ['/kaufland/orders', '/kaufland/orders-analysis', '/kaufland/mappings'];

function UserMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-400 text-sm">{user.name}</span>
      <button
        onClick={logout}
        className="text-slate-400 bg-transparent border border-slate-700 px-3 py-1 rounded text-xs cursor-pointer hover:text-white hover:border-slate-500"
      >
        Logout
      </button>
    </div>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen text-slate-400">
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    const redirectUrl = encodeURIComponent(window.location.href);
    window.location.href = `${SSO_PORTAL_URL}?redirect=${redirectUrl}`;
    return null;
  }

  return <>{children}</>;
}

function Nav() {
  const location = useLocation();
  const isAmazon = AMAZON_PATHS.some(p => location.pathname.startsWith(p));
  const isWayfair = WAYFAIR_PATHS.some(p => location.pathname.startsWith(p));
  const isWalmart = WALMART_PATHS.some(p => location.pathname.startsWith(p));
  const isBol = BOL_PATHS.some(p => location.pathname.startsWith(p));
  const isTakealot = TAKEALOT_PATHS.some(p => location.pathname.startsWith(p));
  const isKaufland = KAUFLAND_PATHS.some(p => location.pathname.startsWith(p));

  const topCls = (active: boolean) =>
    `px-4 py-2 rounded-md text-sm no-underline ${active ? 'text-white bg-slate-700' : 'text-slate-400'}`;

  const subCls = ({ isActive }: { isActive: boolean }) =>
    `px-3.5 py-1 rounded text-sm no-underline ${isActive ? 'text-white bg-[#1e3a5f]' : 'text-slate-400'}`;

  return (
    <header role="banner">
      {/* Top nav */}
      <nav aria-label="Primary" className="flex gap-2 px-8 py-3 bg-[#1a1a2e] items-center">
        <strong className="mr-6 text-lg text-white">DataBridge</strong>

        <NavLink to="/" end className={({ isActive }) => topCls(isActive)}>
          Dashboard
        </NavLink>

        <NavLink to="/orders" className={topCls(isAmazon)}>
          Amazon
        </NavLink>

        <NavLink to="/wayfair/orders" className={topCls(isWayfair)}>
          Wayfair
        </NavLink>

        <NavLink to="/walmart/orders" className={topCls(isWalmart)}>
          Walmart
        </NavLink>

        <NavLink to="/bol/orders" className={topCls(isBol)}>
          Bol
        </NavLink>

        <NavLink to="/takealot/orders" className={topCls(isTakealot)}>
          Takealot
        </NavLink>

        <NavLink to="/kaufland/orders" className={topCls(isKaufland)}>
          Kaufland
        </NavLink>

        <NavLink to="/nj-warehouse" className={({ isActive }) => topCls(isActive)}>
          NJ Warehouse
        </NavLink>

        <NavLink to="/catalog" className={({ isActive }) => topCls(isActive)}>
          Catalog
        </NavLink>

        <div className="ml-auto flex gap-2 items-center">
          <NavLink to="/settings" className={({ isActive }) => topCls(isActive)}>
            Settings
          </NavLink>
          <NavLink to="/logs" className={({ isActive }) => topCls(isActive)}>
            Logs
          </NavLink>
          <UserMenu />
        </div>
      </nav>

      {/* Amazon sub-nav */}
      {isAmazon && (
        <nav aria-label="Amazon sections" className="flex gap-1 px-8 py-2 bg-slate-900 border-b border-slate-800">
          <NavLink to="/orders" className={subCls}>Orders</NavLink>
          <NavLink to="/inventory" className={subCls}>Inventory</NavLink>
          <NavLink to="/inventory-aging" className={subCls}>Inv. Aging</NavLink>
          <NavLink to="/sales-analysis" className={subCls}>Sales Analysis</NavLink>
          <NavLink to="/inventory-analysis" className={subCls}>Inv. Analysis</NavLink>
          <NavLink to="/reviews" className={subCls}>Reviews</NavLink>
          <NavLink to="/ads" className={subCls}>Ads</NavLink>
        </nav>
      )}

      {/* Wayfair sub-nav */}
      {isWayfair && (
        <nav aria-label="Wayfair sections" className="flex gap-1 px-8 py-2 bg-slate-900 border-b border-slate-800">
          <NavLink to="/wayfair/orders" className={subCls}>Orders</NavLink>
          <NavLink to="/wayfair/inventory" className={subCls}>Inventory</NavLink>
          <NavLink to="/wayfair/orders-analysis" className={subCls}>Orders Analysis</NavLink>
          <NavLink to="/wayfair/inventory-analysis" className={subCls}>Inv. Analysis</NavLink>
          <NavLink to="/wayfair/mappings" className={subCls}>Mappings</NavLink>
        </nav>
      )}

      {/* Walmart sub-nav */}
      {isWalmart && (
        <nav aria-label="Walmart sections" className="flex gap-1 px-8 py-2 bg-slate-900 border-b border-slate-800">
          <NavLink to="/walmart/orders" className={subCls}>Orders</NavLink>
          <NavLink to="/walmart/orders-analysis" className={subCls}>Orders Analysis</NavLink>
          <NavLink to="/walmart/mappings" className={subCls}>Mappings</NavLink>
        </nav>
      )}

      {/* Bol sub-nav */}
      {isBol && (
        <nav aria-label="Bol sections" className="flex gap-1 px-8 py-2 bg-slate-900 border-b border-slate-800">
          <NavLink to="/bol/orders" className={subCls}>Orders</NavLink>
          <NavLink to="/bol/orders-analysis" className={subCls}>Orders Analysis</NavLink>
          <NavLink to="/bol/mappings" className={subCls}>Mappings</NavLink>
        </nav>
      )}

      {/* Takealot sub-nav */}
      {isTakealot && (
        <nav aria-label="Takealot sections" className="flex gap-1 px-8 py-2 bg-slate-900 border-b border-slate-800">
          <NavLink to="/takealot/orders" className={subCls}>Orders</NavLink>
          <NavLink to="/takealot/orders-analysis" className={subCls}>Orders Analysis</NavLink>
          <NavLink to="/takealot/mappings" className={subCls}>Mappings</NavLink>
        </nav>
      )}

      {/* Kaufland sub-nav */}
      {isKaufland && (
        <nav aria-label="Kaufland sections" className="flex gap-1 px-8 py-2 bg-slate-900 border-b border-slate-800">
          <NavLink to="/kaufland/orders" className={subCls}>Orders</NavLink>
          <NavLink to="/kaufland/orders-analysis" className={subCls}>Orders Analysis</NavLink>
          <NavLink to="/kaufland/mappings" className={subCls}>Mappings</NavLink>
        </nav>
      )}
    </header>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <AuthGate>
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[10000] focus:bg-white focus:text-slate-900 focus:px-3 focus:py-2 focus:rounded focus:shadow"
            >
              Ana içeriğe geç
            </a>
            <Nav />
            <main id="main-content" className="p-8 max-w-[1200px] mx-auto">
              <ErrorBoundary>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/orders" element={<Orders />} />
                  <Route path="/inventory" element={<Inventory />} />
                  <Route path="/sales-analysis" element={<SalesAnalysis />} />
                  <Route path="/inventory-aging" element={<InventoryAging />} />
                  <Route path="/inventory-analysis" element={<InventoryAnalysis />} />
                  <Route path="/nj-warehouse" element={<NJWarehouse />} />
                  <Route path="/catalog" element={<Catalog />} />
                  <Route path="/wayfair/orders" element={<WayfairOrders />} />
                  <Route path="/wayfair/inventory" element={<WayfairInventory />} />
                  <Route path="/wayfair/orders-analysis" element={<WayfairOrdersAnalysis />} />
                  <Route path="/wayfair/inventory-analysis" element={<WayfairInventoryAnalysis />} />
                  <Route path="/wayfair/mappings" element={<WayfairMappings />} />
                  <Route path="/walmart/orders" element={<WalmartOrders />} />
                  <Route path="/walmart/orders-analysis" element={<WalmartOrdersAnalysis />} />
                  <Route path="/walmart/mappings" element={<WalmartMappings />} />
                  <Route path="/bol/orders" element={<BolOrders />} />
                  <Route path="/bol/orders-analysis" element={<BolOrdersAnalysis />} />
                  <Route path="/bol/mappings" element={<BolMappings />} />
                  <Route path="/takealot/orders" element={<TakealotOrders />} />
                  <Route path="/takealot/orders-analysis" element={<TakealotOrdersAnalysis />} />
                  <Route path="/takealot/mappings" element={<TakealotMappings />} />
                  <Route path="/kaufland/orders" element={<KauflandOrders />} />
                  <Route path="/kaufland/orders-analysis" element={<KauflandOrdersAnalysis />} />
                  <Route path="/kaufland/mappings" element={<KauflandMappings />} />
                  <Route path="/reviews" element={<Reviews />} />
                  <Route path="/ads" element={<Ads />} />
                  <Route path="/logs" element={<Logs />} />
                </Routes>
              </ErrorBoundary>
            </main>
          </AuthGate>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
