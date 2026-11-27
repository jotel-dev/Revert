import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { Layout } from './components/Layout.js';
import { RevertDataProvider } from './context/RevertDataContext.js';
import { wagmiConfig } from './lib/wagmi.js';
import { CreatePaymentPage } from './pages/CreatePaymentPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { DevelopersPage } from './pages/DevelopersPage.js';
import { LandingPage } from './pages/LandingPage.js';
import { PaymentDetailPage } from './pages/PaymentDetailPage.js';

const queryClient = new QueryClient();

export function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RevertDataProvider>
          <BrowserRouter>
            <Layout>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/app" element={<DashboardPage />} />
                <Route path="/create" element={<CreatePaymentPage />} />
                <Route path="/payments/:id" element={<PaymentDetailPage />} />
                <Route path="/developers" element={<DevelopersPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </BrowserRouter>
        </RevertDataProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
