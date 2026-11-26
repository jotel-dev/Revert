# AI Usage Disclosure

AI engineering assistance was used during the design, implementation, testing, and documentation of REVERT:

- **Protocol & Live Verification:** All Telegraph endpoints, schemas, `402` challenges, and contract addresses were verified directly against `https://docs.telegraphprotocol.com/`, `https://devnode.telegraphprotocol.com`, and Ethereum Sepolia RPC (`2026-11-26`).
- **Runtime Application Architecture:** REVERT itself does **not** use a conversational AI assistant in its settlement pipeline. Mode B uses deterministic TypeScript policy evaluation over structured Telegraph `ONCHAIN_TX_LOOKUP_GENERAL` intent responses and EIP-712 cryptographic attestations.
