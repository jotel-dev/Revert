import { createPublicClient, formatEther, http } from 'viem';
import type { ConditionalTxCondition, IndependentOnchainObservation } from '@revert/shared';

const DEFAULT_PUBLIC_RPCS: Record<string, string> = {
  ethereum: 'https://ethereum-rpc.publicnode.com',
  sepolia: 'https://ethereum-sepolia-rpc.publicnode.com',
  base: 'https://base-rpc.publicnode.com',
  'base-sepolia': 'https://base-sepolia-rpc.publicnode.com',
  arbitrum: 'https://arbitrum-one-rpc.publicnode.com',
  optimism: 'https://optimism-rpc.publicnode.com',
  polygon: 'https://polygon-bor-rpc.publicnode.com',
};

export interface IndependentRpcVerifier {
  verifyTransaction(condition: ConditionalTxCondition): Promise<IndependentOnchainObservation>;
}

export class ViemIndependentRpcVerifier implements IndependentRpcVerifier {
  private readonly rpcByChain: Record<string, string>;

  constructor(
    customRpcByChain: Record<string, string> = {},
    private readonly timeoutMs = 8_000,
  ) {
    this.rpcByChain = { ...DEFAULT_PUBLIC_RPCS, ...customRpcByChain };
  }

  async verifyTransaction(
    condition: ConditionalTxCondition,
  ): Promise<IndependentOnchainObservation> {
    const rpcUrl = this.rpcByChain[condition.chain];
    if (!rpcUrl) {
      return { checked: false, error: `No RPC configured for chain ${condition.chain}` };
    }

    try {
      const client = createPublicClient({
        transport: http(rpcUrl, { timeout: this.timeoutMs }),
      });

      const [tx, receipt] = await Promise.all([
        client.getTransaction({ hash: condition.txHash }),
        client.getTransactionReceipt({ hash: condition.txHash }).catch(() => null),
      ]);

      if (!receipt) {
        return { checked: true, status: 'not_found' };
      }

      return {
        checked: true,
        status: receipt.status === 'success' ? 'confirmed' : 'reverted',
        from: tx.from.toLowerCase(),
        ...(tx.to ? { to: tx.to.toLowerCase() } : {}),
        valueEth: Number(formatEther(tx.value)),
      };
    } catch (err) {
      return {
        checked: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
