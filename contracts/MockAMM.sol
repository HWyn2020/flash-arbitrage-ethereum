// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockAMM {
    address public token0;
    address public token1;
    uint256 public reserve0;
    uint256 public reserve1;

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
    }

    function setReserves(uint256 _reserve0, uint256 _reserve1) external {
        reserve0 = _reserve0;
        reserve1 = _reserve1;
    }

    function getReserves() external view returns (uint256, uint256) {
        return (reserve0, reserve1);
    }

    // Very small and simple AMM implementation: amountOut = (amountIn * reserveOut) / (reserveIn + amountIn)
    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        if (amountIn == 0 || reserveIn == 0 || reserveOut == 0) return 0;
        return (amountIn * reserveOut) / (reserveIn + amountIn);
    }

    // swapExactTokensForTokens: caller must have approved this contract to transfer `amountIn` of tokenIn
    function swapExactTokensForTokens(uint256 amountIn, address tokenIn, address to) external returns (uint256 amountOut) {
        require(amountIn > 0, "amountIn==0");
        address tokenOut;
        if (tokenIn == token0) {
            tokenOut = token1;
            amountOut = _getAmountOut(amountIn, reserve0, reserve1);
            // transfer tokenIn from caller
            IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
            // update reserves
            reserve0 += amountIn;
            reserve1 -= amountOut;
            // send tokenOut to recipient
            IERC20(tokenOut).transfer(to, amountOut);
        } else if (tokenIn == token1) {
            tokenOut = token0;
            amountOut = _getAmountOut(amountIn, reserve1, reserve0);
            IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
            reserve1 += amountIn;
            reserve0 -= amountOut;
            IERC20(tokenOut).transfer(to, amountOut);
        } else {
            revert("tokenIn not supported");
        }
    }
}
