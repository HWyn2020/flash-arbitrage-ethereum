# Flash Loan Integration Guide

## Overview

Your arbitrage bot now supports **Aave V3 flash loans** - execute arbitrage with **zero capital**!

## How It Works

1. **Bot detects opportunity** via V2/V3 scanners
2. **Request flash loan** from Aave Pool (e.g., 10 WETH)
3. **Aave calls your contract's `executeOperation()`**:
   - Swap borrowed WETH → USDC on DEX1
   - Swap USDC → WETH on DEX2
   - Validate profit > minimum threshold
   - Approve Aave Pool to take back loan + 0.05% premium
4. **Keep the profit!**

## Flash Loan Premium

- **Aave V3**: 0.05% (5 basis points)
- Borrow 100 WETH → Repay 100.05 WETH
- Premium is deducted from your profit automatically

## Contract Functions

### `flashArbitrage()` (NEW - recommended)
```solidity
function flashArbitrage(
    address asset,        // Token to flash loan (e.g., WETH)
    uint256 amount,       // Amount to borrow (e.g., 10 WETH)
    address[] path1,      // Swap path on DEX1: [WETH, USDC]
    address[] path2,      // Swap path on DEX2: [USDC, WETH]
    uint256 minProfit     // Minimum profit threshold (reverts if not met)
) external onlyOwner
```

### `executeArbitrage()` (LEGACY - pre-funded)
```solidity
function executeArbitrage(uint256 amountIn) external onlyOwner
```
Still supported for mock testing with MockAMM.

## Bot Environment Variables

```bash
# Flash loan mode (default: enabled)
USE_FLASH_LOAN=1  # Set to 0 to use legacy pre-funded mode

# Minimum profit after gas + premium
MIN_PROFIT_ETH=0.01  # 0.01 ETH minimum

# Flash loan amount
SCAN_AMOUNT=10  # Request 10 WETH flash loan
```

## Deployment

### Sepolia Testnet
```powershell
npx hardhat run scripts/deploy-sepolia.js --network sepolia
```
Deploys with:
- Aave Pool: `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951`
- Uniswap V2 Router: `0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008`

### Mainnet
```powershell
npx hardhat run scripts/deploy-mainnet.js --network mainnet
```
Deploys with:
- Aave Pool: `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`
- Uniswap V2: `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D`
- Sushiswap: `0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F`

## Gas Costs

Flash loan arbitrage requires more gas:
- Legacy arbitrage: ~200k-300k gas
- **Flash loan arbitrage: ~500k-800k gas**

Adjust your gas limit and profit thresholds accordingly!

## Example: Flash Loan vs Pre-Funded

### Pre-Funded (OLD)
```
Contract Balance: 10 WETH (tied up capital)
Opportunity: 0.05 WETH profit
Execution: executeArbitrage(10 WETH)
Result: Contract has 10.05 WETH
```

### Flash Loan (NEW)
```
Contract Balance: 0 WETH (no capital needed!)
Opportunity: 0.05 WETH profit
Execution: flashArbitrage(WETH, 10 WETH, [WETH,USDC], [USDC,WETH], 0.01 WETH)
Flash Loan: Aave lends 10 WETH
Swap 1: 10 WETH → 10,000 USDC (DEX1)
Swap 2: 10,000 USDC → 10.06 WETH (DEX2)
Repay: 10.005 WETH (10 + 0.05% premium)
Profit: 0.055 WETH kept in contract
```

## Safety Features

### Contract-Level
- ✅ `require(msg.sender == address(aavePool))` - only Aave can call executeOperation
- ✅ `require(initiator == address(this))` - only self-initiated flash loans
- ✅ `require(profit >= minProfit)` - validates profitability before repayment
- ✅ `onlyOwner` on flashArbitrage entry point
- ✅ `nonReentrant` guards

### Bot-Level
- ✅ Simulation with `.staticCall()` before execution
- ✅ Circuit breaker stops after repeated failures
- ✅ Redis lock prevents concurrent execution
- ✅ DRY_RUN mode for testing

## Troubleshooting

### "Arbitrage not profitable"
- Net profit after gas + premium is negative
- Increase `MIN_PROFIT_ETH` threshold
- Wait for better opportunities

### "Insufficient liquidity"
- Flash loan amount too large for pool reserves
- Reduce `SCAN_AMOUNT`
- Choose more liquid assets (WETH, USDC, DAI)

### "Execution reverted"
- Slippage exceeded (price moved during transaction)
- Add slippage protection to swap paths
- Use private transaction with Flashbots

## Supported Assets

All Aave V3 listed assets support flash loans:
- WETH ✅
- USDC ✅
- USDT ✅
- DAI ✅
- WBTC ✅
- LINK ✅
- AAVE ✅

Check current list: https://app.aave.com/reserve-overview/

## Next Steps

1. Deploy to Sepolia testnet
2. Run bot in DRY_RUN mode
3. Test 1-2 small flash loans (~0.1-1 WETH)
4. Monitor gas costs and profitability
5. Scale up to larger amounts once validated
6. **NEVER test on mainnet before completing audit!**
