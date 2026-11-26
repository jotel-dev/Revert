import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { REVERT_ESCROW_ABI } from './abi.js';
import type { SignedSettlementAttestation } from './attestor.js';

export type EscrowModeName = 'Protected' | 'Conditional';
export type EscrowStateName = 'LOCKED' | 'RELEASED' | 'REFUNDED';

export interface OnchainEscrowRecord {
  escrowId: string;
  mode: EscrowModeName;
  state: EscrowStateName;
  sender: `0x${string}`;
  recipient: `0x${string}`;
  token: `0x${string}`;
  amount: string;
  createdAt: number;
  recoveryWindowEnd: number;
  deadline: number;
  conditionHash: `0x${string}`;
  attestor: `0x${string}`;
}

export interface EscrowChainGateway {
  listEscrows(): Promise<OnchainEscrowRecord[]>;
  getEscrow(escrowId: string): Promise<OnchainEscrowRecord | undefined>;
  isTokenAllowed(token: `0x${string}`): Promise<boolean>;
  broadcastSettlement(attestation: SignedSettlementAttestation): Promise<`0x${string}`>;
}

const MODE_MAP: Record<number, EscrowModeName> = {
  0: 'Protected',
  1: 'Conditional',
};

const STATE_MAP: Record<number, EscrowStateName> = {
  0: 'LOCKED',
  1: 'RELEASED',
  2: 'REFUNDED',
};

export class ViemEscrowChainGateway implements EscrowChainGateway {
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient | undefined;

  constructor(
    private readonly rpcUrl: string,
    private readonly contractAddress: `0x${string}`,
    broadcasterPrivateKey?: `0x${string}`,
  ) {
    this.publicClient = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl),
    });

    if (broadcasterPrivateKey) {
      const account = privateKeyToAccount(broadcasterPrivateKey);
      this.walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(rpcUrl),
      });
    }
  }

  async listEscrows(): Promise<OnchainEscrowRecord[]> {
    const nextId = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: REVERT_ESCROW_ABI,
      functionName: 'nextEscrowId',
    });

    const out: OnchainEscrowRecord[] = [];
    for (let id = 1n; id < nextId; id++) {
      const rec = await this.getEscrow(id.toString());
      if (rec) out.push(rec);
    }
    return out;
  }

  async getEscrow(escrowId: string): Promise<OnchainEscrowRecord | undefined> {
    try {
      const raw = await this.publicClient.readContract({
        address: this.contractAddress,
        abi: REVERT_ESCROW_ABI,
        functionName: 'getEscrow',
        args: [BigInt(escrowId)],
      });
      return {
        escrowId,
        mode: MODE_MAP[raw.mode] ?? 'Protected',
        state: STATE_MAP[raw.state] ?? 'LOCKED',
        sender: raw.sender.toLowerCase() as `0x${string}`,
        recipient: raw.recipient.toLowerCase() as `0x${string}`,
        token: raw.token.toLowerCase() as `0x${string}`,
        amount: raw.amount.toString(),
        createdAt: Number(raw.createdAt),
        recoveryWindowEnd: Number(raw.recoveryWindowEnd),
        deadline: Number(raw.deadline),
        conditionHash: raw.conditionHash.toLowerCase() as `0x${string}`,
        attestor: raw.attestor.toLowerCase() as `0x${string}`,
      };
    } catch {
      return undefined;
    }
  }

  async isTokenAllowed(token: `0x${string}`): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.contractAddress,
      abi: REVERT_ESCROW_ABI,
      functionName: 'allowedTokens',
      args: [token],
    });
  }

  async broadcastSettlement(attestation: SignedSettlementAttestation): Promise<`0x${string}`> {
    if (!this.walletClient || !this.walletClient.account) {
      throw new Error('Broadcaster private key not configured');
    }
    const { request } = await this.publicClient.simulateContract({
      account: this.walletClient.account,
      address: this.contractAddress,
      abi: REVERT_ESCROW_ABI,
      functionName: 'settleConditional',
      args: [
        {
          escrowId: BigInt(attestation.input.escrowId),
          outcome: attestation.input.outcome,
          evidenceHash: attestation.input.evidenceHash,
          signalHash: attestation.input.signalHash,
          receiptHash: attestation.input.receiptHash,
          nonce: attestation.input.nonce,
          issuedAt: BigInt(attestation.input.issuedAt),
          expiresAt: BigInt(attestation.input.expiresAt),
        },
        attestation.signature,
      ],
    });
    return this.walletClient.writeContract(request);
  }
}
