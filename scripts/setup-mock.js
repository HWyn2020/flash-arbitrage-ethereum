import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);

  const TestToken = await hre.ethers.getContractFactory("TestToken");
  const tokenA = await TestToken.deploy("TokenA", "TKA", 0);
  await tokenA.waitForDeployment();
  const tokenB = await TestToken.deploy("TokenB", "TKB", 0);
  await tokenB.waitForDeployment();

  console.log("Deployed tokens:", tokenA.target, tokenB.target);

  const MockAMM = await hre.ethers.getContractFactory("MockAMM");
  const poolAB = await MockAMM.deploy(tokenA.target, tokenB.target);
  await poolAB.waitForDeployment();
  const poolBA = await MockAMM.deploy(tokenA.target, tokenB.target);
  await poolBA.waitForDeployment();

  console.log("Deployed pools:", poolAB.target, poolBA.target);

  // Mint and seed pools
  const mintAmount = hre.ethers.parseUnits("1000000", 18);
  await tokenA.mint(deployer.address, mintAmount);
  await tokenB.mint(deployer.address, mintAmount);

  // Seed reserves: make poolAB price skewed so arbitrage exists
  const reserveAB0 = hre.ethers.parseUnits("1000", 18);
  const reserveAB1 = hre.ethers.parseUnits("100", 18);
  const reserveBA0 = hre.ethers.parseUnits("100", 18);
  const reserveBA1 = hre.ethers.parseUnits("1000", 18);

  await poolAB.setReserves(reserveAB0, reserveAB1);
  await poolBA.setReserves(reserveBA0, reserveBA1);

  // Transfer tokens into pool contracts so they have balances matching reserves
  await tokenA.transfer(poolAB.target, reserveAB0);
  await tokenB.transfer(poolAB.target, reserveAB1);
  await tokenA.transfer(poolBA.target, reserveBA0);
  await tokenB.transfer(poolBA.target, reserveBA1);

  // Deploy FlashArbitrage and configure pools
  // Use dummy addresses for Aave Pool and routers (not used in mock testing)
  const DUMMY_AAVE = "0x0000000000000000000000000000000000000001";
  const DUMMY_ROUTER1 = "0x0000000000000000000000000000000000000002";
  const DUMMY_ROUTER2 = "0x0000000000000000000000000000000000000003";
  
  const FlashArbitrage = await hre.ethers.getContractFactory("FlashArbitrage");
  const arb = await FlashArbitrage.deploy(DUMMY_AAVE, DUMMY_ROUTER1, DUMMY_ROUTER2);
  await arb.waitForDeployment();

  await arb.configurePools(poolAB.target, poolBA.target, tokenA.target);

  // Mint some tokenA into the arbitrage contract so it can run executeArbitrage immediately
  const seedForArb = hre.ethers.parseUnits("10", 18);
  await tokenA.mint(arb.target, seedForArb);

  console.log("FlashArbitrage deployed at:", arb.target);
  console.log("Configured pools and tokenA on arbitrage contract.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
