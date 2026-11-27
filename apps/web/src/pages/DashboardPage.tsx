import { ArrowUpRight, Plus, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertBox, Badge, Button, Panel } from '../components/ui.js';
import { useRevertData } from '../context/RevertDataContext.js';
import { formatCountdown, formatUsdc, shortAddress } from '../lib/utils.js';

type StateFilter = 'ALL' | 'LOCKED' | 'RELEASED' | 'REFUNDED';
type ModeFilter = 'ALL' | 'Protected' | 'Conditional';

export function DashboardPage() {
  const { dataMode, setDataMode, escrows, budget, loading, apiError, refresh } = useRevertData();
  const [stateFilter, setStateFilter] = useState<StateFilter>('ALL');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('ALL');

  const nowUnix = Math.floor(Date.now() / 1000);

  const stats = useMemo(() => {
    let lockedCount = 0;
    let lockedSum = 0n;
    let releasedCount = 0;
    let releasedSum = 0n;
    let refundedCount = 0;
    let refundedSum = 0n;

    for (const item of escrows) {
      const amt = BigInt(item.onchain.amount);
      if (item.onchain.state === 'LOCKED') {
        lockedCount++;
        lockedSum += amt;
      } else if (item.onchain.state === 'RELEASED') {
        releasedCount++;
        releasedSum += amt;
      } else {
        refundedCount++;
        refundedSum += amt;
      }
    }
    return { lockedCount, lockedSum, releasedCount, releasedSum, refundedCount, refundedSum };
  }, [escrows]);

  const filtered = useMemo(
    () =>
      escrows.filter((item) => {
        if (stateFilter !== 'ALL' && item.onchain.state !== stateFilter) return false;
        if (modeFilter !== 'ALL' && item.onchain.mode !== modeFilter) return false;
        return true;
      }),
    [escrows, stateFilter, modeFilter],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0B0F17]">Escrow Dashboard</h1>
          <p className="mt-1 text-sm text-[#525B6C]">
            Monitor pending recovery windows, conditional settlements, and Telegraph evidence.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {dataMode === 'live' && (
            <Button variant="outline" size="md" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw
                className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              Refresh
            </Button>
          )}
          <Link to="/create">
            <Button variant="primary" size="md">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create Payment
            </Button>
          </Link>
        </div>
      </div>

      {dataMode === 'live' && apiError && (
        <AlertBox tone="warning" title="Live verification backend is not connected">
          <p>
            {apiError}. Live mode never renders simulated balances or fabricated receipts. Start the
            Fastify API with a deployed Sepolia contract, or inspect{' '}
            <button
              type="button"
              onClick={() => setDataMode('demo')}
              className="font-semibold underline underline-offset-2 cursor-pointer"
            >
              Demo Fixtures
            </button>
            .
          </p>
        </AlertBox>
      )}

      {/* Summary metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
            Pending / Locked ({stats.lockedCount})
          </p>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums">
            {formatUsdc(stats.lockedSum)}{' '}
            <span className="text-sm font-medium text-[#525B6C]">USDC</span>
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
            Released ({stats.releasedCount})
          </p>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#047857]">
            {formatUsdc(stats.releasedSum)}{' '}
            <span className="text-sm font-medium text-[#525B6C]">USDC</span>
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
            Refunded ({stats.refundedCount})
          </p>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums">
            {formatUsdc(stats.refundedSum)}{' '}
            <span className="text-sm font-medium text-[#525B6C]">USDC</span>
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
            Telegraph Budget Remaining
          </p>
          <p className="mt-2 font-display text-2xl font-bold tabular-nums">
            {budget ? formatUsdc(budget.remainingUusdc) : '—'}{' '}
            <span className="text-sm font-medium text-[#525B6C]">USDC</span>
          </p>
        </Panel>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by state"
        >
          {(['ALL', 'LOCKED', 'RELEASED', 'REFUNDED'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStateFilter(s)}
              className={`min-h-[38px] rounded-lg border px-3 text-xs font-medium cursor-pointer transition-colors ${
                stateFilter === s
                  ? 'border-[#0B0F17] bg-[#0B0F17] text-white'
                  : 'border-[#E4E7EC] bg-white text-[#525B6C] hover:text-[#0B0F17]'
              }`}
            >
              {s === 'ALL'
                ? 'All States'
                : s === 'LOCKED'
                  ? 'Pending'
                  : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by mode"
        >
          {(['ALL', 'Protected', 'Conditional'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModeFilter(m)}
              className={`min-h-[38px] rounded-lg border px-3 text-xs font-medium cursor-pointer transition-colors ${
                modeFilter === m
                  ? 'border-[#1D4ED8] bg-[#EFF6FF] text-[#1D4ED8]'
                  : 'border-[#E4E7EC] bg-white text-[#525B6C] hover:text-[#0B0F17]'
              }`}
            >
              {m === 'ALL'
                ? 'All Modes'
                : m === 'Protected'
                  ? 'Mode A · Protected'
                  : 'Mode B · Conditional'}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state vs List */}
      {filtered.length === 0 ? (
        <Panel className="p-8 text-center space-y-3">
          <p className="font-display text-lg font-semibold text-[#0B0F17]">
            No payments match the current view
          </p>
          <p className="mx-auto max-w-md text-sm text-[#525B6C]">
            {dataMode === 'live'
              ? 'No live Sepolia escrows are loaded yet. Create a new escrow or switch to Demo Fixtures to explore the full lifecycle.'
              : 'Try clearing your state or mode filters, or create a new simulated escrow payment.'}
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Link to="/create">
              <Button variant="primary">Create Payment</Button>
            </Link>
            {dataMode === 'live' && (
              <Button variant="outline" onClick={() => setDataMode('demo')}>
                Load Demo Fixtures
              </Button>
            )}
          </div>
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="divide-y divide-[#E4E7EC]">
            {filtered.map((item) => {
              const { onchain, verification } = item;
              const targetTs =
                onchain.mode === 'Protected' ? onchain.recoveryWindowEnd : onchain.deadline;

              const stateTone =
                onchain.state === 'RELEASED'
                  ? 'success'
                  : onchain.state === 'REFUNDED'
                    ? 'neutral'
                    : 'warning';

              return (
                <Link
                  key={onchain.escrowId}
                  to={`/payments/${onchain.escrowId}`}
                  className="block p-4 sm:px-6 hover:bg-[#FAFAFA] transition-colors focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#1D4ED8]"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display font-semibold text-[#0B0F17]">
                          Escrow #{onchain.escrowId}
                        </span>
                        <Badge tone={onchain.mode === 'Conditional' ? 'accent' : 'neutral'}>
                          {onchain.mode === 'Protected'
                            ? 'Mode A · Protected'
                            : 'Mode B · Conditional'}
                        </Badge>
                        <Badge tone={stateTone}>{onchain.state}</Badge>
                        {verification && (
                          <Badge
                            tone={
                              verification.status === 'SATISFIED'
                                ? 'success'
                                : verification.status === 'CONTRADICTED'
                                  ? 'danger'
                                  : 'neutral'
                            }
                          >
                            {verification.status}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-[#525B6C] font-mono truncate">
                        {shortAddress(onchain.sender)} -&gt; {shortAddress(onchain.recipient)}
                      </p>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                      <div className="text-left sm:text-right">
                        <p className="font-display text-base font-bold tabular-nums text-[#0B0F17]">
                          {formatUsdc(onchain.amount)} USDC
                        </p>
                        <p className="text-xs text-[#667085] tabular-nums">
                          {onchain.state === 'LOCKED'
                            ? `${onchain.mode === 'Protected' ? 'Window' : 'Deadline'}: ${formatCountdown(targetTs, nowUnix)}`
                            : 'Finalized'}
                        </p>
                      </div>
                      <ArrowUpRight className="h-4 w-4 text-[#667085]" aria-hidden="true" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}
