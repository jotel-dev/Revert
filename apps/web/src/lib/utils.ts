import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatUnits, parseUnits } from 'viem';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortAddress(address?: string | null): string {
  if (!address) return '—';
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash?: string | null): string {
  if (!hash) return '—';
  if (hash.length < 16) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function formatUsdc(amountAtomic: string | bigint, decimals = 6): string {
  try {
    const val = typeof amountAtomic === 'bigint' ? amountAtomic : BigInt(amountAtomic);
    const num = Number(formatUnits(val, decimals));
    return num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  } catch {
    return '0.00';
  }
}

export function parseUsdc(amountDecimal: string, decimals = 6): bigint {
  return parseUnits(amountDecimal.trim(), decimals);
}

export function formatCountdown(targetUnix: number, nowUnix: number): string {
  const diff = targetUnix - nowUnix;
  if (diff <= 0) return 'Elapsed';
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  const secs = diff % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

export function formatTimestamp(unixSeconds: number): string {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatWeb3Error(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/User rejected|User denied/i.test(raw)) {
    return 'Transaction was cancelled in your wallet.';
  }
  if (/insufficient funds/i.test(raw)) {
    return 'Insufficient Sepolia ETH to pay transaction gas.';
  }
  if (/TokenNotAllowed/i.test(raw)) {
    return 'This token is not allowlisted by RevertEscrow.';
  }
  if (/RecoveryWindowActive/i.test(raw)) {
    return 'Recovery window is still active; recipient cannot claim yet.';
  }
  if (/RecoveryWindowExpired/i.test(raw)) {
    return 'Recovery window has expired; sender can no longer cancel.';
  }
  if (/DeadlineExpired/i.test(raw)) {
    return 'Settlement deadline has passed; use Refund Expired instead.';
  }
  if (/DeadlineNotReached/i.test(raw)) {
    return 'Settlement deadline has not passed yet.';
  }
  return raw.split('\n')[0]?.slice(0, 180) || 'Transaction failed.';
}
