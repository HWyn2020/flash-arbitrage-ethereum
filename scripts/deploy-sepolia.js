import hre from "hardhat";

// Deploy FlashArbitrage to Sepolia testnet
async function main() {
  // Sepolia addresses
  const AAVE_POOL_SEPOLIA = '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951';
  const UNISWAP_V2_ROUTER_SEPOLIA = '0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008';
  const SUSHISWAP_ROUTER_SEPOLIA = '0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008'; // Use same for testnet

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying to Sepolia with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH\n");

  if (balance < hre.ethers.parseEther("0.1")) {
    console.log("⚠️  WARNING: Low balance! Get testnet ETH from https://sepoliafaucet.com\n");
  }

  // Deploy FlashArbitrage with Aave Pool and routers
  console.log("Deploying FlashArbitrage with Aave V3 integration...");
  console.log("Aave Pool:", AAVE_POOL_SEPOLIA);
  console.log("Router1:", UNISWAP_V2_ROUTER_SEPOLIA);
  console.log("Router2:", SUSHISWAP_ROUTER_SEPOLIA, "\n");
  
  const FlashArbitrage = await hre.ethers.getContractFactory("FlashArbitrage");
  const arbitrage = await FlashArbitrage.deploy(
    AAVE_POOL_SEPOLIA,
    UNISWAP_V2_ROUTER_SEPOLIA,
    SUSHISWAP_ROUTER_SEPOLIA
  );
  await arbitrage.waitForDeployment();

  const arbAddress = arbitrage.target;
  console.log("✅ FlashArbitrage deployed at:", arbAddress);

  console.log("\n📋 Next steps:");
  console.log("1. Verify contract on Etherscan:");
  console.log(`   npx hardhat verify --network sepolia ${arbAddress} "${AAVE_POOL_SEPOLIA}" "${UNISWAP_V2_ROUTER_SEPOLIA}" "${SUSHISWAP_ROUTER_SEPOLIA}"`);
  console.log("\n2. Update .env with:");
  console.log(`   CONTRACT_ADDRESS=${arbAddress}`);
  console.log(`   NETWORK=sepolia`);
  console.log("\n3. Run flash loan arbitrage:");
  console.log(`   $env:USE_REAL_UNISWAP='1'; $env:DRY_RUN='1'; node bot/arbitrage-bot.js`);
  console.log("\n4. Execute real flash loan (TESTNET ONLY!):");
  console.log(`   $env:DRY_RUN='0'; node bot/arbitrage-bot.js`);
  console.log("\n⚠️  No pre-funding needed - flash loans provide capital on-demand!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
