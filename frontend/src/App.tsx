import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
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

const AMAZON_PATHS = ['/orders', '/inventory', '/sales-analysis', '/inventory-analysis'];

function Nav() {
  const location = useLocation();
  const isAmazon = AMAZON_PATHS.some(p => location.pathname.startsWith(p));

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

        <NavLink to="/wayfair" style={({ isActive }) => topLink(isActive)}>
          Wayfair
        </NavLink>

        <NavLink to="/nj-warehouse" style={({ isActive }) => topLink(isActive)}>
          NJ Warehouse
        </NavLink>

        <NavLink to="/catalog" style={({ isActive }) => topLink(isActive)}>
          Catalog
        </NavLink>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <NavLink to="/settings" style={({ isActive }) => topLink(isActive)}>
            Settings
          </NavLink>
          <NavLink to="/logs" style={({ isActive }) => topLink(isActive)}>
            Logs
          </NavLink>
        </div>
      </nav>

      {/* Amazon sub-nav */}
      {isAmazon && (
        <nav style={{ display: 'flex', gap: '0.25rem', padding: '0.5rem 2rem', background: '#0f172a', borderBottom: '1px solid #1e293b' }}>
          <NavLink to="/orders" style={subLink}>Orders</NavLink>
          <NavLink to="/inventory" style={subLink}>Inventory</NavLink>
          <NavLink to="/sales-analysis" style={subLink}>Sales Analysis</NavLink>
          <NavLink to="/inventory-analysis" style={subLink}>Inv. Analysis</NavLink>
        </nav>
      )}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
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
          <Route path="/wayfair" element={<WayfairMappings />} />
          <Route path="/logs" element={<Logs />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
