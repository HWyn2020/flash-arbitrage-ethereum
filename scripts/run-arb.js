import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Run-arb using:", deployer.address);

  const TestToken = await hre.ethers.getContractFactory("TestToken");
  const tokenA = await TestToken.deploy("TokenA", "TKA", 0);
  await tokenA.waitForDeployment();
  const tokenB = await TestToken.deploy("TokenB", "TKB", 0);
  await tokenB.waitForDeployment();

  const MockAMM = await hre.ethers.getContractFactory("MockAMM");
  const poolAB = await MockAMM.deploy(tokenA.target, tokenB.target);
  await poolAB.waitForDeployment();
  const poolBA = await MockAMM.deploy(tokenA.target, tokenB.target);
  await poolBA.waitForDeployment();

  const mintAmount = hre.ethers.parseUnits("1000000", 18);
  await tokenA.mint(deployer.address, mintAmount);
  await tokenB.mint(deployer.address, mintAmount);

  // Tune reserves to create a profitable arbitrage for a small `amountIn`.
  // poolAB: tokenA reserve small, tokenB reserve large -> A is cheap -> get lots of B for A
  // poolBA: tokenA reserve large, tokenB reserve small -> B is cheap -> get lots of A for B
  const reserveAB0 = hre.ethers.parseUnits("100", 18); // tokenA in poolAB
  const reserveAB1 = hre.ethers.parseUnits("1000", 18); // tokenB in poolAB
  const reserveBA0 = hre.ethers.parseUnits("1000", 18); // tokenA in poolBA
  const reserveBA1 = hre.ethers.parseUnits("100", 18); // tokenB in poolBA

  await poolAB.setReserves(reserveAB0, reserveAB1);
  await poolBA.setReserves(reserveBA0, reserveBA1);

  await tokenA.transfer(poolAB.target, reserveAB0);
  await tokenB.transfer(poolAB.target, reserveAB1);
  await tokenA.transfer(poolBA.target, reserveBA0);
  await tokenB.transfer(poolBA.target, reserveBA1);

  const FlashArbitrage = await hre.ethers.getContractFactory("FlashArbitrage");
  const arb = await FlashArbitrage.deploy();
  await arb.waitForDeployment();

  await arb.configurePools(poolAB.target, poolBA.target, tokenA.target);

  // Seed arb contract with tokenA so it can perform swaps
  const seedForArb = hre.ethers.parseUnits("10", 18);
  await tokenA.mint(arb.target, seedForArb);


  const amountIn = hre.ethers.parseUnits("1", 18);

  const balBefore = await tokenA.balanceOf(arb.target);
  console.log("arb tokenA balance before:", hre.ethers.formatUnits(balBefore, 18));

  // Optionally set a realistic base fee so receipts include a non-zero effectiveGasPrice
  try {
    const baseGwei = process.env.FORK_BASE_FEE_GWEI ? Number(process.env.FORK_BASE_FEE_GWEI) : 50; // default 50 gwei
    const baseWei = BigInt(Math.floor(baseGwei * 1e9));
    // hex string
    const hex = '0x' + baseWei.toString(16);
    await hre.network.provider.request({ method: 'hardhat_setNextBlockBaseFeePerGas', params: [hex] });
    console.log('Set next block base fee to', baseGwei, 'gwei');
  } catch (e) {
    // ignore if provider doesn't support it
  }

  // Prepare fee overrides (EIP-1559) so receipts show non-zero effectiveGasPrice in local test
  const maxPriorityGwei = process.env.MAX_PRIORITY_GWEI || '2';
  const maxFeeGwei = process.env.MAX_FEE_GWEI || '100';
  const maxPriority = hre.ethers.parseUnits(maxPriorityGwei, 'gwei');
  const maxFee = hre.ethers.parseUnits(maxFeeGwei, 'gwei');

  // Call executeArbitrage as deployer (owner) with fee overrides
  const tx = await arb.executeArbitrage(amountIn, { maxPriorityFeePerGas: maxPriority, maxFeePerGas: maxFee });
  // print tx hash immediately
  console.log("executeArbitrage submitted tx.hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("executeArbitrage receipt.transactionHash:", receipt.transactionHash);

  // Print gas and fee details
  try {
    const gasUsed = receipt.gasUsed;
    const effectiveGasPrice = receipt.effectiveGasPrice || receipt.cumulativeGasUsed && hre.ethers.parseUnits('0', 'wei');
    console.log('gasUsed:', gasUsed.toString());
    console.log('effectiveGasPrice (wei):', effectiveGasPrice.toString());
    const gasCost = gasUsed * BigInt(effectiveGasPrice.toString());
    console.log('gasCost (wei):', gasCost.toString());
  } catch (e) {
    console.warn('Could not read gas details from receipt:', e.message || e);
  }

  // Decode events
  for (const log of receipt.logs) {
    try {
      const parsed = arb.interface.parseLog(log);
      console.log("Event:", parsed.name, parsed.args);
    } catch (e) {
      // skip non-matching logs
    }
  }

  const balAfter = await tokenA.balanceOf(arb.target);
  console.log("arb tokenA balance after:", hre.ethers.formatUnits(balAfter, 18));

  const totalProfits = await arb.totalProfits();
  console.log("totalProfits:", hre.ethers.formatUnits(totalProfits, 18));

  // Compute net profit in token units assuming profits are denominated in the same token as tokenA.
  try {
    const gasUsed = receipt.gasUsed;
    const effectiveGasPrice = receipt.effectiveGasPrice || receipt.cumulativeGasUsed && hre.ethers.parseUnits('0', 'wei');
    const gasCost = gasUsed * BigInt(effectiveGasPrice.toString());

    // If tokenA were ETH, totalProfits (wei) minus gasCost gives net ETH profit.
    const netProfitWei = BigInt(totalProfits.toString()) - BigInt(gasCost.toString());
    console.log('netProfit (if tokenA were ETH) in wei:', netProfitWei.toString());
    console.log('netProfit (if tokenA were ETH) formatted:', hre.ethers.formatUnits(netProfitWei, 18));
  } catch (e) {
    console.warn('Could not compute net profit:', e.message || e);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
