// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * Mock Aave Pool for testing flash loans
 * Simulates Aave V3 flash loan behavior
 */
contract MockAavePool {
    
    event FlashLoanCalled(address indexed receiver, address indexed asset, uint256 amount);

    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external {
        emit FlashLoanCalled(receiverAddress, asset, amount);

        // In real Aave, this would transfer tokens to receiver
        // Then call executeOperation
        // Then require repayment + premium
        
        // For testing, we just call executeOperation
        uint256 premium = (amount * 5) / 10000; // 0.05% premium
        
        (bool success, ) = receiverAddress.call(
            abi.encodeWithSignature(
                "executeOperation(address,uint256,uint256,address,bytes)",
                asset,
                amount,
                premium,
                msg.sender,
                params
            )
        );
        
        require(success, "Flash loan callback failed");
    }

    // Helper for testing executeOperation validation
    function simulateCallback(
        address receiver,
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external {
        (bool success, bytes memory returnData) = receiver.call(
            abi.encodeWithSignature(
                "executeOperation(address,uint256,uint256,address,bytes)",
                asset,
                amount,
                premium,
                initiator,
                params
            )
        );
        
        if (!success) {
            // Bubble up the revert reason
            if (returnData.length > 0) {
                assembly {
                    let returnData_size := mload(returnData)
                    revert(add(32, returnData), returnData_size)
                }
            } else {
                revert("Flash loan callback failed");
            }
        }
    }
}

/**
 * Mock Uniswap Router for testing swaps
 */
contract MockUniswapRouter {
    
    event SwapExecuted(uint256 amountIn, uint256 amountOut, address[] path);

    // Simulate successful swaps with 1% profit
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, "Expired");
        
        // Simulate 1.5% profit on swap
        uint256 amountOut = (amountIn * 1015) / 1000;
        
        require(amountOut >= amountOutMin, "Slippage exceeded");
        
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[amounts.length - 1] = amountOut;
        
        emit SwapExecuted(amountIn, amountOut, path);
        
        return amounts;
    }

    // Helper to simulate slippage failure
    function swapWithSlippage(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, "Expired");
        
        // Simulate worse than expected output (slippage)
        uint256 amountOut = (amountIn * 995) / 1000; // 0.5% loss
        
        require(amountOut >= amountOutMin, "Slippage exceeded");
        
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[amounts.length - 1] = amountOut;
        
        return amounts;
    }
}

/**
 * Attacker contract for testing reentrancy protection
 */
contract ReentrancyAttacker {
    address public target;
    bool public attacking;

    constructor(address _target) {
        target = _target;
    }

    // Attempt to reenter during flash loan callback
    function attack(
        address asset,
        uint256 amount,
        address[] calldata path1,
        address[] calldata path2,
        uint256 minProfit
    ) external {
        attacking = true;
        
        // Initial call to flashArbitrage
        (bool success, ) = target.call(
            abi.encodeWithSignature(
                "flashArbitrage(address,uint256,address[],address[],uint256)",
                asset,
                amount,
                path1,
                path2,
                minProfit
            )
        );
        
        require(success, "Attack failed");
        attacking = false;
    }

    // Malicious fallback attempts reentry
    fallback() external payable {
        if (attacking) {
            // Attempt to call flashArbitrage again during execution
            (bool success, ) = target.call(
                abi.encodeWithSignature("executeArbitrage(uint256)", 1 ether)
            );
            // This should fail due to nonReentrant modifier
        }
    }

    receive() external payable {
        if (attacking) {
            // Attempt reentry via receive
            (bool success, ) = target.call(
                abi.encodeWithSignature("executeArbitrage(uint256)", 1 ether)
            );
        }
    }
}
