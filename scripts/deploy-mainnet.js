import hre from "hardhat";

// Deploy FlashArbitrage to Ethereum Mainnet
async function main() {
  // Mainnet addresses
  const AAVE_POOL_MAINNET = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
  const UNISWAP_V2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
  const SUSHISWAP_ROUTER = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F';

  const [deployer] = await hre.ethers.getSigners();
  console.log("⚠️  DEPLOYING TO MAINNET ⚠️");
  console.log("Deployer account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "ETH\n");

  if (balance < hre.ethers.parseEther("0.5")) {
    console.log("❌ ERROR: Insufficient balance! Need at least 0.5 ETH for deployment.\n");
    process.exit(1);
  }

  console.log("Press Ctrl+C to cancel, or wait 10 seconds to proceed...\n");
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Deploy FlashArbitrage with Aave Pool and routers
  console.log("Deploying FlashArbitrage with Aave V3 integration...");
  console.log("Aave Pool:", AAVE_POOL_MAINNET);
  console.log("Router1 (Uniswap):", UNISWAP_V2_ROUTER);
  console.log("Router2 (Sushiswap):", SUSHISWAP_ROUTER, "\n");
  
  const FlashArbitrage = await hre.ethers.getContractFactory("FlashArbitrage");
  const arbitrage = await FlashArbitrage.deploy(
    AAVE_POOL_MAINNET,
    UNISWAP_V2_ROUTER,
    SUSHISWAP_ROUTER
  );
  await arbitrage.waitForDeployment();

  const arbAddress = arbitrage.target;
  console.log("✅ FlashArbitrage deployed at:", arbAddress);

  console.log("\n📋 CRITICAL: Next steps:");
  console.log("1. Transfer ownership to multi-sig wallet:");
  console.log(`   Call transferOwnership(multisigAddress)`);
  console.log("\n2. Verify contract on Etherscan:");
  console.log(`   npx hardhat verify --network mainnet ${arbAddress} "${AAVE_POOL_MAINNET}" "${UNISWAP_V2_ROUTER}" "${SUSHISWAP_ROUTER}"`);
  console.log("\n3. Update .env with:");
  console.log(`   CONTRACT_ADDRESS=${arbAddress}`);
  console.log(`   NETWORK=mainnet`);
  console.log("\n4. Run bot with DRY_RUN first:");
  console.log(`   $env:USE_REAL_UNISWAP='1'; $env:DRY_RUN='1'; node bot/arbitrage-bot.js`);
  console.log("\n5. ⚠️  BEFORE GOING LIVE:");
  console.log("   - Complete smart contract audit");
  console.log("   - Use hardware wallet or KMS for private key");
  console.log("   - Set up monitoring and alerting");
  console.log("   - Test Flashbots MEV protection");
  console.log("   - Start with small flash loan amounts");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
