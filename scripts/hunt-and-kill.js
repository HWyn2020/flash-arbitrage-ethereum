#!/usr/bin/env node
/*
  scripts/hunt-and-kill.js

  One-command arb hunter + flashbots submitter.

  WARNING: This script will sign and submit real Flashbots bundles if you provide
  a funded private key. Use on mainnet only if you understand the risks.

  Requirements (install):
    npm install ethers dotenv node-fetch @flashbots/ethers-provider-bundle

  Env (.env):
    PROVIDER_URL - JSON RPC endpoint
    AUTH_PRIVATE_KEY - private key of bundle signer (ephemeral recommended)
    OPERATOR_PRIVATE_KEY - private key that funds and signs the tx in bundle
    CONTRACT_ADDRESS - deployed FlashArbitrage contract
    AMOUNT - borrow amount (in token units, default 1)

  Usage example (one-liner):
    node scripts/hunt-and-kill.js WETH USDC --min-profit 0.5 --flashbots

  This script runs a tight scanner loop (500ms). On first route >= threshold it:
   - builds calldata for `flashArbitrage` on your contract
   - signs transaction with `OPERATOR_PRIVATE_KEY`
   - simulates bundle first, then submits to next 3 blocks
   - prints expected profit, bundle hash, simulation and inclusion results

  Do not run this with a key you are not prepared to lose. This is powerful code.
*/

import 'dotenv/config';
import * as ethers from 'ethers';
import fetch from 'node-fetch';
import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('Usage: node scripts/hunt-and-kill.js <tokenA> <tokenB> [--min-profit 0.5] [--flashbots]');
  process.exit(2);
}

const tokenArgA = argv[0];
const tokenArgB = argv[1];
const minIndex = argv.indexOf('--min-profit');
const minProfit = minIndex >= 0 ? parseFloat(argv[minIndex + 1]) : 0.5;
const useFlashbots = argv.includes('--flashbots');
const dryRun = argv.includes('--dry-run') || argv.includes('--dryrun');

const PROVIDER_URL = process.env.PROVIDER_URL;
if (!PROVIDER_URL) {
  console.error('Set PROVIDER_URL in .env');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(PROVIDER_URL);

const COMMON = {
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  USDC: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
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

// Minimal V2/V3 discovery and amount math (copied/compatible with live-arb-scanner)
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const SUSHISWAP_FACTORY = '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac';
const V2_FACTORIES = [UNISWAP_V2_FACTORY, SUSHISWAP_FACTORY];
const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const V3_FEES = [500, 3000, 10000];

const IUniswapV2Factory = ['function getPair(address,address) view returns (address)'];
const IUniswapV2Pair = ['function getReserves() view returns (uint112, uint112, uint32)', 'function token0() view returns (address)'];
const IUniswapV3Factory = ['function getPool(address,address,uint24) view returns (address)'];
const IUniswapV3Pool = ['function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'];
const IERC20 = ['function decimals() view returns (uint8)'];

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
    } catch (e) {}
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
        pools.push({ fee, pool: poolAddr, sqrtPriceX96: slot0[0] });
      }
    } catch (e) {}
  }
  return pools;
}

function getAmountOutV2(amountIn, reserveIn, reserveOut) {
  if (amountIn.isZero()) return ethers.BigNumber.from(0);
  const amountInWithFee = amountIn.mul(997);
  const numerator = amountInWithFee.mul(reserveOut);
  const denominator = reserveIn.mul(1000).add(amountInWithFee);
  return numerator.div(denominator);
}

function getAmountOutV3Approx(amountIn, sqrtPriceX96, decimalsIn = 18, decimalsOut = 18, feeBps = 3000) {
  const sqrt = ethers.BigNumber.from(sqrtPriceX96.toString());
  const priceNum = sqrt.mul(sqrt);
  const denom = ethers.BigNumber.from(2).pow(192);
  const amountOut = ethers.BigNumber.from(amountIn).mul(priceNum).div(denom);
  if (decimalsOut > decimalsIn) {
    return amountOut.mul(ethers.BigNumber.from(10).pow(decimalsOut - decimalsIn)).mul(10000 - feeBps).div(10000);
  } else if (decimalsOut < decimalsIn) {
    return amountOut.div(ethers.BigNumber.from(10).pow(decimalsIn - decimalsOut)).mul(10000 - feeBps).div(10000);
  }
  return amountOut.mul(10000 - feeBps).div(10000);
}

async function tokenDecimals(addr) {
  try { const t = new ethers.Contract(addr, IERC20, provider); return await t.decimals(); } catch (e) { return 18; }
}

async function scanOnce(amountBorrowed, decA, decB) {
  const v2pairs = await getV2Pairs(tokenA, tokenB);
  const v3pools = await getV3Pools(tokenA, tokenB);
  const v2Descriptors = v2pairs.map(p => ({ type: 'v2', reserves: p.reserves, token0: p.token0 }));
  const v3Descriptors = v3pools.map(p => ({ type: 'v3', sqrtPriceX96: p.sqrtPriceX96, fee: p.fee }));

  const candidates = [];
  for (const s1 of v2Descriptors) for (const s2 of v2Descriptors) candidates.push({ swap1: s1, swap2: s2 });
  for (const s1 of v3Descriptors) for (const s2 of v3Descriptors) candidates.push({ swap1: s1, swap2: s2 });
  for (const s1 of v2Descriptors) for (const s2 of v3Descriptors) candidates.push({ swap1: s1, swap2: s2 });
  for (const s1 of v3Descriptors) for (const s2 of v2Descriptors) candidates.push({ swap1: s1, swap2: s2 });

  const AAVE_FEE_BPS = 9;
  const profitable = [];
  for (const c of candidates) {
    try {
      let amountAfter1;
      if (c.swap1.type === 'v2') {
        const r = c.swap1.reserves; const reserveIn = ethers.BigNumber.from(r[0]); const reserveOut = ethers.BigNumber.from(r[1]); amountAfter1 = getAmountOutV2(amountBorrowed, reserveIn, reserveOut);
      } else amountAfter1 = getAmountOutV3Approx(amountBorrowed, c.swap1.sqrtPriceX96, decA, decB, c.swap1.fee);
      if (!amountAfter1 || amountAfter1.isZero()) continue;
      let finalAmount;
      if (c.swap2.type === 'v2') { const r2 = c.swap2.reserves; finalAmount = getAmountOutV2(amountAfter1, ethers.BigNumber.from(r2[0]), ethers.BigNumber.from(r2[1])); }
      else finalAmount = getAmountOutV3Approx(amountAfter1, c.swap2.sqrtPriceX96, decB, decA, c.swap2.fee);
      if (!finalAmount || finalAmount.isZero()) continue;
      const fee = amountBorrowed.mul(AAVE_FEE_BPS).div(10000);
      const amountOwed = amountBorrowed.add(fee);
      if (finalAmount.lte(amountOwed)) continue;
      const profit = finalAmount.sub(amountOwed);
      const profitPct = (parseFloat(ethers.utils.formatUnits(profit, decA)) / parseFloat(ethers.utils.formatUnits(amountBorrowed, decA))) * 100;
      if (profitPct >= minProfit) profitable.push({ candidate: c, profit, profitPct, finalAmount, amountOwed });
    } catch (e) {}
  }
  profitable.sort((a,b) => b.profitPct - a.profitPct);
  return profitable;
}

async function createFlashbotsProvider() {
  const authKey = process.env.AUTH_PRIVATE_KEY;
  if (!authKey) throw new Error('AUTH_PRIVATE_KEY required for Flashbots auth');
  const authSigner = new ethers.Wallet(authKey);
  const fb = await FlashbotsBundleProvider.create(provider, authSigner, 'https://relay.flashbots.net');
  return fb;
}

async function huntAndKill() {
  const decA = await tokenDecimals(tokenA);
  const decB = await tokenDecimals(tokenB);
  const amountBorrowed = ethers.parseUnits((process.env.AMOUNT || '1').toString(), decA);

  let flashbotsProvider = null;
  if (useFlashbots) {
    try {
      flashbotsProvider = await createFlashbotsProvider();
    } catch (e) {
      console.warn('Flashbots provider creation failed:', e.message);
      flashbotsProvider = null;
    }
  }

  console.log('Starting tight scan loop for', tokenA, tokenB, 'minProfit=', minProfit, '%');

  const operatorPk = process.env.OPERATOR_PRIVATE_KEY;
  if (useFlashbots && !operatorPk) {
    console.error('When using --flashbots provide OPERATOR_PRIVATE_KEY in .env (signing key for tx in bundle)');
    process.exit(1);
  }
  const operatorWallet = operatorPk ? new ethers.Wallet(operatorPk, provider) : null;

  let running = true;
  while (running) {
    const profitable = await scanOnce(amountBorrowed, decA, decB);
    if (profitable && profitable.length > 0) {
      const best = profitable[0];
      console.log('>> Opportunity found:', best.profitPct.toFixed(4), '% profit');
      // Build calldata
      const flashIface = new ethers.utils.Interface(['function flashArbitrage(address,uint256,address[],address[],uint256)']);
      const contractAddress = process.env.CONTRACT_ADDRESS;
      let calldata = null;
      if (!contractAddress) {
        if (!dryRun) {
          console.error('Set CONTRACT_ADDRESS in .env');
          process.exit(1);
        } else {
          console.log('DRY-RUN: CONTRACT_ADDRESS not set — skipping calldata build.');
        }
      } else {
        calldata = flashIface.encodeFunctionData('flashArbitrage', [tokenA, amountBorrowed.toString(), [tokenA, tokenB], [tokenB, tokenA], '0']);
      }

      const tx = {
        to: contractAddress || '<NO_CONTRACT>',
        data: calldata || '0x',
        gasLimit: ethers.BigNumber.from(process.env.GAS_LIMIT || '1200000'),
        chainId: (await provider.getNetwork()).chainId
      };

      // If dry run, only simulate and print details — do not sign or send
      if (dryRun) {
        console.log('DRY-RUN: Found opportunity (no signing/sending)');
        console.log('Profit (tokenA):', best.profit.toString(), 'profitPct=', best.profitPct);
        console.log('Prepared tx object (not signed):', tx);
        if (flashbotsProvider) {
          try {
            const bundle = [{ signer: operatorWallet || { address: 'OPERATOR' }, transaction: tx }];
            const block = await provider.getBlockNumber();
            const target = block + 1;
            console.log('DRY-RUN: Simulating bundle for target block', target);
            const sim = await flashbotsProvider.simulate(bundle, target);
            console.log('Simulation result:', sim);
          } catch (e) {
            console.warn('DRY-RUN: Flashbots simulation failed:', e.message || e);
          }
        } else {
          console.log('DRY-RUN: No Flashbots auth/provider available — simulation skipped.');
        }
        // return to scanning (or exit once to match user's request)
        console.log('DRY-RUN: printing first opportunity and exiting.');
        process.exit(0);
      }

      // Sign TX offline
      const signedTx = await operatorWallet.signTransaction(tx);

      if (useFlashbots) {
        // build bundle entry using signer object (v2 form supported)
        const bundle = [{ signer: operatorWallet, transaction: tx }];
        const block = await provider.getBlockNumber();

        // Simulate and submit to next 3 blocks
        for (let i = 1; i <= 3; i++) {
          const target = block + i;
          console.log('Simulating bundle for block', target);
          try {
            const sim = await flashbotsProvider.simulate(bundle, target);
            if (sim && sim.error) {
              console.warn('Simulation error:', sim.error);
            } else {
              console.log('Simulation ok for target', target);
            }
          } catch (e) { console.warn('Simulation failed:', e); }

          console.log('Sending bundle for block', target);
          const sendRes = await flashbotsProvider.sendBundle(bundle, target);
          const bundleHash = sendRes.bundleHash;
          console.log('Bundle submitted, hash=', bundleHash);

          const waitRes = await sendRes.wait();
          if (waitRes === 0) {
            console.log('Not included in block', target);
          } else {
            console.log('Bundle included in block', target, 'result:', waitRes);
            process.exit(0);
          }
        }
        console.log('Exhausted target blocks without inclusion');
        process.exit(1);
      } else {
        console.log('Flashbots not enabled; signed raw tx ready (not broadcast):', signedTx);
        console.log('Expected profit (tokenA):', best.profit.toString(), 'profitPct=', best.profitPct);
        process.exit(0);
      }
    }
    // tight loop 500ms
    await new Promise(r => setTimeout(r, 500));
  }
}

huntAndKill().catch(e => { console.error('Fatal error', e); process.exit(2); });
