import hre from "hardhat";

// Simple script to adjust pool reserves and create a clear price discrepancy
// that the bot can detect and execute on.

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  // Get deployed addresses from deployments or env
  const deployments = await import('../deployments/local.json', { assert: { type: 'json' } }).catch(() => null);
  
  if (!deployments || !deployments.default) {
    console.log('⚠️  No local.json deployment file found. Ensure setup-mock.js ran successfully.');
    console.log('Run: npx hardhat run scripts/setup-mock.js --network localhost');
    return;
  }

  const { poolAB, poolBA, tokenA, tokenB } = deployments.default;
  
  if (!poolAB || !poolBA || !tokenA || !tokenB) {
    console.log('⚠️  Missing pool or token addresses in local.json');
    return;
  }

  console.log('🎯 Adjusting pool reserves to create arbitrage opportunity...');
  console.log('PoolAB:', poolAB);
  console.log('PoolBA:', poolBA);

  const MockAMM = await hre.ethers.getContractFactory("MockAMM");
  const pool1 = MockAMM.attach(poolAB);
  const pool2 = MockAMM.attach(poolBA);

  // Create a strong price discrepancy
  // Pool1: 1000 tokenA : 50 tokenB (tokenA cheap)
  // Pool2: 50 tokenA : 1000 tokenB (tokenA expensive)
  const reserveA1 = hre.ethers.parseUnits("1000", 18);
  const reserveB1 = hre.ethers.parseUnits("50", 18);
  const reserveA2 = hre.ethers.parseUnits("50", 18);
  const reserveB2 = hre.ethers.parseUnits("1000", 18);

  await pool1.setReserves(reserveA1, reserveB1);
  await pool2.setReserves(reserveA2, reserveB2);

  console.log('✅ Reserves adjusted:');
  console.log('   Pool1 (AB):', ethers.formatUnits(reserveA1, 18), 'tokenA :', ethers.formatUnits(reserveB1, 18), 'tokenB');
  console.log('   Pool2 (BA):', ethers.formatUnits(reserveA2, 18), 'tokenA :', ethers.formatUnits(reserveB2, 18), 'tokenB');
  console.log('💎 Price discrepancy created! Bot should detect this opportunity.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
