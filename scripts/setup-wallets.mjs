/**
 * REVERT — Local Disposable Sepolia Wallet Setup Utility
 *
 * Security invariants:
 *   1. Uses viem/accounts (CSPRNG + secp256k1) locally; never contacts any external key service.
 *   2. NEVER prints, logs, or returns any private key or mnemonic anywhere.
 *   3. Verifies `.gitignore` / `git check-ignore .env` before touching `.env`.
 *   4. Refuses to overwrite an existing `.env` (or populated keys) unless `--force-overwrite` is given.
 *   5. Outputs ONLY derived public EVM addresses and exact Sepolia funding instructions.
 *
 * Usage:
 *   node scripts/setup-wallets.mjs --help          # Print instructions without creating files
 *   node scripts/setup-wallets.mjs --generate      # Create .env with 3 disposable Sepolia wallets
 *   node scripts/setup-wallets.mjs --print-public  # Print public addresses & live Sepolia balances
 */
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createPublicClient, formatEther, formatUnits, http, parseAbi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const ENV_PATH = path.join(REPO_ROOT, '.env');
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, '.env.example');
const SEPOLIA_RPC_DEFAULT = 'https://ethereum-sepolia-rpc.publicnode.com';
const SEPOLIA_USDC = '0xcc194e1a843B658526D0D5C431f670028582Ae17';
const TELEGRAPH_DIAMOND = '0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b';

function assertEnvGitIgnored() {
  const gitignorePath = path.join(REPO_ROOT, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    throw new Error('Refusing to create .env: .gitignore missing');
  }
  try {
    execFileSync('git', ['check-ignore', '-q', '.env'], { cwd: REPO_ROOT, stdio: 'ignore' });
  } catch {
    throw new Error('Refusing to create .env: git check-ignore reports .env is NOT ignored');
  }
}

function parseEnvFile(filePath) {
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) map.set(key, val);
  }
  return map;
}

function deriveAddressIfValid(rawKey) {
  if (!rawKey || !/^0x[a-fA-F0-9]{64}$/.test(rawKey)) return undefined;
  return privateKeyToAccount(rawKey).address;
}

async function printPublicStatus(envMap) {
  const rpcUrl = envMap.get('SEPOLIA_RPC_URL') || SEPOLIA_RPC_DEFAULT;
  const deployerAddr = deriveAddressIfValid(envMap.get('DEPLOYER_PRIVATE_KEY'));
  const payerAddr = deriveAddressIfValid(envMap.get('TELEGRAPH_PAYER_PRIVATE_KEY'));
  const attestorAddr = deriveAddressIfValid(envMap.get('ATTESTOR_PRIVATE_KEY'));

  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const erc20Abi = parseAbi(['function balanceOf(address) view returns (uint256)']);

  async function inspectWallet(role, address, fundingNote) {
    if (!address) {
      return { role, configured: false, address: null, fundingNote };
    }
    const [ethWei, usdcAtomic] = await Promise.all([
      client.getBalance({ address }),
      client.readContract({
        address: SEPOLIA_USDC,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      }),
    ]);
    return {
      role,
      configured: true,
      address,
      sepoliaEth: formatEther(ethWei),
      testUsdc: formatUnits(usdcAtomic, 6),
      fundingNote,
    };
  }

  const wallets = await Promise.all([
    inspectWallet(
      'DEPLOYER',
      deployerAddr,
      'Needs ~0.05 Sepolia ETH (RevertEscrow deployment + test Mode A/B escrows) + ~5-100 Test USDC',
    ),
    inspectWallet(
      'TELEGRAPH_PAYER',
      payerAddr,
      'Needs ~0.01 Sepolia ETH (for USDC mint/approve/depositUSDC gas) + >= 2.00 Test USDC deposited into Diamond',
    ),
    inspectWallet(
      'ATTESTOR',
      attestorAddr,
      'Off-chain EIP-712 signer only (0 ETH required unless also used as broadcaster)',
    ),
  ]);

  let diamondAccount = null;
  if (payerAddr) {
    try {
      const res = await fetch(
        `https://devnode.telegraphprotocol.com/v1/ledger/account/${payerAddr}`,
      );
      if (res.ok) diamondAccount = await res.json();
    } catch {
      // Optional read-only check
    }
  }

  console.log(
    JSON.stringify(
      {
        network: 'Ethereum Sepolia (chainId 11155111)',
        envFileExists: fs.existsSync(ENV_PATH),
        gitIgnoredVerified: true,
        telegraphDiamond: TELEGRAPH_DIAMOND,
        testUsdcContract: SEPOLIA_USDC,
        wallets,
        telegraphEscrowLedger: diamondAccount,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || (!args.has('--generate') && !args.has('--print-public'))) {
    console.log(
      [
        'REVERT Disposable Sepolia Wallet Setup (zero private-key output)',
        '  node scripts/setup-wallets.mjs --generate       Generate 3 disposable wallets into git-ignored .env',
        '  node scripts/setup-wallets.mjs --print-public   Display ONLY public addresses & live Sepolia balances',
        '  Add --force-overwrite only if you explicitly intend to replace existing .env credentials.',
      ].join('\n'),
    );
    return;
  }

  assertEnvGitIgnored();

  if (args.has('--generate')) {
    const force = args.has('--force-overwrite');
    if (fs.existsSync(ENV_PATH) && !force) {
      const existing = parseEnvFile(ENV_PATH);
      const alreadySet = [
        'DEPLOYER_PRIVATE_KEY',
        'TELEGRAPH_PAYER_PRIVATE_KEY',
        'ATTESTOR_PRIVATE_KEY',
      ].filter((k) => Boolean(existing.get(k)));
      if (alreadySet.length > 0) {
        throw new Error(
          `Refusing to overwrite existing .env keys (${alreadySet.join(', ')}). Re-run with --force-overwrite only if intended.`,
        );
      }
    }

    const template = fs.existsSync(ENV_EXAMPLE_PATH)
      ? fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8')
      : '';

    const deployerKey = generatePrivateKey();
    const payerKey = generatePrivateKey();
    const attestorKey = generatePrivateKey();

    let nextContent = template
      .replace(/^DEPLOYER_PRIVATE_KEY=.*$/m, `DEPLOYER_PRIVATE_KEY=${deployerKey}`)
      .replace(/^TELEGRAPH_PAYER_PRIVATE_KEY=.*$/m, `TELEGRAPH_PAYER_PRIVATE_KEY=${payerKey}`)
      .replace(/^ATTESTOR_PRIVATE_KEY=.*$/m, `ATTESTOR_PRIVATE_KEY=${attestorKey}`);

    if (!nextContent.includes('VITE_ATTESTOR_ADDRESS=')) {
      const attestorAddress = privateKeyToAccount(attestorKey).address;
      nextContent += `\n# Public frontend config derived from generated attestor\nVITE_ATTESTOR_ADDRESS=${attestorAddress}\nVITE_SEPOLIA_RPC_URL=${SEPOLIA_RPC_DEFAULT}\n`;
    }

    fs.writeFileSync(ENV_PATH, nextContent, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(ENV_PATH, 0o600);
    } catch {
      // Windows ACL fallback
    }
    console.log(
      'Generated 3 disposable Sepolia-only wallets into git-ignored .env (private keys suppressed).',
    );
  }

  const currentEnv = parseEnvFile(ENV_PATH);
  await printPublicStatus(currentEnv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
