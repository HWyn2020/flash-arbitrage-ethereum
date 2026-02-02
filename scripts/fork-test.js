/**
 * scripts/fork-test.js
 *
 * A mainnet-fork testing harness for FlashArbitrage. Run this against a local
 * Hardhat/Anvil fork to simulate an arbitrage and print expected profit before
 * you ever sign or broadcast a bundle.
 *
 * Usage (recommended):
 * 1) Start a local fork (Hardhat):
 *    npx hardhat node --fork <RPC_URL> --fork-block-number <BLOCK>
 *
 * 2) In another terminal run:
 *    npx hardhat run scripts/fork-test.js --network localhost
 *
 * The script deploys test tokens and MockAMM pools, configures the FlashArbitrage
 * contract, computes expected amounts using the same formula as MockAMM, and
 * prints the expected profit percentage and raw token amounts.
 */

require('dotenv').config();
const hre = require('hardhat');
const { ethers } = hre;

async function simulateAMM(amountIn, reserveIn, reserveOut) {
  // MockAMM._getAmountOut: (amountIn * reserveOut) / (reserveIn + amountIn)
  if (amountIn === 0 || reserveIn === 0 || reserveOut === 0) return ethers.BigNumber.from(0);
  const numerator = ethers.BigNumber.from(amountIn).mul(ethers.BigNumber.from(reserveOut));
  const denominator = ethers.BigNumber.from(reserveIn).add(ethers.BigNumber.from(amountIn));
  return numerator.div(denominator);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Using deployer:', await deployer.getAddress());

  // Deploy TestToken and MockAMM from contracts
  const TestToken = await ethers.getContractFactory('TestToken');
  const MockAMM = await ethers.getContractFactory('MockAMM');
  const FlashArb = await ethers.getContractFactory('FlashArbitrage');

  // Deploy two test tokens A and B
  const tokenA = await TestToken.deploy('Token A', 'TKA', ethers.parseEther('1000000'));
  await tokenA.deployed();
  const tokenB = await TestToken.deploy('Token B', 'TKB', ethers.parseEther('1000000'));
  await tokenB.deployed();

  // Deploy two AMM pools: poolAB (A->B) and poolBA (B->A)
  const poolAB = await MockAMM.deploy(await tokenA.getAddress(), await tokenB.getAddress());
  await poolAB.deployed();
  const poolBA = await MockAMM.deploy(await tokenB.getAddress(), await tokenA.getAddress());
  await poolBA.deployed();

  // Set reserves to create an example arbitrage opportunity (tweak as needed)
  // For a realistic run, set reserves based on on-chain pools or forked state.
  const reserveA1 = ethers.parseEther('1000');
  const reserveB1 = ethers.parseEther('500');
  const reserveB2 = ethers.parseEther('500');
  const reserveA2 = ethers.parseEther('1000');

  await poolAB.setReserves(reserveA1, reserveB1);
  await poolBA.setReserves(reserveB2, reserveA2);

  // Deploy FlashArbitrage passing placeholder router addresses (the MockAMM uses a custom interface)
  // We'll set pools using configurePools for executeArbitrage compatibility
  const flashArb = await FlashArb.deploy(deployer.address, deployer.address, deployer.address);
  await flashArb.deployed();

  // Configure pools and tokenA
  await flashArb.configurePools(await poolAB.getAddress(), await poolBA.getAddress(), await tokenA.getAddress());

  // Fund the contract with tokenA to run executeArbitrage
  const amountIn = ethers.parseEther('10');
  await tokenA.transfer(await flashArb.getAddress(), ethers.parseEther('100'));

  // Read reserves from pools to compute expected amounts using the same formula
  const [r0AB, r1AB] = await poolAB.getReserves(); // reserve0 = tokenA, reserve1 = tokenB
  const [r0BA, r1BA] = await poolBA.getReserves(); // reserve0 = tokenB, reserve1 = tokenA

  // Simulate A -> B on poolAB
  const amountB = await simulateAMM(amountIn, r0AB, r1AB);
  // After first swap, poolAB would have reserve0 += amountIn, reserve1 -= amountB
  const newReserve0AB = ethers.BigNumber.from(r0AB).add(amountIn);
  const newReserve1AB = ethers.BigNumber.from(r1AB).sub(amountB);

  // Simulate B -> A on poolBA; use original BA reserves
  const amountAAfter = await simulateAMM(amountB, r0BA, r1BA);

  const profit = amountAAfter.sub(amountIn);
  const profitPct = profit.mul(ethers.parseEther('1')).div(amountIn).toString();

  console.log('Simulated trade amounts:');
  console.log(' amountIn (A):', amountIn.toString());
  console.log(' amountB (after A->B):', amountB.toString());
  console.log(' amountAAfter (after B->A):', amountAAfter.toString());
  console.log(' profit (A):', profit.toString());
  console.log(' profit percentage (A * 1e18):', profitPct);

  // Check whether executeArbitrage would revert or succeed via callStatic
  try {
    await flashArb.callStatic.executeArbitrage(amountIn);
    console.log('callStatic: executeArbitrage would succeed (no revert)');
  } catch (err) {
    console.log('callStatic: executeArbitrage would revert:', err.message || err.toString());
  }

  // Print recommended minProfit value to set in the on-chain call
  // e.g. require profit >= 0.5% net profit: minProfit = amountIn * 5 / 1000
  const minProfitThreshold = amountIn.mul(5).div(1000); // 0.5%
  console.log('recommended minProfit (0.5%):', minProfitThreshold.toString());
}

main().catch(err => { console.error(err); process.exit(1); });
