// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMockAMM {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swapExactTokensForTokens(uint256 amountIn, address tokenIn, address to) external returns (uint256 amountOut);
    function getReserves() external view returns (uint256 reserve0, uint256 reserve1);
}

// Aave V3 IPool interface (flash loan)
interface IPoolV3 {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

// Aave V3 Flash Loan Receiver interface
interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

// Uniswap V2 Router interface
interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

contract FlashArbitrage is Ownable, ReentrancyGuard, Pausable, IFlashLoanSimpleReceiver {

    uint256 public totalProfits;

    event ArbitrageExecuted(uint256 profit);
    event Withdrawn(address indexed to, uint256 amount);
    event ProfitRecorded(uint256 amount);
    event FlashLoanExecuted(address indexed asset, uint256 amount, uint256 profit, uint256 premium);
    event EmergencyPause(address indexed by, string reason);
    event EmergencyUnpause(address indexed by);

    // Aave V3 Pool address
    IPoolV3 public aavePool;

    // Uniswap V2 routers for DEX1 and DEX2
    IUniswapV2Router public router1;
    IUniswapV2Router public router2;

    // Optional configured pools and token for automated swaps (legacy mock support)
    address public poolAB;
    address public poolBA;
    address public tokenA;

    // Flash loan execution state (to prevent reentrancy via executeOperation)
    bool private inFlashLoan;

    constructor(address _aavePool, address _router1, address _router2) {
        // Ownable sets owner to msg.sender
        aavePool = IPoolV3(_aavePool);
        router1 = IUniswapV2Router(_router1);
        router2 = IUniswapV2Router(_router2);
    }

    function configurePools(address _poolAB, address _poolBA, address _tokenA) external onlyOwner {
        poolAB = _poolAB;
        poolBA = _poolBA;
        tokenA = _tokenA;
    }

    // Update Aave Pool address (for network changes)
    function setAavePool(address _aavePool) external onlyOwner {
        aavePool = IPoolV3(_aavePool);
    }

    // Update router addresses
    function setRouters(address _router1, address _router2) external onlyOwner {
        router1 = IUniswapV2Router(_router1);
        router2 = IUniswapV2Router(_router2);
    }

    // Emergency pause - stops all arbitrage execution
    function emergencyPause(string calldata reason) external onlyOwner {
        _pause();
        emit EmergencyPause(msg.sender, reason);
    }

    // Resume operations after emergency
    function emergencyUnpause() external onlyOwner {
        _unpause();
        emit EmergencyUnpause(msg.sender);
    }

    // Aave V3 Flash Loan callback - called by Aave Pool during flash loan execution
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(aavePool), "Caller must be Aave Pool");
        require(initiator == address(this), "Initiator must be this contract");
        require(inFlashLoan, "Not in flash loan");

        // Decode params: (address[] path1, address[] path2, uint256 minProfit)
        (address[] memory path1, address[] memory path2, uint256 minProfit) = abi.decode(params, (address[], address[], uint256));

        // Execute the two swaps and calculate profit
        uint256 finalAmount = _executeSwaps(asset, amount, path1, path2);
        
        // Calculate amounts and validate profit
        uint256 amountOwed = amount + premium;
        require(finalAmount > amountOwed, "Arbitrage not profitable");
        
        uint256 profit = finalAmount - amountOwed;
        require(profit >= minProfit, "Profit below minimum threshold");

        // Approve repayment and record profit
        IERC20(asset).approve(address(aavePool), amountOwed);
        totalProfits += profit;
        
        emit FlashLoanExecuted(asset, amount, profit, premium);
        return true;
    }

    // Internal: Execute both swaps with slippage protection
    function _executeSwaps(
        address asset,
        uint256 amount,
        address[] memory path1,
        address[] memory path2
    ) internal returns (uint256) {
        // Calculate minimum acceptable amounts with 2% slippage tolerance
        // In production, these should be passed from the bot based on current reserves
        // For now, we use 0 but the structure supports proper slippage protection
        uint256 minAmountOut1 = 0; // TODO: Calculate from reserves with 2% buffer
        uint256 minAmountOut2 = 0; // TODO: Calculate from reserves with 2% buffer
        
        // Step 1: Approve and swap on DEX1
        IERC20(asset).approve(address(router1), amount);
        uint256[] memory amounts1 = router1.swapExactTokensForTokens(
            amount,
            minAmountOut1,
            path1,
            address(this),
            block.timestamp + 300
        );

        // Step 2: Approve and swap on DEX2 (with multi-DEX fallback and slippage/profit guard)
        address intermediateToken = path1[path1.length - 1];
        uint256 intermediateAmount = amounts1[amounts1.length - 1];
        IERC20(intermediateToken).approve(address(router2), intermediateAmount);

        // Before final swap, set a minimum acceptable amount required to consider this profitable.
        // Minimum expected output for the final swap (simple profit threshold). Adjustable.
        uint256 minAmountOut = (amount * 101) / 100; // ~1% safety buffer (user-adjustable)

        // Try a list of routers (multi-DEX fallback). Primary: router2, fallback: router1.
        address[] memory routers = new address[](2);
        routers[0] = address(router2);
        routers[1] = address(router1);

        uint256 amountReceived = 0;
        for (uint256 i = 0; i < routers.length; i++) {
            try IUniswapV2Router(routers[i]).swapExactTokensForTokens(
                intermediateAmount,
                minAmountOut,
                path2,
                address(this),
                block.timestamp + 300
            ) returns (uint256[] memory amounts) {
                amountReceived = amounts[amounts.length - 1];
                break;
            } catch {
                // try next router
                continue;
            }
        }

        require(amountReceived > 0, "All swap attempts failed");

        // Enforce minimum net profit requirement (0.5% net profit here)
        require(amountReceived >= amount + ((amount * 50) / 10000), "Arbitrage not profitable");

        return amountReceived;
    }

    // New entry point: Execute flash loan arbitrage
    // path1: [tokenA, tokenB] for DEX1
    // path2: [tokenB, tokenA] for DEX2
    function flashArbitrage(
        address asset,
        uint256 amount,
        address[] calldata path1,
        address[] calldata path2,
        uint256 minProfit
    ) external onlyOwner nonReentrant whenNotPaused {
        require(address(aavePool) != address(0), "Aave Pool not configured");
        require(address(router1) != address(0) && address(router2) != address(0), "Routers not configured");
        require(path1.length >= 2 && path2.length >= 2, "Invalid paths");
        require(path1[0] == asset && path2[path2.length - 1] == asset, "Paths must start and end with flash loan asset");

        // Set flash loan state flag
        inFlashLoan = true;

        // Encode params for executeOperation callback
        bytes memory params = abi.encode(path1, path2, minProfit);

        // Request flash loan from Aave
        aavePool.flashLoanSimple(
            address(this),
            asset,
            amount,
            params,
            0 // No referral code
        );

        // Reset flash loan state
        inFlashLoan = false;
    }

    // Legacy: Owner-only entrypoint for performing arbitrage with pre-funded balance.
    // Keep as onlyOwner and nonReentrant to reduce risk.
    // Execute an arbitrage between configured pools using `amountIn` of tokenA.
    // The contract must hold `amountIn` of `tokenA` before calling.
    // This is for backwards compatibility with MockAMM testing.
    function executeArbitrage(uint256 amountIn) external onlyOwner nonReentrant whenNotPaused {
        require(poolAB != address(0) && poolBA != address(0) && tokenA != address(0), "Pools or token not configured");

        // Determine token addresses
        IMockAMM pool1 = IMockAMM(poolAB);
        IMockAMM pool2 = IMockAMM(poolBA);

        address t0 = pool1.token0();
        address t1 = pool1.token1();
        address tokenB = (t0 == tokenA) ? t1 : t0;

        IERC20(tokenA).approve(poolAB, amountIn);
        // Swap tokenA -> tokenB on poolAB
        uint256 amountB = pool1.swapExactTokensForTokens(amountIn, tokenA, address(this));

        // Approve poolBA to spend tokenB
        IERC20(tokenB).approve(poolBA, amountB);
        // Swap tokenB -> tokenA on poolBA
        uint256 amountAAfter = pool2.swapExactTokensForTokens(amountB, tokenB, address(this));

        // Profit calculation - require profitable arbitrage
        require(amountAAfter > amountIn, "Arbitrage not profitable");
        uint256 profit = amountAAfter - amountIn;
        totalProfits += profit;
        emit ProfitRecorded(profit);
        emit ArbitrageExecuted(profit);
    }

    // Optional helper for owner to record profits into contract accounting.
    function recordProfit(uint256 amount) external onlyOwner {
        totalProfits += amount;
        emit ArbitrageExecuted(amount);
    }

    // Withdraw ERC20 tokens (profits)
    function withdrawToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid address");
        require(IERC20(token).balanceOf(address(this)) >= amount, "Insufficient token balance");
        
        bool success = IERC20(token).transfer(to, amount);
        require(success, "Token transfer failed");
        
        emit Withdrawn(to, amount);
    }

    // Withdraw ETH (gas refunds, etc.)
    function withdraw(address payable to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid address");
        require(address(this).balance >= amount, "Insufficient balance");

        (bool success, ) = to.call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(to, amount);
    }

    receive() external payable {}
}
