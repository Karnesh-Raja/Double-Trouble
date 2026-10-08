import { Navigate, Route, Routes } from 'react-router-dom';
import Header from './components/Header';
import Toasts from './components/Toasts';
import Dashboard from './pages/Dashboard';
import Marketplace from './pages/Marketplace';
import { OfflineState } from './components/ui';
import { useAppData } from './hooks/useAppData';

export default function App() {
  const { online, refreshAll } = useAppData();
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">Skip to content</a>
      <Header />
      <Toasts />
      <main id="main" className="mx-auto max-w-7xl px-4 py-5">
        {online === false ? <OfflineState onRetry={refreshAll} /> : (
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        )}
      </main>
    </>
  );
}
