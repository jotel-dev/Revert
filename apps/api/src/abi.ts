export const REVERT_ESCROW_ABI = [
  {
    type: 'function',
    name: 'nextEscrowId',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allowedTokens',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getEscrow',
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'mode', type: 'uint8' },
          { name: 'state', type: 'uint8' },
          { name: 'sender', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'createdAt', type: 'uint64' },
          { name: 'recoveryWindowEnd', type: 'uint64' },
          { name: 'deadline', type: 'uint64' },
          { name: 'conditionHash', type: 'bytes32' },
          { name: 'attestor', type: 'address' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'settleConditional',
    inputs: [
      {
        name: 'input',
        type: 'tuple',
        components: [
          { name: 'escrowId', type: 'uint256' },
          { name: 'outcome', type: 'uint8' },
          { name: 'evidenceHash', type: 'bytes32' },
          { name: 'signalHash', type: 'bytes32' },
          { name: 'receiptHash', type: 'bytes32' },
          { name: 'nonce', type: 'bytes32' },
          { name: 'issuedAt', type: 'uint64' },
          { name: 'expiresAt', type: 'uint64' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'refundExpired',
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export const SETTLEMENT_ATTESTATION_TYPES = {
  SettlementAttestation: [
    { name: 'escrowId', type: 'uint256' },
    { name: 'conditionHash', type: 'bytes32' },
    { name: 'outcome', type: 'uint8' },
    { name: 'evidenceHash', type: 'bytes32' },
    { name: 'signalHash', type: 'bytes32' },
    { name: 'receiptHash', type: 'bytes32' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
  ],
} as const;
