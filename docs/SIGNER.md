# Signer Options and Gnosis Safe / RPC Signer Guide

This project supports multiple signer options for local development and production. Use the option that best fits your risk tolerance and operational model.

ENV variables supported
- `PRIVATE_KEY`: a hex private key used by `lib/signer.js` to construct an ethers `Wallet` signer. Suitable for local development only — DO NOT USE ON MAINNET WITH REAL FUNDS.
- `RPC_SIGNER_URL`: a JSON-RPC endpoint hosting an unlocked account or signer (e.g., an internal node). The signer returned by the provider will be used.
- `SIGNER_TYPE=rpc`: legacy option used by `bot/arbitrage-bot.js` to prefer `provider.getSigner()`.

Recommended production signer patterns

1) Gnosis Safe (recommended for owner-level actions)
- Use a Gnosis Safe (multisig) for high-value owner operations like `configurePools`, `withdraw`, or `recordProfit` if those actions require owner privileges.
- Typical flow:
  - Deploy a Safe that includes operator(s) and a guardian.
  - Use `@gnosis.pm/safe-core-sdk` (or the Safe transaction service) to create and propose a transaction from the Safe.
  - Use a relayer or the Safe transaction service to execute the transaction (via safe multisig approvals).

2) Remote signer / Key Management System (KMS)
- Use a KMS or HSM provider that exposes a JSON-RPC signing endpoint OR use a transaction relay that accepts unsigned transactions and signs them in a secure environment.
- Set `RPC_SIGNER_URL` to your node that exposes a JSON-RPC signer interface.

3) Hot wallet with limited funds (for live bot execution)
- Use a hot wallet with limited ETH for gas; keep the owner-controlled funds in a multisig/safe.
- Provide `PRIVATE_KEY` only to trusted, ephemeral environments (containers with ephemeral secrets) and avoid sharing the key elsewhere.

Using the `lib/signer.js` helper
- The helper exposes `getSigner(provider)` which returns:
  - A remote provider signer if `RPC_SIGNER_URL` is set.
  - A `Wallet` constructed from `PRIVATE_KEY` if set.
  - Throws an error if no signer is available.

Gnosis Safe example (high level)
1. Install the Safe SDK in your deployment runner:

```powershell
npm install @gnosis.pm/safe-core-sdk @gnosis.pm/safe-ethers-lib
```

2. Use the Safe SDK to create and execute a transaction by building the ABI-encoded call to the contract (e.g., `executeArbitrage`) and propose it to the Safe for confirmation.

Security recommendations
- Never store production private keys in plaintext in the repository.
- Use environment secrets, vaults, or CI secret storage for keys.
- For critical owner operations prefer multisig + timelock.
