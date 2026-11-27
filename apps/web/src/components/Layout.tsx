import {
  AlertTriangle,
  BookOpen,
  LayoutDashboard,
  Loader2,
  Menu,
  Plus,
  RotateCcw,
  ShieldAlert,
  Wallet,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { useRevertData } from '../context/RevertDataContext.js';
import { SEPOLIA_CHAIN_ID, SEPOLIA_TEST_USDC_ADDRESS } from '../lib/contracts.js';
import { cn, formatUsdc, shortAddress } from '../lib/utils.js';
import { Badge, Button } from './ui.js';

const NAV_ITEMS = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/create', label: 'Create Payment', icon: Plus },
  { to: '/developers', label: 'Developers & Security', icon: BookOpen },
];

export function Layout({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { dataMode, setDataMode } = useRevertData();

  const { address, isConnected, isConnecting, chainId } = useAccount();
  const { connect, connectors, isPending: isConnectPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitchPending } = useSwitchChain();

  const { data: usdcBalance } = useBalance({
    address,
    token: SEPOLIA_TEST_USDC_ADDRESS,
    chainId: SEPOLIA_CHAIN_ID,
    query: { enabled: Boolean(address && chainId === SEPOLIA_CHAIN_ID) },
  });

  const isWrongNetwork = isConnected && chainId !== SEPOLIA_CHAIN_ID;

  const handleConnect = () => {
    const injected = connectors[0];
    if (injected) {
      connect({ connector: injected });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAFA] text-[#0B0F17]">
      {dataMode === 'demo' && (
        <div
          role="region"
          aria-label="Demonstration mode notice"
          className="border-b border-[#FDE68A] bg-[#FFFBEB] px-4 py-2 text-xs text-[#92400E]"
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              SIMULATED DEMONSTRATION FIXTURES — Not live on-chain Sepolia balances or real
              Telegraph charges.
            </span>
            <button
              type="button"
              onClick={() => setDataMode('live')}
              className="font-semibold underline underline-offset-2 hover:text-[#78350F] cursor-pointer"
            >
              Switch to Sepolia Live
            </button>
          </div>
        </div>
      )}

      {isWrongNetwork && (
        <div
          role="alert"
          className="border-b border-[#FECDD3] bg-[#FFF1F2] px-4 py-2 text-xs text-[#9F1239]"
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Wrong network connected (Chain ID {chainId}). REVERT operates on Ethereum Sepolia
              (11155111).
            </span>
            <Button
              size="sm"
              variant="danger"
              disabled={isSwitchPending}
              onClick={() => switchChain({ chainId: SEPOLIA_CHAIN_ID })}
            >
              {isSwitchPending ? 'Switching…' : 'Switch to Ethereum Sepolia'}
            </Button>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-30 border-b border-[#E4E7EC] bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6 min-w-0">
            <Link
              to="/"
              className="flex items-center gap-2.5 font-display text-base font-bold tracking-tight text-[#0B0F17] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1D4ED8] rounded"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0B0F17] text-white">
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>REVERT</span>
            </Link>

            <nav aria-label="Main navigation" className="hidden md:flex items-center gap-1">
              {NAV_ITEMS.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      'rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]',
                      isActive
                        ? 'bg-[#F4F5F7] text-[#0B0F17]'
                        : 'text-[#525B6C] hover:bg-[#F4F5F7] hover:text-[#0B0F17]',
                    )
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div
              role="group"
              aria-label="Data source mode"
              className="hidden sm:inline-flex rounded-lg border border-[#E4E7EC] bg-[#F4F5F7] p-0.5 text-xs"
            >
              <button
                type="button"
                onClick={() => setDataMode('live')}
                className={cn(
                  'rounded-md px-2.5 py-1.5 font-medium transition-colors cursor-pointer',
                  dataMode === 'live'
                    ? 'bg-white text-[#0B0F17] shadow-xs'
                    : 'text-[#525B6C] hover:text-[#0B0F17]',
                )}
              >
                Sepolia Live
              </button>
              <button
                type="button"
                onClick={() => setDataMode('demo')}
                className={cn(
                  'rounded-md px-2.5 py-1.5 font-medium transition-colors cursor-pointer',
                  dataMode === 'demo'
                    ? 'bg-white text-[#0B0F17] shadow-xs'
                    : 'text-[#525B6C] hover:text-[#0B0F17]',
                )}
              >
                Demo Fixtures
              </button>
            </div>

            {isConnected && address ? (
              <div className="hidden sm:flex items-center gap-2 rounded-lg border border-[#E4E7EC] bg-white px-3 py-1.5 text-xs">
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    isWrongNetwork ? 'bg-[#BE123C]' : 'bg-[#047857]',
                  )}
                  aria-hidden="true"
                />
                <span className="font-mono font-medium text-[#0B0F17]">
                  {shortAddress(address)}
                </span>
                {usdcBalance !== undefined && !isWrongNetwork && (
                  <Badge tone="neutral" className="tabular-nums">
                    {formatUsdc(usdcBalance.value)} USDC
                  </Badge>
                )}
                <button
                  type="button"
                  onClick={() => disconnect()}
                  className="ml-1 text-[#525B6C] hover:text-[#0B0F17] underline underline-offset-2 cursor-pointer"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={handleConnect}
                disabled={isConnecting || isConnectPending}
                aria-busy={isConnecting || isConnectPending}
                className="hidden sm:inline-flex"
              >
                {isConnecting || isConnectPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Connecting…
                  </>
                ) : (
                  <>
                    <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                    Connect Wallet
                  </>
                )}
              </Button>
            )}

            <button
              type="button"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-[#E4E7EC] bg-white text-[#0B0F17] md:hidden cursor-pointer"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {connectError && (
          <div className="border-t border-[#FECDD3] bg-[#FFF1F2] px-4 py-1.5 text-xs text-[#9F1239]">
            {connectError.message.includes('Provider not found')
              ? 'No browser wallet detected. Install MetaMask / Rabby or inspect Demo Fixtures.'
              : connectError.message}
          </div>
        )}

        {mobileMenuOpen && (
          <div className="border-t border-[#E4E7EC] bg-white px-4 py-3 md:hidden space-y-2">
            <nav aria-label="Mobile navigation" className="flex flex-col gap-1">
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-[44px] items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium',
                      isActive ? 'bg-[#F4F5F7] text-[#0B0F17]' : 'text-[#525B6C]',
                    )
                  }
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </NavLink>
              ))}
            </nav>

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E4E7EC]">
              <Button
                size="sm"
                variant={dataMode === 'live' ? 'secondary' : 'outline'}
                onClick={() => setDataMode('live')}
              >
                Sepolia Live
              </Button>
              <Button
                size="sm"
                variant={dataMode === 'demo' ? 'secondary' : 'outline'}
                onClick={() => setDataMode('demo')}
              >
                Demo Fixtures
              </Button>
              {isConnected && address ? (
                <Button size="sm" variant="outline" onClick={() => disconnect()}>
                  Disconnect {shortAddress(address)}
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={handleConnect}>
                  <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                  Connect Wallet
                </Button>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>

      <footer className="border-t border-[#E4E7EC] bg-white px-4 py-6 text-xs text-[#525B6C] sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p>
            <span className="font-semibold text-[#0B0F17]">REVERT</span> — Send with confidence.
            Settle with proof.
          </p>
          <p>
            REVERT does not reverse already-finalized blockchain transfers. Terms are locked before
            funding.
          </p>
        </div>
      </footer>
    </div>
  );
}
