import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Stock = lazy(() => import('./pages/Stock'));
const Consumption = lazy(() => import('./pages/Consumption'));
const Indents = lazy(() => import('./pages/Indents'));
const IndentForm = lazy(() => import('./pages/IndentForm'));
const IndentDetail = lazy(() => import('./pages/IndentDetail'));
const Planner = lazy(() => import('./pages/Planner'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const POForm = lazy(() => import('./pages/POForm'));
const PODetail = lazy(() => import('./pages/PODetail'));
const Dispatches = lazy(() => import('./pages/Dispatches'));
const DispatchForm = lazy(() => import('./pages/DispatchForm'));
const DispatchDetail = lazy(() => import('./pages/DispatchDetail'));
const LocalPurchases = lazy(() => import('./pages/LocalPurchases'));
const StockCounts = lazy(() => import('./pages/StockCounts'));
const Transfers = lazy(() => import('./pages/Transfers'));
const Payables = lazy(() => import('./pages/Payables'));
const Receivables = lazy(() => import('./pages/Receivables'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Employees = lazy(() => import('./pages/Employees'));
const Reports = lazy(() => import('./pages/Reports'));
const Masters = lazy(() => import('./pages/Masters'));
const Users = lazy(() => import('./pages/Users'));

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return <Spinner label="Starting…" />;
  if (!user) return <Login />;
  const home = user.role === 'VENDOR' ? <Navigate to="/purchase-orders" replace /> : <Dashboard />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={home} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="stock" element={<Stock />} />
        <Route path="consumption" element={<Consumption />} />
        <Route path="indents" element={<Indents />} />
        <Route path="indents/new" element={<IndentForm />} />
        <Route path="indents/:id/edit" element={<IndentForm />} />
        <Route path="indents/:id" element={<IndentDetail />} />
        <Route path="planner" element={<Planner />} />
        <Route path="purchase-orders" element={<PurchaseOrders />} />
        <Route path="purchase-orders/new" element={<POForm />} />
        <Route path="purchase-orders/:id" element={<PODetail />} />
        <Route path="dispatches" element={<Dispatches />} />
        <Route path="dispatches/new" element={<DispatchForm />} />
        <Route path="dispatches/:id" element={<DispatchDetail />} />
        <Route path="local-purchases" element={<LocalPurchases />} />
        <Route path="stock-counts" element={<StockCounts />} />
        <Route path="transfers" element={<Transfers />} />
        <Route path="finance/payables" element={<Payables />} />
        <Route path="finance/receivables" element={<Receivables />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="employees" element={<Employees />} />
        <Route path="reports" element={<Reports />} />
        <Route path="masters/users" element={<Users />} />
        <Route path="masters/:kind" element={<Masters />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
