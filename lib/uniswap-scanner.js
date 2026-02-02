import { ethers } from 'ethers';

// Uniswap V2 pair ABI (minimal - just what we need)
const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

// Uniswap V2 Router ABI (for price quotes)
const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
];

// Uniswap V2 Factory ABI (for finding pair addresses dynamically)
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

// Well-known V2-compatible DEX routers on mainnet
const DEX_ROUTERS = {
  mainnet: {
    uniswap: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    sushiswap: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
    shibaswap: '0x03f7724180AA6b939894B5Ca4314783B0b36b329',
    // More V2 clones can be added easily
  },
  sepolia: {
    // Testnet routers (if available)
  }
};

// Well-known V2 factory addresses for each DEX
const DEX_FACTORIES = {
  mainnet: {
    uniswap: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    sushiswap: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
    shibaswap: '0x115934131916C8b277DD010Ee02de363c09d037c',
  }
};

// High-liquidity pairs to scan (mainnet addresses)
const KNOWN_PAIRS = {
  mainnet: {
    // WETH/USDC pairs
    'WETH-USDC-uni': { pair: '0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc', dex: 'uniswap', token0: 'USDC', token1: 'WETH' },
    'WETH-USDC-sushi': { pair: '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0', dex: 'sushiswap', token0: 'USDC', token1: 'WETH' },
    
    // WETH/DAI pairs
    'WETH-DAI-uni': { pair: '0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11', dex: 'uniswap', token0: 'DAI', token1: 'WETH' },
    'WETH-DAI-sushi': { pair: '0xC3D03e4F041Fd4cD388c549Ee2A29a9E5075882f', dex: 'sushiswap', token0: 'DAI', token1: 'WETH' },
    
    // WETH/USDT pairs
    'WETH-USDT-uni': { pair: '0x0d4a11d5EEaaC28EC3F61d100daF4d40471f1852', dex: 'uniswap', token0: 'WETH', token1: 'USDT' },
    'WETH-USDT-sushi': { pair: '0x06da0fd433C1A5d7a4faa01111c044910A184553', dex: 'sushiswap', token0: 'WETH', token1: 'USDT' },
    
    // WETH/WBTC pairs (high value)
    'WETH-WBTC-uni': { pair: '0xBb2b8038a1640196FbE3e38816F3e67Cba72D940', dex: 'uniswap', token0: 'WBTC', token1: 'WETH' },
    'WETH-WBTC-sushi': { pair: '0xCEfF51756c56CeFFCA006cD410B03FFC46dd3a58', dex: 'sushiswap', token0: 'WBTC', token1: 'WETH' },
    
    // Stablecoin pairs (lower slippage, frequent arb opportunities)
    'USDC-USDT-uni': { pair: '0x3041CbD36888bECc7bbCBc0045E3B1f144466f5f', dex: 'uniswap', token0: 'USDC', token1: 'USDT' },
    'USDC-DAI-uni': { pair: '0xAE461cA67B15dc8dc81CE7615e0320dA1A9aB8D5', dex: 'uniswap', token0: 'USDC', token1: 'DAI' },
    'DAI-USDT-uni': { pair: '0xB20bd5D04BE54f870D5C0d3cA85d82b34B836405', dex: 'uniswap', token0: 'DAI', token1: 'USDT' },
  },
  sepolia: {
    // Sepolia testnet pairs (if available - otherwise deploy mocks)
  }
};

export class UniswapScanner {
  constructor(provider, network = 'mainnet') {
    this.provider = provider;
    this.network = network;
    this.pairs = KNOWN_PAIRS[network] || {};
    this.routers = DEX_ROUTERS[network] || {};
    this.factories = DEX_FACTORIES[network] || {};
  }

  // Dynamically find pair address for a token pair on a specific DEX
  async findPairAddress(tokenA, tokenB, dexName) {
    const factoryAddress = this.factories[dexName];
    if (!factoryAddress) {
      throw new Error(`Factory address not found for DEX: ${dexName}`);
    }

    const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, this.provider);
    const pairAddress = await factory.getPair(tokenA, tokenB);
    
    if (pairAddress === ethers.ZeroAddress) {
      return null; // Pair doesn't exist on this DEX
    }
    
    return pairAddress;
  }

  // Add a new pair dynamically (useful for discovering new opportunities)
  async addPair(tokenA, tokenB, dexName, label) {
    const pairAddress = await this.findPairAddress(tokenA, tokenB, dexName);
    if (pairAddress) {
      const key = `${label}-${dexName}`;
      this.pairs[key] = {
        pair: pairAddress,
        dex: dexName,
        token0: tokenA,
        token1: tokenB,
      };
      console.log(`✅ Added pair: ${key} at ${pairAddress}`);
      return true;
    }
    console.log(`⚠️  Pair not found: ${label} on ${dexName}`);
    return false;
  }

  // Fetch reserves for a specific pair
  async getReserves(pairAddress) {
    const pair = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
    const [reserve0, reserve1, timestamp] = await pair.getReserves();
    const token0 = await pair.token0();
    const token1 = await pair.token1();
    return { reserve0, reserve1, token0, token1, timestamp };
  }

  // Calculate output amount given input (with 0.3% fee)
  calculateAmountOut(amountIn, reserveIn, reserveOut) {
    const amountInWithFee = amountIn * 997n; // 0.3% fee = 997/1000
    const numerator = amountInWithFee * reserveOut;
    const denominator = (reserveIn * 1000n) + amountInWithFee;
    return numerator / denominator;
  }

  // Find arbitrage opportunity between two pairs for the same token pair
  async findArbitrage(pair1Address, pair2Address, tokenIn, amountIn) {
    try {
      const [reserves1, reserves2] = await Promise.all([
        this.getReserves(pair1Address),
        this.getReserves(pair2Address),
      ]);

      // Determine which reserve is tokenIn and which is tokenOut
      const isToken0_1 = reserves1.token0.toLowerCase() === tokenIn.toLowerCase();
      const reserveIn1 = isToken0_1 ? reserves1.reserve0 : reserves1.reserve1;
      const reserveOut1 = isToken0_1 ? reserves1.reserve1 : reserves1.reserve0;
      const tokenOut = isToken0_1 ? reserves1.token1 : reserves1.token0;

      const isToken0_2 = reserves2.token0.toLowerCase() === tokenOut.toLowerCase();
      const reserveIn2 = isToken0_2 ? reserves2.reserve0 : reserves2.reserve1;
      const reserveOut2 = isToken0_2 ? reserves2.reserve1 : reserves2.reserve0;

      // Calculate swap pair1: tokenIn -> tokenOut
      const amountOut1 = this.calculateAmountOut(amountIn, reserveIn1, reserveOut1);

      // Calculate swap pair2: tokenOut -> tokenIn
      const amountOut2 = this.calculateAmountOut(amountOut1, reserveIn2, reserveOut2);

      // Profit in tokenIn
      const profit = amountOut2 > amountIn ? amountOut2 - amountIn : 0n;
      const profitable = profit > 0n;

      return {
        profitable,
        profit,
        amountIn,
        amountOut: amountOut2,
        path: [tokenIn, tokenOut], // [tokenA, tokenB] for flash loan
        pathReverse: [tokenOut, tokenIn], // [tokenB, tokenA] for return swap
        pair1: pair1Address,
        pair2: pair2Address,
        timestamp: Date.now(), // Track when opportunity was found
      };
    } catch (error) {
      console.error('Error finding arbitrage:', error.message);
      return { profitable: false, profit: 0n };
    }
  }

  // Scan all known pairs for opportunities
  async scanAll(tokenIn, amountIn) {
    const opportunities = [];
    const pairKeys = Object.keys(this.pairs);

    for (let i = 0; i < pairKeys.length; i++) {
      for (let j = i + 1; j < pairKeys.length; j++) {
        const pair1 = this.pairs[pairKeys[i]];
        const pair2 = this.pairs[pairKeys[j]];

        // Only compare same token pairs across different DEXes
        const tokens1 = pairKeys[i].split('-').slice(0, 2).sort();
        const tokens2 = pairKeys[j].split('-').slice(0, 2).sort();
        
        if (tokens1.join('') === tokens2.join('') && pair1.dex !== pair2.dex) {
          const result = await this.findArbitrage(pair1.pair, pair2.pair, tokenIn, amountIn);
          if (result.profitable) {
            opportunities.push({
              ...result,
              dex1: pair1.dex,
              dex2: pair2.dex,
              pairName: pairKeys[i],
              token0: pair1.token0,
              token1: pair1.token1,
            });
          }
        }
      }
    }

    // Sort by profit descending
    opportunities.sort((a, b) => (b.profit > a.profit ? 1 : -1));

    return opportunities;
  }

  // Get current gas price and estimate total cost
  async estimateGasCost(gasLimit = 300000n) {
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
    if (!gasPrice) return 0n;
    return gasPrice * gasLimit;
  }

  // Filter opportunities by minimum net profit after gas
  async filterProfitable(opportunities, minNetProfitEth = '0.01') {
    const gasCost = await this.estimateGasCost();
    const minNetProfit = ethers.parseEther(minNetProfitEth);
    
    return opportunities.filter(opp => {
      // Assume profit is in WETH for simplicity (1:1 with ETH for gas cost comparison)
      const netProfit = opp.profit - gasCost;
      return netProfit > minNetProfit;
    });
  }
}
