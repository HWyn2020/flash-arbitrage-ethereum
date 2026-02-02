import { ethers } from 'ethers';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();
// Resolve RPC URL: prefer `.env` file value if present to avoid system env overrides
function readRpcFromDotenvFile() {
  try {
    const dot = fs.readFileSync('.env', 'utf8');
    const m = dot.match(/^\s*RPC_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (m && m[1]) return m[1].trim();
  } catch (e) {
    // ignore
  }
  return null;
}

const fileRpc = readRpcFromDotenvFile();
const envRpc = process.env.RPC_URL || process.env.SEPOLIA_RPC_URL || null;
const RPC_URL = fileRpc || envRpc;
console.log('Using RPC_URL:', RPC_URL);
if (!RPC_URL) {
  console.error('❌ Missing RPC_URL in .env or environment. Set RPC_URL and retry.');
  process.exit(1);
}

async function main() {
  // Sepolia addresses
  const AAVE_POOL_SEPOLIA = '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951';
  const UNISWAP_V2_ROUTER_SEPOLIA = '0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008';
  const SUSHISWAP_ROUTER_SEPOLIA = '0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008';

  // Connect to provider using resolved RPC_URL
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log("Deploying to Sepolia with account:", wallet.address);
  
  // Force fresh balance check by waiting a moment
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const balance = await provider.getBalance(wallet.address, 'latest');
  console.log("Account balance:", ethers.formatEther(balance), "ETH\n");
  
  if (balance === 0n) {
    console.error("❌ Balance still showing 0! Trying alternative RPC...\n");
    throw new Error("Balance not synced");
  }

  // Load compiled contract
  const artifact = JSON.parse(
    fs.readFileSync('./artifacts/contracts/FlashArbitrage.sol/FlashArbitrage.json', 'utf8')
  );

  // Deploy
  console.log("Deploying FlashArbitrage with Aave V3 integration...");
  console.log("Aave Pool:", AAVE_POOL_SEPOLIA);
  console.log("Router1:", UNISWAP_V2_ROUTER_SEPOLIA);
  console.log("Router2:", SUSHISWAP_ROUTER_SEPOLIA, "\n");

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(
    AAVE_POOL_SEPOLIA,
    UNISWAP_V2_ROUTER_SEPOLIA,
    SUSHISWAP_ROUTER_SEPOLIA
  );

  console.log("Transaction submitted:", contract.deploymentTransaction().hash);
  console.log("Waiting for confirmation...\n");

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("✅ FlashArbitrage deployed at:", address);

  console.log("\n📋 Next steps:");
  console.log("1. Verify contract on Etherscan:");
  console.log(`   npx hardhat verify --network sepolia ${address} "${AAVE_POOL_SEPOLIA}" "${UNISWAP_V2_ROUTER_SEPOLIA}" "${SUSHISWAP_ROUTER_SEPOLIA}"`);
  console.log("\n2. Update .env with:");
  console.log(`   CONTRACT_ADDRESS=${address}`);
}

main().catch(console.error);
