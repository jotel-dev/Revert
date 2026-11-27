/**
 * Full-stack local integration test (PHASE 6):
 * Spins up:
 *   1) Local Foundry Anvil EVM (chainId 11155111)
 *   2) Deploys MockERC20 (6 decimals) + RevertEscrow.sol from compiled Forge artifacts
 *   3) Local [MOCKED-TELEGRAPH] HTTP server supporting confirmed, mismatched, raw & 503 outage modes
 *   4) Real Fastify Verification API (ViemEscrowChainGateway + VerificationEngine + Eip712SettlementAttestor)
 *   5) Real built @revert/web Vite bundle with injected EIP-1193 wallet in Playwright Chromium
 *
 * Tests all 18 Phase 6 scenarios end-to-end with real EVM transactions + browser UI.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import console from 'node:console';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http as viemHttp,
  parseUnits,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { TELEGRAPH_INTENT_NAME } from '../packages/shared/dist/index.js';
import { deriveSignalHash, TelegraphClient } from '../packages/telegraph-client/dist/index.js';
import {
  createApp,
  Eip712SettlementAttestor,
  VerificationEngine,
  VerificationStateStore,
  ViemEscrowChainGateway,
} from '../apps/api/dist/index.js';

const ANVIL_ACCOUNTS = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  attestor: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  sender: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  recipient: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  stranger: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
};

const SEPOLIA_DIAMOND = '0x72a70e949362670bf8bcead24efc5b8f950aa08b';

function resolveAnvilBin() {
  const homeBin = path.join(
    os.homedir(),
    '.foundry',
    'bin',
    process.platform === 'win32' ? 'anvil.exe' : 'anvil',
  );
  return fs.existsSync(homeBin) ? homeBin : 'anvil';
}

async function waitForRpc(rpcUrl) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (r.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Anvil RPC failed to start');
}

function loadForgeArtifact(relPath) {
  const full = path.resolve(import.meta.dirname, '..', 'packages', 'contracts', 'out', relPath);
  const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  return {
    abi: raw.abi,
    bytecode: raw.bytecode.object,
    deployedBytecode: raw.deployedBytecode.object,
  };
}

async function main() {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const anvilPort = 18545;
  const rpcUrl = `http://127.0.0.1:${anvilPort}`;

  const anvil = spawn(
    resolveAnvilBin(),
    ['--port', String(anvilPort), '--chain-id', '11155111', '--silent'],
    { stdio: 'ignore' },
  );

  let mockTelegraphServer;
  let webProxyServer;
  let fastifyApp;
  let browser;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revert-fullstack-'));

  try {
    await waitForRpc(rpcUrl);

    const publicClient = createPublicClient({ chain: sepolia, transport: viemHttp(rpcUrl) });
    const testClient = createTestClient({
      chain: sepolia,
      mode: 'anvil',
      transport: viemHttp(rpcUrl),
    });

    const deployerAcc = privateKeyToAccount(ANVIL_ACCOUNTS.deployer);
    const attestorAcc = privateKeyToAccount(ANVIL_ACCOUNTS.attestor);
    const senderAcc = privateKeyToAccount(ANVIL_ACCOUNTS.sender);
    const recipientAcc = privateKeyToAccount(ANVIL_ACCOUNTS.recipient);

    const deployerWallet = createWalletClient({
      account: deployerAcc,
      chain: sepolia,
      transport: viemHttp(rpcUrl),
    });

    // Deploy MockERC20 (6 decimals), MockMulticall3, & RevertEscrow
    const mockErc20Art = loadForgeArtifact('MockERC20.sol/MockERC20.json');
    const mockMulticallArt = loadForgeArtifact('MockMulticall3.sol/MockMulticall3.json');
    const revertEscrowArt = loadForgeArtifact('RevertEscrow.sol/RevertEscrow.json');

    await testClient.setCode({
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      bytecode: mockMulticallArt.deployedBytecode,
    });

    const tokenTx = await deployerWallet.deployContract({
      abi: mockErc20Art.abi,
      bytecode: mockErc20Art.bytecode,
      args: ['USD Coin', 'USDC', 6],
    });
    const tokenRcpt = await publicClient.waitForTransactionReceipt({ hash: tokenTx });
    const usdcAddress = tokenRcpt.contractAddress;
    assert(usdcAddress, 'MockERC20 deployed');

    // Etch MockERC20 bytecode + name/symbol storage slots at canonical SEPOLIA_TEST_USDC_ADDRESS
    const canonicalUsdc = '0xcc194e1a843B658526D0D5C431f670028582Ae17';
    const deployedCode = await publicClient.getCode({ address: usdcAddress });
    await testClient.setCode({ address: canonicalUsdc, bytecode: deployedCode });
    for (let slot = 0; slot <= 5; slot++) {
      const slotHex = toHex(slot, { size: 32 });
      const val = await publicClient.getStorageAt({ address: usdcAddress, slot: slotHex });
      if (val) {
        await testClient.setStorageAt({ address: canonicalUsdc, index: slotHex, value: val });
      }
    }

    const escrowDeployTx = await deployerWallet.deployContract({
      abi: revertEscrowArt.abi,
      bytecode: revertEscrowArt.bytecode,
      args: [deployerAcc.address, [canonicalUsdc]],
    });
    const escrowRcpt = await publicClient.waitForTransactionReceipt({ hash: escrowDeployTx });
    const escrowAddress = escrowRcpt.contractAddress;
    assert(escrowAddress, 'RevertEscrow deployed on Anvil');

    // Mint 1000 Test USDC to sender
    const mintTx = await deployerWallet.writeContract({
      address: canonicalUsdc,
      abi: mockErc20Art.abi,
      functionName: 'mint',
      args: [senderAcc.address, parseUnits('1000', 6)],
    });
    await publicClient.waitForTransactionReceipt({ hash: mintTx });

    // 2) Start [MOCKED-TELEGRAPH] node supporting normal confirmed, mismatched, raw, and 503 outage modes
    let telegraphBehavior = 'confirmed';
    const signalStore = new Map();

    mockTelegraphServer = http.createServer(async (req, res) => {
      const url = req.url || '/';
      if (req.method === 'GET' && url.startsWith('/engine/v1/intents/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            intent_name: TELEGRAPH_INTENT_NAME,
            miner_count: 32,
            request: { params: [{ name: 'tx_hash', type: 'string' }] },
            response: { fields: [{ name: 'status', type: 'enum' }] },
            onchain: { ready: true },
          }),
        );
        return;
      }
      if (req.method === 'POST' && url === '/engine/v1/ask') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const xPay = req.headers['x-payment'];

        if (telegraphBehavior === 'outage') {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'upstream outage' }));
          return;
        }

        if (!xPay) {
          const challenge = {
            x402Version: 2,
            accepts: [
              {
                scheme: 'escrow',
                network: 'eip155:11155111',
                amount: '10000',
                payTo: SEPOLIA_DIAMOND,
                extra: {
                  message:
                    'Telegraph Escrow Payment\n\nWallet: {from}\nPay To: 0x72a70e949362670bf8bcead24efc5b8f950aa08b\nNetwork: eip155:11155111\nAmount: 10000 uUSDC\nResource: /v1/ask\nNonce: {nonce}\nValid After: {validAfter}\nValid Before: {validBefore}',
                },
              },
            ],
          };
          res.writeHead(402, {
            'Content-Type': 'application/json',
            'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(challenge)).toString('base64'),
          });
          res.end(JSON.stringify({ error: 'payment required' }));
          return;
        }

        const payload = {
          intent: TELEGRAPH_INTENT_NAME,
          tx_hash: body.params.tx_hash,
          mode: telegraphBehavior,
        };
        const sigHash = deriveSignalHash(payload);
        signalStore.set(sigHash, payload);

        const receipt = Buffer.from(
          JSON.stringify({
            receipt_hash: '0x3333333333333333333333333333333333333333333333333333333333333333',
            rail: 'escrow',
            payer: senderAcc.address.toLowerCase(),
            miner: '9002',
            intent: TELEGRAPH_INTENT_NAME,
            amount_uusdc: '10000',
            epoch_id: 58,
            settlement: 'epoch',
            chain: 'telegraph',
            timestamp: Math.floor(Date.now() / 1000),
          }),
        ).toString('base64');

        const resultObj =
          telegraphBehavior === 'raw'
            ? 'transaction confirmed raw text'
            : telegraphBehavior === 'mismatch'
              ? {
                  tx_hash: body.params.tx_hash,
                  status: 'confirmed',
                  from: senderAcc.address,
                  to: '0x9999999999999999999999999999999999999999',
                  value_eth: 1,
                }
              : {
                  tx_hash: body.params.tx_hash,
                  status: 'confirmed',
                  from: senderAcc.address,
                  to: recipientAcc.address,
                  block_number: 100,
                  value_eth: 0.5,
                };

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-PAYMENT-RESPONSE': receipt,
        });
        res.end(
          JSON.stringify({
            miner_id: '9002',
            miner_name: 'TxLens (Mocked Local)',
            intent: TELEGRAPH_INTENT_NAME,
            result_shape: telegraphBehavior === 'raw' ? 'raw' : 'intent',
            field_status: { status: 'ok' },
            signal_hash: sigHash,
            fulfillment: { status: 'complete' },
            result: resultObj,
          }),
        );
        return;
      }

      if (req.method === 'GET' && url.startsWith('/engine/v1/signal/')) {
        const hash = url.split('/').pop();
        const payload = signalStore.get(hash);
        if (!payload) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ payload, verification: { verified: true } }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise((r) => mockTelegraphServer.listen(0, '127.0.0.1', r));
    const telegraphPort = mockTelegraphServer.address().port;
    const telegraphUrl = `http://127.0.0.1:${telegraphPort}`;

    // 3) Start Real Fastify Verification API connected to Anvil
    const telegraphClient = new TelegraphClient({
      nodeUrl: telegraphUrl,
      privateKey: ANVIL_ACCOUNTS.deployer,
      maxPerRequestUusdc: 10_000n,
      maxTotalBudgetUusdc: 30_000n,
      maxPrePaymentRetries: 0,
      evidenceDir: path.join(tmpDir, 'evidence'),
      ledgerPersistPath: path.join(tmpDir, 'ledger.json'),
    });

    const chainGateway = new ViemEscrowChainGateway(rpcUrl, escrowAddress);
    const attestor = new Eip712SettlementAttestor(ANVIL_ACCOUNTS.attestor, 11155111, escrowAddress);
    const engine = new VerificationEngine({
      chainGateway,
      telegraphClient,
      rpcVerifier: {
        verifyTransaction: async () => ({
          checked: true,
          status: 'confirmed',
          from: senderAcc.address.toLowerCase(),
          to: recipientAcc.address.toLowerCase(),
          valueEth: 0.5,
        }),
      },
      attestor,
      stateStore: new VerificationStateStore(path.join(tmpDir, 'state.json')),
      allowLiveSpend: true,
      retryCooldownSeconds: 0,
    });

    fastifyApp = await createApp({
      engine,
      telegraphClient,
      chainId: 11155111,
      escrowContractAddress: escrowAddress,
      corsOrigin: '*',
      rateLimitMax: 300,
    });
    await fastifyApp.listen({ host: '127.0.0.1', port: 0 });
    const apiPort = fastifyApp.server.address().port;

    // 4) Build @revert/web with VITE_REVERT_ESCROW_ADDRESS, VITE_ATTESTOR_ADDRESS & VITE_SEPOLIA_RPC_URL pointing to Anvil
    const webDir = path.join(repoRoot, 'apps', 'web');
    const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [viteBin, 'build'], {
        cwd: webDir,
        shell: false,
        env: {
          ...process.env,
          VITE_REVERT_ESCROW_ADDRESS: escrowAddress,
          VITE_ATTESTOR_ADDRESS: attestorAcc.address,
          VITE_SEPOLIA_RPC_URL: rpcUrl,
        },
      });
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`vite build exited ${code}`)),
      );
    });

    // Serve dist + proxy /api and /health to Fastify
    const distDir = path.join(webDir, 'dist');
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    };
    webProxyServer = http.createServer(async (req, res) => {
      const reqUrl = (req.url || '/').split('?')[0];
      if (reqUrl === '/health' || reqUrl.startsWith('/api/')) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const upstream = await fetch(`http://127.0.0.1:${apiPort}${req.url}`, {
          method: req.method,
          headers: { 'content-type': req.headers['content-type'] || 'application/json' },
          body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
        });
        res.writeHead(upstream.status, {
          'content-type': upstream.headers.get('content-type') || 'application/json',
        });
        res.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }

      let filePath = path.join(distDir, reqUrl === '/' ? 'index.html' : reqUrl);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distDir, 'index.html');
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'content-type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });

    await new Promise((r) => webProxyServer.listen(0, '127.0.0.1', r));
    const webUrl = `http://127.0.0.1:${webProxyServer.address().port}`;

    // 5) Launch Playwright Chromium with real Anvil-backed injected EIP-1193 wallet
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    let activeWalletKey = ANVIL_ACCOUNTS.sender;
    let activeChainHex = '0x1'; // Start on wrong network (mainnet) to test network switch!

    await page.exposeFunction('__anvilWalletRpc', async (method, params) => {
      const acc = privateKeyToAccount(activeWalletKey);
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
        return [acc.address];
      }
      if (method === 'eth_chainId') {
        return activeChainHex;
      }
      if (method === 'net_version') {
        return String(parseInt(activeChainHex, 16));
      }
      if (method === 'wallet_switchEthereumChain') {
        activeChainHex = params[0].chainId;
        return null;
      }
      if (method === 'eth_sendTransaction') {
        const txParams = params[0];
        const wallet = createWalletClient({
          account: acc,
          chain: sepolia,
          transport: viemHttp(rpcUrl),
        });
        return wallet.sendTransaction({
          to: txParams.to,
          data: txParams.data,
          value: txParams.value ? BigInt(txParams.value) : 0n,
        });
      }
      // Forward read-only RPC calls to Anvil
      const r = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    });

    await page.addInitScript(() => {
      const origNow = Date.now.bind(Date);
      Date.now = () =>
        origNow() + Number(globalThis.sessionStorage?.getItem('__anvilOffsetMs') || '0');
      const listeners = new Map();
      const emit = (ev, payload) => {
        for (const fn of listeners.get(ev) || []) {
          try {
            fn(payload);
          } catch {
            // ignore
          }
        }
      };
      globalThis.window.ethereum = {
        isMetaMask: true,
        request: async ({ method, params }) => {
          const result = await globalThis.window.__anvilWalletRpc(method, params || []);
          if (method === 'wallet_switchEthereumChain' && params?.[0]?.chainId) {
            emit('chainChanged', params[0].chainId);
          }
          if (method === 'eth_requestAccounts' && Array.isArray(result)) {
            emit('accountsChanged', result);
          }
          return result;
        },
        on: (ev, fn) => {
          const list = listeners.get(ev) || [];
          list.push(fn);
          listeners.set(ev, list);
        },
        removeListener: (ev, fn) => {
          const list = listeners.get(ev) || [];
          listeners.set(
            ev,
            list.filter((item) => item !== fn),
          );
        },
      };
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') console.error('BROWSER CONSOLE ERROR:', msg.text());
    });
    page.on('pageerror', (err) => console.error('BROWSER PAGE ERROR:', err.message));

    // Test 1 & 2: Connect wallet on wrong network -> Switch to Sepolia
    await page.goto(`${webUrl}/app`);
    await page.getByRole('button', { name: 'Connect Wallet' }).click();
    await page.getByText(/Wrong network connected/i).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: /Switch to Ethereum Sepolia/i }).click();
    await page
      .getByText(/Wrong network connected/i)
      .waitFor({ state: 'detached', timeout: 10_000 });
    await page.getByText('1,000.00 USDC').waitFor({ timeout: 10_000 });
    console.log('PASS [1,2]: Wallet connected & switched network to 11155111');

    // Test 3, 4, 5: Create Mode A Protected escrow (approve + create) -> Cancel
    await page.goto(`${webUrl}/create`);
    await page.getByLabel('Recipient Address').fill(recipientAcc.address);
    await page.getByLabel('Amount (USDC)').fill('25.00');
    await page.getByRole('button', { name: /Review Terms/i }).click();
    await page.getByRole('button', { name: /Approve & Lock Funds/i }).click();
    await page.waitForURL(/\/payments\/1$/, { timeout: 20_000 });
    await page.getByText('25.00 USDC').first().waitFor({ timeout: 10_000 });
    console.log('PASS [3,4]: USDC approved & Mode A Protected escrow #1 created on Anvil');

    await page.getByRole('button', { name: /Cancel & Reclaim/i }).click();
    await page.getByText('REFUNDED').first().waitFor({ timeout: 15_000 });
    console.log('PASS [5]: Mode A Sender cancellation confirmed on Anvil');

    // Test 6: Create Mode A #2 -> warp past recovery window -> Recipient claims
    await page.goto(`${webUrl}/create`);
    await page.getByLabel('Recipient Address').fill(recipientAcc.address);
    await page.getByLabel('Amount (USDC)').fill('30.00');
    await page.getByLabel('Recovery Window (minutes)').fill('1');
    await page.getByRole('button', { name: /Review Terms/i }).click();
    await page.getByRole('button', { name: /Approve & Lock Funds/i }).click();
    await page.waitForURL(/\/payments\/2$/, { timeout: 20_000 });

    await testClient.increaseTime({ seconds: 120 });
    await testClient.mine({ blocks: 1 });
    await page.evaluate(() => {
      const prev = Number(globalThis.sessionStorage.getItem('__anvilOffsetMs') || '0');
      globalThis.sessionStorage.setItem('__anvilOffsetMs', String(prev + 120_000));
    });
    activeWalletKey = ANVIL_ACCOUNTS.recipient;
    await page.reload();
    await page.getByRole('button', { name: /Claim Payment/i }).click();
    await page.getByText('RELEASED').first().waitFor({ timeout: 15_000 });
    console.log('PASS [6]: Mode A Recipient claim confirmed on Anvil');

    // Test 7, 8, 9, 17: Create Mode B #3 -> Autonomous Telegraph Verify -> Settle with Proof -> Refresh
    activeWalletKey = ANVIL_ACCOUNTS.sender;
    await page.goto(`${webUrl}/create`);
    await page.getByRole('button', { name: /Mode B · Conditional Proof/i }).click();
    await page.getByLabel('Recipient Address').fill(recipientAcc.address);
    await page.getByLabel('Amount (USDC)').fill('50.00');
    await page.getByLabel('Expected Tx Recipient').fill(recipientAcc.address);
    await page.getByRole('button', { name: /Review Terms/i }).click();
    await page.getByRole('button', { name: /Approve & Lock Funds/i }).click();
    await page.waitForURL(/\/payments\/3$/, { timeout: 20_000 });

    await page.getByRole('button', { name: /Verify via Telegraph/i }).click();
    await page.getByText('SATISFIED').first().waitFor({ timeout: 15_000 });
    await page.getByText('0.01 USDC').first().waitFor({ timeout: 10_000 });

    // Test 14: Duplicate verification request while SATISFIED -> cached, no second Telegraph charge
    const dupRes = await fetch(`http://127.0.0.1:${apiPort}/api/escrows/3/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(dupRes.status, 200);
    const budgetAfterDup = await (await fetch(`http://127.0.0.1:${apiPort}/api/budget`)).json();
    assert.equal(budgetAfterDup.committedUusdc, '10000', 'Duplicate verify must not double-spend');
    console.log(
      'PASS [14]: Duplicate verification request served cached attestation without extra spend',
    );

    await page.getByRole('button', { name: /Settle with Proof/i }).click();
    await page.getByText('RELEASED').first().waitFor({ timeout: 15_000 });

    // Browser refresh recovery check (#17)
    await page.reload();
    await page.getByText('RELEASED').first().waitFor({ timeout: 10_000 });
    await page.getByText('SATISFIED').first().waitFor({ timeout: 10_000 });
    console.log(
      'PASS [7,8,9,17]: Mode B creation, Telegraph verification, EIP-712 settlement & refresh recovery',
    );

    // Test 10, 11, 12, 13, 15, 16: Mode B #4 -> Outage -> Mismatch -> Raw -> Spending Cap -> Unauthorized Signer -> Timeout Refund
    await page.goto(`${webUrl}/create`);
    await page.getByRole('button', { name: /Mode B · Conditional Proof/i }).click();
    await page.getByLabel('Recipient Address').fill(recipientAcc.address);
    await page.getByLabel('Amount (USDC)').fill('40.00');
    await page.getByLabel('Expected Tx Recipient').fill(recipientAcc.address);
    await page.getByLabel('Settlement Deadline (hours)').fill('1');
    await page.getByRole('button', { name: /Review Terms/i }).click();
    await page.getByRole('button', { name: /Approve & Lock Funds/i }).click();
    await page.waitForURL(/\/payments\/4$/, { timeout: 20_000 });

    telegraphBehavior = 'outage';
    await page.getByRole('button', { name: /Verify via Telegraph/i }).click();
    await page.getByText('INCONCLUSIVE').first().waitFor({ timeout: 10_000 });
    const budgetAfterOutage = await (await fetch(`http://127.0.0.1:${apiPort}/api/budget`)).json();
    assert.equal(
      budgetAfterOutage.committedUusdc,
      '10000',
      'Outage pre-payment must release reservation',
    );

    telegraphBehavior = 'mismatch';
    await page.getByRole('button', { name: /Verify via Telegraph/i }).click();
    await page.getByText('CONTRADICTED').first().waitFor({ timeout: 10_000 });
    assert(await page.getByRole('button', { name: /Settle with Proof/i }).isDisabled());

    telegraphBehavior = 'raw';
    await page.getByRole('button', { name: /Verify via Telegraph/i }).click();
    await page.getByText('INCONCLUSIVE').first().waitFor({ timeout: 10_000 });
    assert(await page.getByRole('button', { name: /Settle with Proof/i }).isDisabled());

    // Test 15: Spending-cap enforcement (30,000 uUSDC total spent -> next request blocked by cap)
    telegraphBehavior = 'confirmed';
    const capRes = await fetch(`http://127.0.0.1:${apiPort}/api/escrows/4/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    assert.equal(capRes.status, 200);
    const capJob = await capRes.json();
    assert.equal(capJob.status, 'INCONCLUSIVE');
    assert.match(capJob.lastError || '', /budget|cap/i);
    const budgetAfterCap = await (await fetch(`http://127.0.0.1:${apiPort}/api/budget`)).json();
    assert.equal(budgetAfterCap.committedUusdc, '30000');
    assert.equal(budgetAfterCap.remainingUusdc, '0');
    console.log('PASS [15]: Total Telegraph spending cap enforced cleanly');

    // Test 16: Unauthorized attestor signature rejected on Anvil RevertEscrow.settleConditional
    const escrow4 = await chainGateway.getEscrow('4');
    assert(escrow4, 'Escrow 4 loaded from Anvil');
    const strangerAttestor = new Eip712SettlementAttestor(
      ANVIL_ACCOUNTS.stranger,
      11155111,
      escrowAddress,
    );
    const nowBlk = (await publicClient.getBlock()).timestamp;
    const forged = await strangerAttestor.signReleaseAttestation({
      escrowId: '4',
      conditionHash: escrow4.conditionHash,
      evidencePayload: { forged: true },
      signalHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      receiptHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
      nowUnix: Number(nowBlk) - 5,
      ttlSeconds: 300,
    });
    await assert.rejects(
      () =>
        publicClient.simulateContract({
          address: escrowAddress,
          abi: revertEscrowArt.abi,
          functionName: 'settleConditional',
          args: [
            {
              escrowId: BigInt(forged.input.escrowId),
              outcome: forged.input.outcome,
              evidenceHash: forged.input.evidenceHash,
              signalHash: forged.input.signalHash,
              receiptHash: forged.input.receiptHash,
              nonce: forged.input.nonce,
              issuedAt: BigInt(forged.input.issuedAt),
              expiresAt: BigInt(forged.input.expiresAt),
            },
            forged.signature,
          ],
          account: senderAcc.address,
        }),
      /InvalidAttestorSignature/,
    );
    console.log('PASS [16]: Unauthorized EIP-712 attestor signature rejected by RevertEscrow');

    // Warp past 1h deadline -> permissionless Refund Expired
    await testClient.increaseTime({ seconds: 4000 });
    await testClient.mine({ blocks: 1 });
    await page.evaluate(() => {
      const prev = Number(globalThis.sessionStorage.getItem('__anvilOffsetMs') || '0');
      globalThis.sessionStorage.setItem('__anvilOffsetMs', String(prev + 4_000_000));
    });
    await page.reload();
    await page.getByRole('button', { name: /Refund Expired Escrow/i }).click();
    await page.getByText('REFUNDED').first().waitFor({ timeout: 15_000 });
    console.log(
      'PASS [10,11,12,13]: Mismatched, inconclusive, outage, and timeout refund recovery',
    );

    // Mobile viewport check against live Anvil + Fastify page
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${webUrl}/payments/3`);
    await page.getByText('RELEASED').first().waitFor({ timeout: 10_000 });
    const overflow = await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth - globalThis.window.innerWidth,
    );
    assert(overflow <= 0, `Unexpected mobile overflow: ${overflow}`);
    console.log('PASS [18]: Mobile responsive detail view against live API/Anvil (0 overflow)');
    console.log('ALL FULL-STACK ANVIL + FASTIFY + CHROMIUM E2E CHECKS PASSED');
  } finally {
    await browser?.close().catch(() => {});
    await fastifyApp?.close().catch(() => {});
    mockTelegraphServer?.close();
    webProxyServer?.close();
    anvil.kill();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Full-stack E2E failed:', err);
  process.exit(1);
});
