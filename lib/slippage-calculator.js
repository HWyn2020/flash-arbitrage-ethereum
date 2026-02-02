/**
 * Slippage Calculator for Arbitrage Trades
 * Calculates minimum output amounts to protect against sandwich attacks and price manipulation
 */

import { ethers } from 'ethers';

export class SlippageCalculator {
  constructor(slippagePercentage = 2) {
    // Default 2% slippage tolerance
    this.slippageBasisPoints = slippagePercentage * 100;
  }

  /**
   * Calculate minimum output amount for a swap based on reserves
   * Uses constant product formula: x * y = k
   * 
   * @param {string} amountIn - Amount of input tokens (in wei)
   * @param {string} reserve0 - Reserve of token0 (in wei)
   * @param {string} reserve1 - Reserve of token1 (in wei)
   * @param {boolean} token0In - True if swapping token0 for token1
   * @param {number} feeBasisPoints - DEX fee in basis points (30 for 0.3%)
   * @returns {string} Minimum amount out with slippage protection (in wei)
   */
  calculateMinAmountOut(amountIn, reserve0, reserve1, token0In, feeBasisPoints = 30) {
    const amountInBN = BigInt(amountIn);
    const reserve0BN = BigInt(reserve0);
    const reserve1BN = BigInt(reserve1);

    // Calculate expected output using constant product formula
    // amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
    // Where 997/1000 = 0.997 (0.3% fee)
    
    const feeMultiplier = BigInt(10000 - feeBasisPoints); // 9970 for 0.3% fee
    const feeDivisor = BigInt(10000);

    let reserveIn, reserveOut;
    if (token0In) {
      reserveIn = reserve0BN;
      reserveOut = reserve1BN;
    } else {
      reserveIn = reserve1BN;
      reserveOut = reserve0BN;
    }

    // Calculate expected output
    const amountInWithFee = amountInBN * feeMultiplier;
    const numerator = amountInWithFee * reserveOut;
    const denominator = (reserveIn * feeDivisor) + amountInWithFee;
    const expectedOut = numerator / denominator;

    // Apply slippage tolerance
    const slippageMultiplier = BigInt(10000 - this.slippageBasisPoints); // 9800 for 2% slippage
    const minAmountOut = (expectedOut * slippageMultiplier) / BigInt(10000);

    return minAmountOut.toString();
  }

  /**
   * Calculate minimum amounts for a two-hop arbitrage
   * 
   * @param {Object} opportunity - Arbitrage opportunity object
   * @param {string} flashLoanAmount - Flash loan amount (in wei)
   * @returns {Object} { minAmountOut1, minAmountOut2 }
   */
  calculateArbitrageSlippage(opportunity, flashLoanAmount) {
    // First swap: Buy on DEX1
    const minAmountOut1 = this.calculateMinAmountOut(
      flashLoanAmount,
      opportunity.reserve0A || opportunity.reserves0A,
      opportunity.reserve1A || opportunity.reserves1A,
      true, // Assuming token0 is the input
      30 // 0.3% Uniswap fee
    );

    // Second swap: Sell on DEX2
    const minAmountOut2 = this.calculateMinAmountOut(
      minAmountOut1,
      opportunity.reserve0B || opportunity.reserves0B,
      opportunity.reserve1B || opportunity.reserves1B,
      false, // Swapping back to original token
      30 // 0.3% Uniswap fee
    );

    return {
      minAmountOut1,
      minAmountOut2,
      expectedProfit: opportunity.profit
    };
  }

  /**
   * Validate if an opportunity is still profitable with slippage protection
   * 
   * @param {string} flashLoanAmount - Flash loan amount (in wei)
   * @param {string} minAmountOut2 - Minimum output from second swap (in wei)
   * @param {string} flashLoanPremium - Aave premium (0.05% = 0.0005)
   * @returns {boolean} True if still profitable
   */
  isProfitableWithSlippage(flashLoanAmount, minAmountOut2, flashLoanPremium = '0.0005') {
    const amountBorrowed = BigInt(flashLoanAmount);
    const premium = (amountBorrowed * BigInt(5)) / BigInt(10000); // 0.05% = 5/10000
    const amountOwed = amountBorrowed + premium;
    const minOutput = BigInt(minAmountOut2);

    return minOutput > amountOwed;
  }

  /**
   * Calculate safe flash loan amount based on liquidity and slippage
   * Ensures borrowed amount won't cause excessive price impact
   * 
   * @param {string} reserve0 - Reserve of token0
   * @param {string} reserve1 - Reserve of token1
   * @param {number} maxPriceImpactPercent - Maximum acceptable price impact (default 1%)
   * @returns {string} Safe flash loan amount (in wei)
   */
  calculateSafeFlashLoanAmount(reserve0, reserve1, maxPriceImpactPercent = 1) {
    const reserve0BN = BigInt(reserve0);
    const reserve1BN = BigInt(reserve1);
    
    // Price impact formula: impact = amountIn / (reserveIn + amountIn)
    // Solving for amountIn with max impact:
    // maxImpact = amountIn / (reserveIn + amountIn)
    // amountIn = (maxImpact * reserveIn) / (1 - maxImpact)
    
    const impactBasisPoints = BigInt(maxPriceImpactPercent * 100);
    const safeAmount = (reserve0BN * impactBasisPoints) / BigInt(10000 - maxPriceImpactPercent * 100);
    
    return safeAmount.toString();
  }

  /**
   * Get slippage-protected parameters for bot execution
   * 
   * @param {Object} opportunity - Arbitrage opportunity
   * @param {string} flashLoanAmount - Amount to borrow
   * @returns {Object} Parameters with slippage protection
   */
  getProtectedParameters(opportunity, flashLoanAmount) {
    const { minAmountOut1, minAmountOut2, expectedProfit } = this.calculateArbitrageSlippage(
      opportunity,
      flashLoanAmount
    );

    const isProfitable = this.isProfitableWithSlippage(flashLoanAmount, minAmountOut2);

    return {
      minAmountOut1,
      minAmountOut2,
      expectedProfit,
      isProfitable,
      slippagePercent: this.slippageBasisPoints / 100,
      flashLoanAmount
    };
  }

  /**
   * Set slippage tolerance percentage
   * 
   * @param {number} percentage - Slippage tolerance (1 = 1%, 2 = 2%, etc.)
   */
  setSlippage(percentage) {
    this.slippageBasisPoints = percentage * 100;
  }
}

/**
 * Helper function to calculate price impact of a trade
 * 
 * @param {string} amountIn - Amount in (wei)
 * @param {string} reserveIn - Reserve of input token (wei)
 * @returns {number} Price impact as percentage
 */
export function calculatePriceImpact(amountIn, reserveIn) {
  const amountInBN = BigInt(amountIn);
  const reserveInBN = BigInt(reserveIn);
  
  // Price impact = amountIn / (reserveIn + amountIn)
  const impact = (amountInBN * BigInt(10000)) / (reserveInBN + amountInBN);
  return Number(impact) / 100; // Convert to percentage
}

/**
 * Helper function to format slippage info for logging
 */
export function formatSlippageInfo(protectedParams) {
  return {
    flashLoan: ethers.formatEther(protectedParams.flashLoanAmount),
    minOut1: ethers.formatEther(protectedParams.minAmountOut1),
    minOut2: ethers.formatEther(protectedParams.minAmountOut2),
    slippage: `${protectedParams.slippagePercent}%`,
    profitable: protectedParams.isProfitable ? '✅' : '❌'
  };
}
