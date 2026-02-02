#!/usr/bin/env node
/*
  scripts/live-arb-scanner.js

  Live arbitrage scanner (Uniswap V2 forks + Uniswap V3) — copy-paste-and-run.

  WARNING: This script is powerful. It does NOT broadcast transactions by default.
  You are responsible for funds, signing, and submitting bundles.

  Usage examples:
    node scripts/live-arb-scanner.js 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
    node scripts/live-arb-scanner.js WETH USDC --watch --threshold 0.5

  Environment (.env): PROVIDER_URL (required), CONTRACT_ADDRESS (optional for calldata),
  SIGNER_PRIVATE_KEY (optional, only for preparing signed txs), COINGECKO_API (optional, usd price lookup)

  Notes:
  - This is a practical scanner aimed at UniswapV2-style and UniswapV3 pools.
  - Balancer/Curve integrations are best-effort stubs — extend per your infra.
  - Always test with `scripts/fork-test.js` before signing or sending bundles.
*/

require('dotenv').config();
const { ethers } = require('ethers');
const fetch = require('node-fetch');
const argv = process.argv.slice(2);

if (argv.length === 0) {
  console.error('Usage: node live-arb-scanner.js <tokenA> <tokenB> [--watch] [--threshold 0.5]');
  process.exit(2);
}

const tokenArgA = argv[0];
const tokenArgB = argv[1];
const watch = argv.includes('--watch');
const thresholdIndex = argv.indexOf('--threshold');
const thresholdPct = thresholdIndex >= 0 ? parseFloat(argv[thresholdIndex + 1]) : 0.5; // percent

const PROVIDER_URL = process.env.PROVIDER_URL;
if (!PROVIDER_URL) {
  console.error('Set PROVIDER_URL in .env');
  process.exit(1);
}

const provider = new ethers.providers.JsonRpcProvider(PROVIDER_URL);

// Common token address map for convenience (mainnet)
const COMMON = {
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  USDC: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
};

function resolveToken(input) {
  if (!input) return null;
  if (input.startsWith('0x') && input.length === 42) return input;
  const up = input.toUpperCase();
  if (COMMON[up]) return COMMON[up];
  throw new Error('Unknown token symbol: ' + input + '. Provide address or add to COMMON map.');
}

const tokenA = resolveToken(tokenArgA);
const tokenB = resolveToken(tokenArgB);

// Uniswap V2 factories (mainnet)
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const SUSHISWAP_FACTORY = '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac';
const V2_FACTORIES = [UNISWAP_V2_FACTORY, SUSHISWAP_FACTORY];

// Uniswap V3 factory
const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const V3_FEES = [500, 3000, 10000];

// ABIs (minimal)
const IUniswapV2Factory = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)'
];
const IUniswapV2Pair = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];
const IUniswapV3Factory = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'
];
const IUniswapV3Pool = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'
];
const IERC20 = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

async function getV2Pairs(token0, token1) {
  const results = [];
  for (const factoryAddr of V2_FACTORIES) {
    try {
      const factory = new ethers.Contract(factoryAddr, IUniswapV2Factory, provider);
      const pairAddr = await factory.getPair(token0, token1);
      if (pairAddr && pairAddr !== ethers.constants.AddressZero) {
        const pair = new ethers.Contract(pairAddr, IUniswapV2Pair, provider);
        const token0Addr = await pair.token0();
        const reserves = await pair.getReserves();
        results.push({ factory: factoryAddr, pair: pairAddr, token0: token0Addr, reserves });
      }
    } catch (e) {
      // ignore
    }
  }
  return results;
}

async function getV3Pools(token0, token1) {
  const pools = [];
  const factory = new ethers.Contract(UNISWAP_V3_FACTORY, IUniswapV3Factory, provider);
  for (const fee of V3_FEES) {
    try {
      const poolAddr = await factory.getPool(token0, token1, fee);
      if (poolAddr && poolAddr !== ethers.constants.AddressZero) {
        const pool = new ethers.Contract(poolAddr, IUniswapV3Pool, provider);
        const slot0 = await pool.slot0();
        pools.push({ fee, pool: poolAddr, sqrtPriceX96: slot0.sqrtPriceX96 });
      }
    } catch (e) {
      // ignore
    }
  }
  return pools;
}

// V2 constant product amountOut approximation (with 0.3% fee)
function getAmountOutV2(amountIn, reserveIn, reserveOut) {
  if (amountIn.isZero()) return ethers.BigNumber.from(0);
  const amountInWithFee = amountIn.mul(997);
  const numerator = amountInWithFee.mul(reserveOut);
  const denominator = reserveIn.mul(1000).add(amountInWithFee);
  return numerator.div(denominator);
}

// V3 approximate amountOut using sqrtPriceX96 (price of token1 per token0)
// sqrtPriceX96^2 / 2^192 = price (token1/token0). We'll apply fee by multiplying by (1 - fee)
function getAmountOutV3Approx(amountIn, sqrtPriceX96, decimalsIn = 18, decimalsOut = 18, feeBps = 3000) {
  // price as BigNumber with 18 decimals: price = (sqrtPriceX96^2)/(2^192)
  const Q96 = ethers.BigNumber.from(2).pow(96);
  const sqrt = ethers.BigNumber.from(sqrtPriceX96.toString());
  const priceNum = sqrt.mul(sqrt);
  const denom = ethers.BigNumber.from(2).pow(192);
  // price as rational priceNum/denom; compute amountOut = amountIn * price * 10^{decOut-decIn}
  const amountOut = ethers.BigNumber.from(amountIn).mul(priceNum).div(denom);
  // adjust decimals difference (approx)
  if (decimalsOut > decimalsIn) {
    return amountOut.mul(ethers.BigNumber.from(10).pow(decimalsOut - decimalsIn)).mul(10000 - feeBps).div(10000);
  } else if (decimalsOut < decimalsIn) {
    return amountOut.div(ethers.BigNumber.from(10).pow(decimalsIn - decimalsOut)).mul(10000 - feeBps).div(10000);
  }
  return amountOut.mul(10000 - feeBps).div(10000);
}

async function tokenDecimals(addr) {
  try {
    const t = new ethers.Contract(addr, IERC20, provider);
    return await t.decimals();
  } catch (e) {
    return 18;
  }
}

async function ethPriceUSD() {
  // Try Coingecko quick price (best-effort)
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    const j = await res.json();
    return j.ethereum.usd;
  } catch (e) {
    return null;
  }
}

async function evaluate(amountBorrowed) {
  console.log('Scanning pools for pair', tokenA, tokenB);
  const v2pairs = await getV2Pairs(tokenA, tokenB);
  const v3pools = await getV3Pools(tokenA, tokenB);

  const decA = await tokenDecimals(tokenA);
  const decB = await tokenDecimals(tokenB);

  const gasPrice = await provider.getGasPrice();
  const gasCostEth = gasPrice.mul(250000); // gas * gasPrice

  // Aave flash loan fee: 0.09% typically; represent as fraction
  const AAVE_FEE_BPS = 9; // 0.09% => 9/10000

  // Evaluate many simple two-step routes: V2 -> V2, V2 -> V3, V3 -> V2, V3->V3
  const candidates = [];

  // Helper to compute net result for route [swap1, swap2]
  async function simulateRoute(amount, swap1, swap2) {
    // swap1 and swap2 encode type: { type: 'v2'|'v3', source: factory/pool, fee }
    let amountAfter1;
    if (swap1.type === 'v2') {
      const r = swap1.reserves;
      // determine reserveIn/reserveOut order
      const reserveIn = ethers.BigNumber.from(swap1.token0.toLowerCase() === tokenA.toLowerCase() ? r._reserve0 || r[0] : r._reserve1 || r[1]);
      const reserveOut = ethers.BigNumber.from(swap1.token0.toLowerCase() === tokenA.toLowerCase() ? r._reserve1 || r[1] : r._reserve0 || r[0]);
      amountAfter1 = getAmountOutV2(amount, reserveIn, reserveOut);
    } else if (swap1.type === 'v3') {
      amountAfter1 = getAmountOutV3Approx(amount, swap1.sqrtPriceX96, decA, decB, swap1.fee);
    }

    if (amountAfter1.isZero()) return null;

    // second swap: amountAfter1 into tokenA
    let finalAmount;
    if (swap2.type === 'v2') {
      const r = swap2.reserves;
      const reserveIn = ethers.BigNumber.from(swap2.token0.toLowerCase() === tokenB.toLowerCase() ? r._reserve0 || r[0] : r._reserve1 || r[1]);
      const reserveOut = ethers.BigNumber.from(swap2.token0.toLowerCase() === tokenB.toLowerCase() ? r._reserve1 || r[1] : r._reserve0 || r[0]);
      finalAmount = getAmountOutV2(amountAfter1, reserveIn, reserveOut);
    } else if (swap2.type === 'v3') {
      finalAmount = getAmountOutV3Approx(amountAfter1, swap2.sqrtPriceX96, decB, decA, swap2.fee);
    }

    if (!finalAmount || finalAmount.isZero()) return null;

    // subtract Aave fee
    const fee = amount.mul(AAVE_FEE_BPS).div(10000);
    const amountOwed = amount.add(fee);

    // gasCostEth is in wei; convert to tokenA using an approximate WETH price if tokenA is not ETH
    // Simpler: convert gas cost to tokenA amount by dividing by WETH price
    // For now compute profit in ETH then compare to threshold in percent of amountBorrowed (token denominated)

    return { finalAmount, amountOwed };
  }

  // Build simple swap descriptors
  const v2Descriptors = v2pairs.map(p => ({ type: 'v2', pair: p.pair, factory: p.factory, reserves: p.reserves, token0: p.token0 }));
  const v3Descriptors = v3pools.map(p => ({ type: 'v3', pool: p.pool, sqrtPriceX96: p.sqrtPriceX96, fee: p.fee }));

  // Try v2->v2 combos
  for (const s1 of v2Descriptors) {
    for (const s2 of v2Descriptors) {
      candidates.push({ swap1: s1, swap2: s2 });
    }
  }
  // v3 combos
  for (const s1 of v3Descriptors) {
    for (const s2 of v3Descriptors) {
      candidates.push({ swap1: s1, swap2: s2 });
    }
  }
  // mixed combos
  for (const s1 of v2Descriptors) for (const s2 of v3Descriptors) candidates.push({ swap1: s1, swap2: s2 });
  for (const s1 of v3Descriptors) for (const s2 of v2Descriptors) candidates.push({ swap1: s1, swap2: s2 });

  const amountBorrowed = ethers.parseUnits((process.env.AMOUNT || '1').toString(), decA);
  const profitable = [];
  for (const c of candidates) {
    try {
      const sim = await simulateRoute(amountBorrowed, c.swap1, c.swap2);
      if (!sim) continue;
      const { finalAmount, amountOwed } = sim;
      if (finalAmount.lte(amountOwed)) continue;
      const profit = finalAmount.sub(amountOwed);
      // approximate gas cost in tokenA units by converting gasCostEth to tokenA using WETH price
      const ethPrice = await ethPriceUSD();
      const gasCostInEth = ethers.BigNumber.from(await provider.getGasPrice()).mul(250000);
      // gasCostInEth is wei; convert to ETH decimal
      const gasCostEthFloat = parseFloat(ethers.utils.formatEther(gasCostInEth));
      // profit in ETH approximate: need to price tokenA in ETH; if tokenA=WETH assume 1:1
      let profitEthApprox = 0;
      if (tokenA.toLowerCase() === COMMON.WETH.toLowerCase()) {
        profitEthApprox = parseFloat(ethers.utils.formatEther(profit));
      } else {
        // fallback: try to price tokenA via Uniswap v2 WETH pair if available (not implemented fully)
        profitEthApprox = parseFloat(ethers.utils.formatEther(profit)); // rough fallback
      }
      const netProfitEth = profitEthApprox - gasCostEthFloat;
      const profitPct = (parseFloat(ethers.utils.formatUnits(profit, decA)) / parseFloat(ethers.utils.formatUnits(amountBorrowed, decA))) * 100;

      if (profitPct >= thresholdPct) {
        profitable.push({ candidate: c, profit, profitPct, netProfitEth, finalAmount, amountOwed });
      }
    } catch (e) {
      // ignore
    }
  }

  // Sort profitable by profitPct desc
  profitable.sort((a, b) => b.profitPct - a.profitPct);

  if (profitable.length === 0) {
    console.log('No profitable routes >=', thresholdPct, '% found.');
    return { profitable: false };
  }

  const best = profitable[0];
  console.log('Found profitable route! profitPct=', best.profitPct.toFixed(4));
  console.log('Candidate:', best.candidate);
  console.log('Profit (tokenA):', best.profit.toString());
  console.log('Profit approx ETH:', best.netProfitEth);

  // Build calldata examples
  const flashIface = new ethers.utils.Interface(['function flashArbitrage(address,uint256,address[],address[],uint256)']);
  const executeIface = new ethers.utils.Interface(['function executeArbitrage(uint256)']);
  const contractAddress = process.env.CONTRACT_ADDRESS || '';
  const calldataFlash = flashIface.encodeFunctionData('flashArbitrage', [tokenA, amountBorrowed.toString(), [tokenA, tokenB], [tokenB, tokenA], '0']);
  const calldataExec = executeIface.encodeFunctionData('executeArbitrage', [amountBorrowed.toString()]);

  console.log('Calldata (flashArbitrage):', calldataFlash);
  console.log('Calldata (executeArbitrage):', calldataExec);

  const tx = {
    to: contractAddress || '<DEPLOYED_CONTRACT_ADDRESS>',
    data: calldataFlash,
    gasLimit: ethers.BigNumber.from(process.env.GAS_LIMIT || '1000000'),
    // don't include gas price here; use EIP-1559 fields when signing
  };

  console.log('Prepared tx object:', tx);
  console.log('Flashbots v2 bundle template:', JSON.stringify([{ signer: '<wallet>', transaction: tx }], null, 2));

  return { profitable: true, best };
}

async function mainOnce() {
  try {
    const r = await evaluate();
    return r;
  } catch (e) {
    console.error('Error during evaluation:', e);
    return { profitable: false };
  }
}

async function watchLoop() {
  while (true) {
    const res = await mainOnce();
    if (res.profitable) {
      console.log('\u0007'); // beep
      process.exit(0);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
}

if (watch) {
  console.log('Entering watch mode, polling every 2s');
  watchLoop();
} else {
  mainOnce().then(res => process.exit(res.profitable ? 0 : 3));
}
