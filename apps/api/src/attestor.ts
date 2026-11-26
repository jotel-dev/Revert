import crypto from 'node:crypto';
import { keccak256, recoverTypedDataAddress, stringToHex } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { SETTLEMENT_ATTESTATION_TYPES } from './abi.js';

export interface SignedSettlementAttestation {
  chainId: number;
  verifyingContract: `0x${string}`;
  attestor: `0x${string}`;
  conditionHash: `0x${string}`;
  input: {
    escrowId: string;
    outcome: 1 | 2; // 1 = RELEASE, 2 = REFUND
    evidenceHash: `0x${string}`;
    signalHash: `0x${string}`;
    receiptHash: `0x${string}`;
    nonce: `0x${string}`;
    issuedAt: number;
    expiresAt: number;
  };
  signature: `0x${string}`;
}

export class Eip712SettlementAttestor {
  private readonly account: PrivateKeyAccount;

  constructor(
    privateKey: `0x${string}`,
    private readonly chainId: number,
    private readonly verifyingContract: `0x${string}`,
  ) {
    this.account = privateKeyToAccount(privateKey);
  }

  getAddress(): `0x${string}` {
    return this.account.address.toLowerCase() as `0x${string}`;
  }

  async signReleaseAttestation(params: {
    escrowId: string;
    conditionHash: `0x${string}`;
    evidencePayload: unknown;
    signalHash: `0x${string}`;
    receiptHash: `0x${string}`;
    ttlSeconds?: number;
    nowUnix?: number;
  }): Promise<SignedSettlementAttestation> {
    const nowUnix = params.nowUnix ?? Math.floor(Date.now() / 1000);
    const ttlSeconds = Math.min(Math.max(params.ttlSeconds ?? 900, 60), 3600);
    const expiresAt = nowUnix + ttlSeconds;
    const nonce = `0x${crypto.randomBytes(32).toString('hex')}` as `0x${string}`;
    const evidenceHash = keccak256(stringToHex(JSON.stringify(params.evidencePayload)));

    const message = {
      escrowId: BigInt(params.escrowId),
      conditionHash: params.conditionHash,
      outcome: 1,
      evidenceHash,
      signalHash: params.signalHash,
      receiptHash: params.receiptHash,
      nonce,
      issuedAt: BigInt(nowUnix),
      expiresAt: BigInt(expiresAt),
    };

    const domain = {
      name: 'RevertEscrow',
      version: '1',
      chainId: this.chainId,
      verifyingContract: this.verifyingContract,
    } as const;

    const signature = await this.account.signTypedData({
      domain,
      types: SETTLEMENT_ATTESTATION_TYPES,
      primaryType: 'SettlementAttestation',
      message,
    });

    const recovered = await recoverTypedDataAddress({
      domain,
      types: SETTLEMENT_ATTESTATION_TYPES,
      primaryType: 'SettlementAttestation',
      message,
      signature,
    });

    if (recovered.toLowerCase() !== this.account.address.toLowerCase()) {
      throw new Error('EIP-712 self-verification failed');
    }

    return {
      chainId: this.chainId,
      verifyingContract: this.verifyingContract.toLowerCase() as `0x${string}`,
      attestor: this.getAddress(),
      conditionHash: params.conditionHash,
      input: {
        escrowId: params.escrowId,
        outcome: 1,
        evidenceHash,
        signalHash: params.signalHash,
        receiptHash: params.receiptHash,
        nonce,
        issuedAt: nowUnix,
        expiresAt,
      },
      signature,
    };
  }
}
