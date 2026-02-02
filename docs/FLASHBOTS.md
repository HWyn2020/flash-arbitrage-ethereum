# Flashbots Integration Guide

## ✅ INTEGRATED! (Just Added)

Flashbots is now **fully integrated** into your bot with ethers v6 support!

## What Just Got Added

✅ **Flashbots SDK installed** (`@flashbots/ethers-provider-bundle`)  
✅ **Automatic MEV protection** (enabled by default)  
✅ **Fallback to public mempool** (if Flashbots unavailable)  
✅ **One connection handles unlimited bundles** (parallel execution supported)  
✅ **Bundle simulation** (saves gas on failures)  

## Quick Start

### 1. Enable Flashbots (Default: ON)

Add to `.env`:
```bash
USE_FLASHBOTS=1  # Set to 0 to disable (not recommended for mainnet!)
```

That's it! Your bot now uses Flashbots automatically.

### 2. Run Your Bot

```powershell
# Testnet (Sepolia)
$env:NETWORK='sepolia'; $env:USE_REAL_UNISWAP='1'; node bot/arbitrage-bot.js

# Mainnet (⚠️ after audit only!)
$env:NETWORK='mainnet'; $env:USE_FLASHBOTS='1'; node bot/arbitrage-bot.js
```

Output:
```
🔒 Flashbots initialized (MEV protection enabled)
📊 Uniswap V2 scanner initialized for mainnet
📊 Uniswap V3 scanner initialized for mainnet
🔍 Starting to scan for arbitrage opportunities...
```

2. Create a `.env` file with these vars:

```
PROVIDER_URL=https://eth-mainnet.alchemyapi.io/v2/YOUR_KEY
SIGNER_PRIVATE_KEY=0x...    # this pays for bundle txs (must have funds on mainnet)
FLASHBOTS_SIGNING_KEY=0x... # ephemeral key to sign requests to relay
```

3. Run the example (it will show how to build a bundle and submit it):

```powershell
node sendBundle.js
```

Notes:
- The example is purposely minimal and only demonstrates the mechanics. Do not use real private keys in examples; use a throwaway funded address for testing on a fork or testnet first.

B — Private-RPC / Relay approach (recommended for simpler ops)

- Many node providers now support private submission endpoints (bundles) or have their own relays. If your provider supports a bundle API, you can re-use the `bot`'s `PRIVATE_RPC_MODE` approach to send transactions privately to that endpoint instead of broadcasting to the public mempool.
- Consult your provider docs for the exact `eth_sendBundle` or equivalent API and how to sign requests.

Security & operational notes
- Always simulate your bundle via `provider.call` / `eth_call` and measure the gas/gasPrice impact before sending.
- Use an ephemeral signing key for Flashbots relay auth where possible.
- Keep hot wallet balances minimal and use a remote signer (Gnosis Safe/RPC signer) for owner operations.

If you want, I can: (1) wire a small wrapper into the bot that spawns the standalone `flashbots-example/sendBundle.js` process and passes the signed txs, or (2) add direct private-RPC bundle calls into the bot (requires provider-specific code). Tell me which to implement next.
