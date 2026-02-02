import { ethers } from 'ethers';

// Uniswap V3 Pool ABI (minimal)
const POOL_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
];

// Uniswap V3 Quoter V2 ABI
const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

// Uniswap V3 addresses
const V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984'; // Mainnet
const V3_QUOTER_V2 = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e'; // Mainnet

// Common V3 fee tiers (basis points)
const FEE_TIERS = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%

// Well-known V3 pools (high liquidity)
const KNOWN_V3_POOLS = {
  mainnet: {
    'WETH-USDC-500': { pool: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', fee: 500 },
    'WETH-USDC-3000': { pool: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8', fee: 3000 },
    'WETH-DAI-3000': { pool: '0xC2e9F25Be6257c210d7Adf0D4Cd6E3E881ba25f8', fee: 3000 },
    'WETH-USDT-500': { pool: '0x11b815efB8f581194ae79006d24E0d814B7697F6', fee: 500 },
    'WETH-USDT-3000': { pool: '0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36', fee: 3000 },
    'WETH-WBTC-500': { pool: '0x4585FE77225b41b697C938B018E2Ac67Ac5a20c0', fee: 500 },
    'WETH-WBTC-3000': { pool: '0xCBCdF9626bC03E24f779434178A73a0B4bad62eD', fee: 3000 },
    'USDC-USDT-100': { pool: '0x3416cF6C708Da44DB2624D63ea0AAef7113527C6', fee: 100 },
    'USDC-DAI-100': { pool: '0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168', fee: 100 },
  },
  sepolia: {
    // V3 pools on Sepolia (if available)
  }
};

export class UniswapV3Scanner {
  constructor(provider, network = 'mainnet') {
    this.provider = provider;
    this.network = network;
    this.pools = KNOWN_V3_POOLS[network] || {};
    this.quoter = new ethers.Contract(V3_QUOTER_V2, QUOTER_ABI, this.provider);
  }

  // Get pool slot0 data (price and tick)
  async getPoolData(poolAddress) {
    const pool = new ethers.Contract(poolAddress, POOL_ABI, this.provider);
    const [token0, token1, fee, slot0, liquidity] = await Promise.all([
      pool.token0(),
      pool.token1(),
      pool.fee(),
      pool.slot0(),
      pool.liquidity(),
    ]);

    const [sqrtPriceX96, tick] = slot0;

    return {
      token0,
      token1,
      fee,
      sqrtPriceX96,
      tick,
      liquidity,
    };
  }

  // Calculate price from sqrtPriceX96
  calculatePrice(sqrtPriceX96, token0Decimals = 18, token1Decimals = 18) {
    const Q96 = 2n ** 96n;
    const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
    const price = sqrtPrice ** 2;
    
    // Adjust for decimals
    const decimalAdjustment = 10 ** (token1Decimals - token0Decimals);
    return price * decimalAdjustment;
  }

  // Quote exact input using Quoter V2 (static call)
  async quoteExactInput(tokenIn, tokenOut, amountIn, fee) {
    try {
      // Use staticCall for read-only simulation
      const params = {
        tokenIn,
        tokenOut,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n, // No limit
      };

      const result = await this.quoter.quoteExactInputSingle.staticCall(params);
      return {
        amountOut: result[0],
        sqrtPriceX96After: result[1],
        gasEstimate: result[3],
      };
    } catch (error) {
      console.error('V3 quote error:', error.message);
      return { amountOut: 0n, sqrtPriceX96After: 0n, gasEstimate: 0n };
    }
  }

  // Find arbitrage between two V3 pools
  async findArbitrageV3(pool1Address, pool2Address, tokenIn, amountIn) {
    try {
      const [pool1Data, pool2Data] = await Promise.all([
        this.getPoolData(pool1Address),
        this.getPoolData(pool2Address),
      ]);

      // Determine token order
      const isToken0_1 = pool1Data.token0.toLowerCase() === tokenIn.toLowerCase();
      const tokenOut = isToken0_1 ? pool1Data.token1 : pool1Data.token0;

      // Quote swap 1: tokenIn -> tokenOut on pool1
      const quote1 = await this.quoteExactInput(tokenIn, tokenOut, amountIn, pool1Data.fee);
      if (quote1.amountOut === 0n) return { profitable: false, profit: 0n };

      // Quote swap 2: tokenOut -> tokenIn on pool2
      const quote2 = await this.quoteExactInput(tokenOut, tokenIn, quote1.amountOut, pool2Data.fee);
      if (quote2.amountOut === 0n) return { profitable: false, profit: 0n };

      // Calculate profit
      const profit = quote2.amountOut > amountIn ? quote2.amountOut - amountIn : 0n;
      const profitable = profit > 0n;

      return {
        profitable,
        profit,
        amountIn,
        amountOut: quote2.amountOut,
        path: [tokenIn, tokenOut], // [tokenA, tokenB] for flash loan
        pathReverse: [tokenOut, tokenIn], // [tokenB, tokenA] for return swap
        pool1: pool1Address,
        pool2: pool2Address,
        fee1: pool1Data.fee,
        fee2: pool2Data.fee,
        gasEstimate: quote1.gasEstimate + quote2.gasEstimate,
        timestamp: Date.now(), // Track when opportunity was found
      };
    } catch (error) {
      console.error('Error finding V3 arbitrage:', error.message);
      return { profitable: false, profit: 0n };
    }
  }

  // Find arbitrage between V3 and V2 pools (cross-protocol)
  async findCrossProtocolArbitrage(v3PoolAddress, v2PoolData, tokenIn, amountIn, v3ToV2 = true) {
    try {
      const v3Data = await this.getPoolData(v3PoolAddress);
      
      const isToken0 = v3Data.token0.toLowerCase() === tokenIn.toLowerCase();
      const tokenOut = isToken0 ? v3Data.token1 : v3Data.token0;

      let amountOut1, amountOut2;

      if (v3ToV2) {
        // V3 first, then V2
        const quote1 = await this.quoteExactInput(tokenIn, tokenOut, amountIn, v3Data.fee);
        if (quote1.amountOut === 0n) return { profitable: false, profit: 0n };
        
        // V2 calculation (from V2 scanner logic)
        amountOut2 = this.calculateV2AmountOut(quote1.amountOut, v2PoolData.reserveIn, v2PoolData.reserveOut);
      } else {
        // V2 first, then V3
        amountOut1 = this.calculateV2AmountOut(amountIn, v2PoolData.reserveIn, v2PoolData.reserveOut);
        const quote2 = await this.quoteExactInput(tokenOut, tokenIn, amountOut1, v3Data.fee);
        amountOut2 = quote2.amountOut;
      }

      const profit = amountOut2 > amountIn ? amountOut2 - amountIn : 0n;
      
      return {
        profitable: profit > 0n,
        profit,
        amountIn,
        amountOut: amountOut2,
        protocol: v3ToV2 ? 'V3→V2' : 'V2→V3',
      };
    } catch (error) {
      console.error('Cross-protocol arb error:', error.message);
      return { profitable: false, profit: 0n };
    }
  }

  // Helper: V2 constant product formula
  calculateV2AmountOut(amountIn, reserveIn, reserveOut) {
    const amountInWithFee = amountIn * 997n;
    const numerator = amountInWithFee * reserveOut;
    const denominator = (reserveIn * 1000n) + amountInWithFee;
    return numerator / denominator;
  }

  // Scan all V3 pools for arbitrage
  async scanAllV3(tokenIn, amountIn) {
    const opportunities = [];
    const poolKeys = Object.keys(this.pools);

    for (let i = 0; i < poolKeys.length; i++) {
      for (let j = i + 1; j < poolKeys.length; j++) {
        const pool1 = this.pools[poolKeys[i]];
        const pool2 = this.pools[poolKeys[j]];

        // Only compare same token pairs with different fees
        const tokens1 = poolKeys[i].split('-').slice(0, 2).sort();
        const tokens2 = poolKeys[j].split('-').slice(0, 2).sort();
        
        if (tokens1.join('') === tokens2.join('') && pool1.fee !== pool2.fee) {
          const result = await this.findArbitrageV3(pool1.pool, pool2.pool, tokenIn, amountIn);
          if (result.profitable) {
            opportunities.push({
              ...result,
              pairName: poolKeys[i],
              fee1: pool1.fee,
              fee2: pool2.fee,
              protocol: 'V3',
            });
          }
        }
      }
    }

    // Sort by profit descending
    opportunities.sort((a, b) => (b.profit > a.profit ? 1 : -1));

    return opportunities;
  }

  // Filter by minimum net profit after gas
  async filterProfitable(opportunities, minNetProfitEth = '0.01') {
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
    if (!gasPrice) return opportunities;

    const minNetProfit = ethers.parseEther(minNetProfitEth);
    
    return opportunities.filter(opp => {
      const gasCost = gasPrice * (opp.gasEstimate || 300000n);
      const netProfit = opp.profit - gasCost;
      return netProfit > minNetProfit;
    });
  }
}
