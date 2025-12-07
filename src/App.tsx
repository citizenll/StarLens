import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import Layout from '@/pages/Layout';
import Dashboard from '@/pages/Dashboard';
import Settings from '@/pages/Settings';
import { I18nProvider } from '@/lib/i18n';
import { ThemeProvider } from '@/lib/theme';

function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <Router>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
          <Toaster />
        </Router>
      </I18nProvider>
    </ThemeProvider>
  );
}

export default App;
