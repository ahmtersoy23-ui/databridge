import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import Orders from './pages/Orders';
import Inventory from './pages/Inventory';
import SalesAnalysis from './pages/SalesAnalysis';
import InventoryAnalysis from './pages/InventoryAnalysis';

const navStyle = {
  display: 'flex',
  gap: '1rem',
  padding: '1rem 2rem',
  background: '#1a1a2e',
  color: '#fff',
  alignItems: 'center',
} as const;

const linkStyle = {
  color: '#94a3b8',
  textDecoration: 'none',
  padding: '0.5rem 1rem',
  borderRadius: '6px',
  fontSize: '0.9rem',
} as const;

const activeLinkStyle = {
  ...linkStyle,
  color: '#fff',
  background: '#334155',
} as const;

export default function App() {
  return (
    <BrowserRouter>
      <nav style={navStyle}>
        <strong style={{ marginRight: '2rem', fontSize: '1.1rem' }}>DataBridge</strong>
        <NavLink to="/" style={({ isActive }) => isActive ? activeLinkStyle : linkStyle} end>
          Dashboard
        </NavLink>
        <NavLink to="/settings" style={({ isActive }) => isActive ? activeLinkStyle : linkStyle}>
          Settings
        </NavLink>
        <NavLink to="/orders" style={({ isActive }) => isActive ? activeLinkStyle : linkStyle}>
          Orders
        </NavLink>
        <NavLink to="/inventory" style={({ isActive }) => isActive ? activeLinkStyle : linkStyle}>
          Inventory
        </NavLink>
        <NavLink to="/sales-analysis" style={({ isActive }) => isActive ? activeLinkStyle : linkStyle}>
          Sales Analysis
        </NavLink>
        <NavLink to="/inventory-analysis" style={({ isActive }) => isActive ? activeLinkStyle : linkStyle}>
          Inv. Analysis
        </NavLink>
        <NavLink to="/logs" style={({ isActive }) => isActive ? activeLinkStyle : linkStyle}>
          Logs
        </NavLink>
      </nav>
      <main style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/sales-analysis" element={<SalesAnalysis />} />
          <Route path="/inventory-analysis" element={<InventoryAnalysis />} />
          <Route path="/logs" element={<Logs />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
