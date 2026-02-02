# Supported DEXes

## ✅ Currently Supported (Uniswap V2 Compatible)

All these DEXes use the same AMM formula and interfaces, so they work with the existing scanner:

### Mainnet
- **Uniswap V2** - Original DEX, high liquidity
- **Sushiswap** - Major Uni V2 fork, competitive liquidity
- **ShibaSwap** - Community-driven, moderate liquidity

### Pairs Being Scanned
1. **WETH/USDC** (Uniswap ↔ Sushiswap)
2. **WETH/DAI** (Uniswap ↔ Sushiswap)
3. **WETH/USDT** (Uniswap ↔ Sushiswap)
4. **WETH/WBTC** (Uniswap ↔ Sushiswap) - High value trades
5. **USDC/USDT** (Uniswap) - Stablecoin arb
6. **USDC/DAI** (Uniswap) - Stablecoin arb
7. **DAI/USDT** (Uniswap) - Stablecoin arb

## 🔄 Easy to Add (Uniswap V2 Forks)

Just need factory/router addresses:

### Ethereum Mainnet
- Fraxswap
- Doodle DEX
- Any Uni V2 clone

### Other Chains (Same Scanner Works!)
- **PancakeSwap** (BSC, Ethereum)
- **Trader Joe** (Avalanche)
- **SpookySwap** (Fantom)
- **QuickSwap** (Polygon)
- **Pangolin** (Avalanche)

**How to add:** Call `scanner.addPair(tokenA, tokenB, 'dexname', 'PAIR-LABEL')`

## ❌ NOT Supported (Different Protocols)

These require separate scanner implementations:

### Uniswap V3
- **Why different:** Concentrated liquidity, tick-based pricing
- **Impact:** Holds 60%+ of mainnet DEX liquidity
- **Priority:** HIGH - build this next for max opportunities

### Curve Finance
- **Why different:** StableSwap algorithm optimized for low-slippage stablecoin swaps
- **Impact:** Best for USDC/USDT/DAI arbitrage
- **Priority:** MEDIUM - good for stablecoin strategies

### Balancer
- **Why different:** Weighted pools with multiple tokens
- **Impact:** Niche opportunities
- **Priority:** LOW - advanced strategies only

### 0x Protocol / 1inch
- **Why different:** Aggregators that route through multiple DEXes
- **Impact:** They compete with you for same opportunities
- **Priority:** N/A - competitors, not sources

## Adding a New V2 Fork

### Option 1: Hardcode (Fast)
Edit `lib/uniswap-scanner.js`:

```javascript
const DEX_FACTORIES = {
  mainnet: {
    uniswap: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    sushiswap: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
    newdex: '0x...', // Add here
  }
};

const KNOWN_PAIRS = {
  mainnet: {
    'WETH-USDC-newdex': { 
      pair: '0x...', 
      dex: 'newdex',
      token0: 'USDC',
      token1: 'WETH'
    },
  }
};
```

### Option 2: Dynamic Discovery (Flexible)
```javascript
// In bot initialization or runtime
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

await scanner.addPair(WETH, USDC, 'newdex', 'WETH-USDC');
```

## Current Scanner Limitations

1. **V2 Only:** Misses V3, Curve, Balancer opportunities
2. **Ethereum Mainnet:** No multi-chain support yet (but V2 scanner works on any EVM chain)
3. **Hardcoded Pairs:** Doesn't discover new pairs automatically (can be added)
4. **No DEX Aggregator Integration:** Doesn't check 1inch, Paraswap, etc.

## What You Get Today

With the updated scanner you can now scan:
- ✅ 3 DEXes (Uniswap V2, Sushiswap, ShibaSwap)
- ✅ 10 major pairs (7 shown above + more can be added)
- ✅ ~30 potential arbitrage routes (each pair × DEX combinations)
- ✅ Sorted by profit potential
- ✅ Gas cost filtering
- ✅ Minimum profit threshold

## Next Steps to Maximize Opportunities

**Immediate (Today):**
- Deploy to Sepolia and test real scanning
- Add flash loan (Aave) so you don't need pre-funded capital

**This Week:**
- Build Uniswap V3 scanner (60% more liquidity!)
- Add Curve scanner for stablecoin arb

**This Month:**
- Multi-chain support (Polygon, Arbitrum, BSC)
- Auto-discovery of new pairs
- Advanced routing (3+ hop arbitrage)
