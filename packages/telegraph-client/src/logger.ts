const SECRET_KEY_NAMES = new Set([
  'privatekey',
  'private_key',
  'secret',
  'signature',
  'x-payment',
  'payment-signature',
  'authorization',
  'mnemonic',
  'seed',
  'apikey',
  'api_key',
]);

const HEX_PRIVKEY_RE = /\b0x[a-fA-F0-9]{64}\b/g;

export function redactString(input: string, preserveHashes = false): string {
  if (preserveHashes) return input;
  return input.replace(HEX_PRIVKEY_RE, '0x[REDACTED_64HEX]');
}

export function sanitizeForLog(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length > 180 && /^[A-Za-z0-9+/=_-]+$/.test(value)) {
      return `[REDACTED_TOKEN_LEN_${value.length}]`;
    }
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_NAMES.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeForLog(v);
      }
    }
    return out;
  }
  return value;
}

export interface SafeLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export function createRedactedLogger(sink: (line: string) => void = console.log): SafeLogger {
  const emit = (
    level: 'INFO' | 'WARN' | 'ERROR',
    message: string,
    meta?: Record<string, unknown>,
  ) => {
    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      ...(meta ? { meta: sanitizeForLog(meta) } : {}),
    };
    sink(JSON.stringify(entry));
  };

  return {
    info: (msg, meta) => emit('INFO', msg, meta),
    warn: (msg, meta) => emit('WARN', msg, meta),
    error: (msg, meta) => emit('ERROR', msg, meta),
  };
}
