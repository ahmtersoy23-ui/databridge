import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
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
import Reviews from './pages/Reviews';
import Ads from './pages/Ads';

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

const AMAZON_PATHS = ['/orders', '/inventory', '/sales-analysis', '/inventory-analysis', '/reviews', '/ads'];
const WAYFAIR_PATHS = ['/wayfair/orders', '/wayfair/inventory', '/wayfair/orders-analysis', '/wayfair/inventory-analysis', '/wayfair/mappings'];

function UserMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{user.name}</span>
      <button
        onClick={logout}
        style={{
          color: '#94a3b8', background: 'none', border: '1px solid #334155',
          padding: '0.3rem 0.7rem', borderRadius: '4px', fontSize: '0.8rem',
          cursor: 'pointer',
        }}
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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#94a3b8' }}>
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

  const topLink = (active: boolean) => ({
    color: active ? '#fff' : '#94a3b8',
    textDecoration: 'none' as const,
    padding: '0.5rem 1rem',
    borderRadius: '6px',
    fontSize: '0.9rem',
    background: active ? '#334155' : 'none',
    cursor: 'pointer' as const,
    border: 'none' as const,
  });

  const subLink = ({ isActive }: { isActive: boolean }) => ({
    color: isActive ? '#fff' : '#94a3b8',
    textDecoration: 'none' as const,
    padding: '0.35rem 0.9rem',
    borderRadius: '4px',
    fontSize: '0.85rem',
    background: isActive ? '#1e3a5f' : 'none',
  });

  return (
    <>
      {/* Top nav */}
      <nav style={{ display: 'flex', gap: '0.5rem', padding: '0.85rem 2rem', background: '#1a1a2e', alignItems: 'center' }}>
        <strong style={{ marginRight: '1.5rem', fontSize: '1.1rem', color: '#fff' }}>DataBridge</strong>

        <NavLink to="/" end style={({ isActive }) => topLink(isActive)}>
          Dashboard
        </NavLink>

        <NavLink to="/orders" style={topLink(isAmazon)}>
          Amazon
        </NavLink>

        <NavLink to="/wayfair/orders" style={topLink(isWayfair)}>
          Wayfair
        </NavLink>

        <NavLink to="/nj-warehouse" style={({ isActive }) => topLink(isActive)}>
          NJ Warehouse
        </NavLink>

        <NavLink to="/catalog" style={({ isActive }) => topLink(isActive)}>
          Catalog
        </NavLink>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <NavLink to="/settings" style={({ isActive }) => topLink(isActive)}>
            Settings
          </NavLink>
          <NavLink to="/logs" style={({ isActive }) => topLink(isActive)}>
            Logs
          </NavLink>
          <UserMenu />
        </div>
      </nav>

      {/* Amazon sub-nav */}
      {isAmazon && (
        <nav style={{ display: 'flex', gap: '0.25rem', padding: '0.5rem 2rem', background: '#0f172a', borderBottom: '1px solid #1e293b' }}>
          <NavLink to="/orders" style={subLink}>Orders</NavLink>
          <NavLink to="/inventory" style={subLink}>Inventory</NavLink>
          <NavLink to="/sales-analysis" style={subLink}>Sales Analysis</NavLink>
          <NavLink to="/inventory-analysis" style={subLink}>Inv. Analysis</NavLink>
          <NavLink to="/reviews" style={subLink}>Reviews</NavLink>
          <NavLink to="/ads" style={subLink}>Ads</NavLink>
        </nav>
      )}

      {/* Wayfair sub-nav */}
      {isWayfair && (
        <nav style={{ display: 'flex', gap: '0.25rem', padding: '0.5rem 2rem', background: '#0f172a', borderBottom: '1px solid #1e293b' }}>
          <NavLink to="/wayfair/orders" style={subLink}>Orders</NavLink>
          <NavLink to="/wayfair/inventory" style={subLink}>Inventory</NavLink>
          <NavLink to="/wayfair/orders-analysis" style={subLink}>Orders Analysis</NavLink>
          <NavLink to="/wayfair/inventory-analysis" style={subLink}>Inv. Analysis</NavLink>
          <NavLink to="/wayfair/mappings" style={subLink}>Mappings</NavLink>
        </nav>
      )}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AuthGate>
          <Nav />
          <main style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/sales-analysis" element={<SalesAnalysis />} />
              <Route path="/inventory-analysis" element={<InventoryAnalysis />} />
              <Route path="/nj-warehouse" element={<NJWarehouse />} />
              <Route path="/catalog" element={<Catalog />} />
              <Route path="/wayfair/orders" element={<WayfairOrders />} />
              <Route path="/wayfair/inventory" element={<WayfairInventory />} />
              <Route path="/wayfair/orders-analysis" element={<WayfairOrdersAnalysis />} />
              <Route path="/wayfair/inventory-analysis" element={<WayfairInventoryAnalysis />} />
              <Route path="/wayfair/mappings" element={<WayfairMappings />} />
              <Route path="/reviews" element={<Reviews />} />
              <Route path="/ads" element={<Ads />} />
              <Route path="/logs" element={<Logs />} />
            </Routes>
          </main>
        </AuthGate>
      </BrowserRouter>
    </AuthProvider>
  );
}
