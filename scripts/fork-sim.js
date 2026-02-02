import hre from 'hardhat';
import fs from 'fs';

async function main() {
  const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL;
  if (!MAINNET_RPC_URL) {
    console.error('MAINNET_RPC_URL not set in .env. Set it to an archive/full node RPC to run fork simulation.');
    process.exit(1);
  }

  console.log('Resetting Hardhat network to fork mainnet via', MAINNET_RPC_URL);
  // Programmatic hardhat_reset to enable forking for the current runtime
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [{
      forking: {
        jsonRpcUrl: MAINNET_RPC_URL,
        // optional blockNumber: parseInt(process.env.FORK_BLOCK) || undefined
      }
    }]
  });

  console.log('Forked mainnet. Deploying mock environment on top of fork...');

  // Reuse setup-mock deployment logic inline to ensure deterministic behavior
  const [deployer] = await hre.ethers.getSigners();
  console.log('Using signer:', await deployer.getAddress());

  const TestToken = await hre.ethers.getContractFactory('TestToken');
  const tokenA = await TestToken.deploy('TokenA', 'TKA', 0);
  await tokenA.waitForDeployment();
  const tokenB = await TestToken.deploy('TokenB', 'TKB', 0);
  await tokenB.waitForDeployment();

  const MockAMM = await hre.ethers.getContractFactory('MockAMM');
  const poolAB = await MockAMM.deploy(tokenA.target, tokenB.target);
  await poolAB.waitForDeployment();
  const poolBA = await MockAMM.deploy(tokenA.target, tokenB.target);
  await poolBA.waitForDeployment();

  const mintAmount = hre.ethers.parseUnits('1000000', 18);
  await tokenA.mint(await deployer.getAddress(), mintAmount);
  await tokenB.mint(await deployer.getAddress(), mintAmount);

  const reserveAB0 = hre.ethers.parseUnits('100', 18);
  const reserveAB1 = hre.ethers.parseUnits('1000', 18);
  const reserveBA0 = hre.ethers.parseUnits('1000', 18);
  const reserveBA1 = hre.ethers.parseUnits('100', 18);

  await poolAB.setReserves(reserveAB0, reserveAB1);
  await poolBA.setReserves(reserveBA0, reserveBA1);

  await tokenA.transfer(poolAB.target, reserveAB0);
  await tokenB.transfer(poolAB.target, reserveAB1);
  await tokenA.transfer(poolBA.target, reserveBA0);
  await tokenB.transfer(poolBA.target, reserveBA1);

  const FlashArbitrage = await hre.ethers.getContractFactory('FlashArbitrage');
  const arb = await FlashArbitrage.deploy();
  await arb.waitForDeployment();

  await arb.configurePools(poolAB.target, poolBA.target, tokenA.target);
  const seedForArb = hre.ethers.parseUnits('10', 18);
  await tokenA.mint(arb.target, seedForArb);

  console.log('Deployed on fork:');
  console.log(' tokenA:', tokenA.target);
  console.log(' tokenB:', tokenB.target);
  console.log(' poolAB:', poolAB.target);
  console.log(' poolBA:', poolBA.target);
  console.log(' FlashArbitrage:', arb.target);

  const amountIn = hre.ethers.parseUnits('1', 18);
  const balBefore = await tokenA.balanceOf(arb.target);
  console.log('arb tokenA balance before:', hre.ethers.formatUnits(balBefore, 18));

  const tx = await arb.executeArbitrage(amountIn);
  console.log('submitted tx.hash:', tx.hash);
  const receipt = await tx.wait();
  console.log('receipt.transactionHash:', receipt.transactionHash || tx.hash);

  for (const log of receipt.logs) {
    try {
      const parsed = arb.interface.parseLog(log);
      console.log('Event:', parsed.name, parsed.args);
    } catch (e) {}
  }

  const balAfter = await tokenA.balanceOf(arb.target);
  console.log('arb tokenA balance after:', hre.ethers.formatUnits(balAfter, 18));
  const totalProfits = await arb.totalProfits();
  console.log('totalProfits:', hre.ethers.formatUnits(totalProfits, 18));

  // Dump deployed addresses to file for inspection
  const dump = {
    tokenA: tokenA.target,
    tokenB: tokenB.target,
    poolAB: poolAB.target,
    poolBA: poolBA.target,
    flashArb: arb.target
  };
  fs.writeFileSync('fork-deploy.json', JSON.stringify(dump, null, 2));
  console.log('Wrote fork-deploy.json');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
