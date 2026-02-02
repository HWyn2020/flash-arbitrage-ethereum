/**
 * Gnosis Safe Multi-Sig Setup Script
 * Deploys a Gnosis Safe and transfers FlashArbitrage contract ownership
 * Requires 2-of-3 signatures for admin functions
 */

import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { getSigner } from '../lib/signer.js';
dotenv.config();

// Gnosis Safe contract addresses (v1.3.0)
const SAFE_FACTORY_ADDRESSES = {
  mainnet: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
  sepolia: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
  goerli: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
  polygon: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
  arbitrum: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
  optimism: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2'
};

const SAFE_SINGLETON_ADDRESSES = {
  mainnet: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
  sepolia: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
  goerli: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
  polygon: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
  arbitrum: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
  optimism: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552'
};

async function main() {
  console.log('🔐 Gnosis Safe Multi-Sig Setup\n');

  // Get network
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const network = await provider.getNetwork();
  const networkName = process.env.NETWORK || 'sepolia';
  
  console.log('📡 Network:', networkName);
  console.log('🆔 Chain ID:', network.chainId.toString(), '\n');

  // Get signer (deployer)
  const deployer = await getSigner(provider);
  const deployerAddress = await deployer.getAddress();
  console.log('👤 Deployer:', deployerAddress);

  // Get owner addresses from environment
  const owner1 = process.env.SAFE_OWNER_1 || deployerAddress;
  const owner2 = process.env.SAFE_OWNER_2;
  const owner3 = process.env.SAFE_OWNER_3;

  if (!owner2 || !owner3) {
    throw new Error(
      'Missing owner addresses. Set SAFE_OWNER_1, SAFE_OWNER_2, SAFE_OWNER_3 in .env\n' +
      'Example:\n' +
      '  SAFE_OWNER_1=0x1234... (your main wallet)\n' +
      '  SAFE_OWNER_2=0x5678... (backup wallet or team member)\n' +
      '  SAFE_OWNER_3=0x9abc... (second backup or advisor)'
    );
  }

  const owners = [owner1, owner2, owner3];
  const threshold = 2; // 2-of-3 signatures required

  console.log('👥 Safe Owners:');
  owners.forEach((owner, i) => console.log(`  ${i + 1}. ${owner}`));
  console.log(`🔢 Threshold: ${threshold} of ${owners.length} signatures\n`);

  // Validate addresses
  if (!ethers.isAddress(owner1) || !ethers.isAddress(owner2) || !ethers.isAddress(owner3)) {
    throw new Error('Invalid owner address format');
  }

  // Get Safe factory and singleton addresses
  const factoryAddress = SAFE_FACTORY_ADDRESSES[networkName];
  const singletonAddress = SAFE_SINGLETON_ADDRESSES[networkName];

  if (!factoryAddress || !singletonAddress) {
    throw new Error(`Gnosis Safe not deployed on ${networkName}`);
  }

  console.log('🏭 Safe Factory:', factoryAddress);
  console.log('📦 Safe Singleton:', singletonAddress, '\n');

  // Safe Factory ABI (minimal)
  const factoryABI = [
    'function createProxyWithNonce(address _singleton, bytes memory initializer, uint256 saltNonce) public returns (address proxy)',
    'event ProxyCreation(address proxy, address singleton)'
  ];

  // Safe ABI (minimal)
  const safeABI = [
    'function setup(address[] calldata _owners, uint256 _threshold, address to, bytes calldata data, address fallbackHandler, address paymentToken, uint256 payment, address payable paymentReceiver) external',
    'function getOwners() public view returns (address[] memory)',
    'function getThreshold() public view returns (uint256)'
  ];

  // FlashArbitrage ABI (for ownership transfer)
  const flashArbitrageABI = [
    'function owner() view returns (address)',
    'function transferOwnership(address newOwner) external',
    'event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)'
  ];

  // Step 1: Deploy Gnosis Safe
  console.log('🚀 Step 1: Deploying Gnosis Safe...');
  
  const factory = new ethers.Contract(factoryAddress, factoryABI, deployer);
  const safeSingleton = new ethers.Interface(safeABI);

  // Encode Safe setup parameters
  const setupData = safeSingleton.encodeFunctionData('setup', [
    owners,
    threshold,
    ethers.ZeroAddress, // to (no delegate call on creation)
    '0x', // data
    ethers.ZeroAddress, // fallbackHandler
    ethers.ZeroAddress, // paymentToken
    0, // payment
    ethers.ZeroAddress // paymentReceiver
  ]);

  // Create Safe with deterministic address (saltNonce = 0)
  const saltNonce = Date.now(); // Use timestamp for unique address
  console.log('⏳ Creating Safe with nonce:', saltNonce);

  const tx = await factory.createProxyWithNonce(singletonAddress, setupData, saltNonce);
  console.log('📝 Transaction:', tx.hash);
  
  const receipt = await tx.wait();
  console.log('✅ Transaction confirmed!\n');

  // Find Safe address from events
  const proxyCreationEvent = receipt.logs.find(log => {
    try {
      const parsed = factory.interface.parseLog(log);
      return parsed?.name === 'ProxyCreation';
    } catch {
      return false;
    }
  });

  if (!proxyCreationEvent) {
    throw new Error('Could not find ProxyCreation event');
  }

  const parsedEvent = factory.interface.parseLog(proxyCreationEvent);
  const safeAddress = parsedEvent.args.proxy;

  console.log('🏦 Gnosis Safe deployed at:', safeAddress);
  console.log('🔗 View on Etherscan:', `https://${networkName !== 'mainnet' ? networkName + '.' : ''}etherscan.io/address/${safeAddress}\n`);

  // Step 2: Verify Safe configuration
  console.log('🔍 Step 2: Verifying Safe configuration...');
  
  const safe = new ethers.Contract(safeAddress, safeABI, provider);
  const safeOwners = await safe.getOwners();
  const safeThreshold = await safe.getThreshold();

  console.log('✅ Safe Owners:', safeOwners);
  console.log('✅ Threshold:', safeThreshold.toString(), '\n');

  // Step 3: Transfer FlashArbitrage ownership
  if (!process.env.CONTRACT_ADDRESS) {
    console.log('⚠️  CONTRACT_ADDRESS not set. Skipping ownership transfer.');
    console.log('📝 To transfer ownership later, run:');
    console.log(`   node scripts/transfer-ownership.js ${safeAddress}\n`);
    console.log('✅ Setup complete! Save this Safe address:');
    console.log(`   GNOSIS_SAFE_ADDRESS=${safeAddress}\n`);
    return;
  }

  console.log('🔄 Step 3: Transferring FlashArbitrage ownership to Safe...');
  console.log('📄 Contract:', process.env.CONTRACT_ADDRESS);

  const flashArbitrage = new ethers.Contract(
    process.env.CONTRACT_ADDRESS,
    flashArbitrageABI,
    deployer
  );

  const currentOwner = await flashArbitrage.owner();
  console.log('👤 Current owner:', currentOwner);

  if (currentOwner.toLowerCase() !== deployerAddress.toLowerCase()) {
    console.log('❌ You are not the current owner. Cannot transfer ownership.');
    return;
  }

  console.log('⏳ Transferring ownership to Safe...');
  const transferTx = await flashArbitrage.transferOwnership(safeAddress);
  console.log('📝 Transaction:', transferTx.hash);
  
  await transferTx.wait();
  console.log('✅ Ownership transferred!\n');

  const newOwner = await flashArbitrage.owner();
  console.log('🎉 New owner:', newOwner);
  console.log('🔐 FlashArbitrage now requires 2-of-3 signatures for all admin functions\n');

  // Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Multi-Sig Setup Complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('📋 Summary:');
  console.log(`  Safe Address: ${safeAddress}`);
  console.log(`  Contract: ${process.env.CONTRACT_ADDRESS}`);
  console.log(`  Threshold: ${threshold} of ${owners.length}`);
  console.log('  Owners:');
  owners.forEach((owner, i) => console.log(`    ${i + 1}. ${owner}`));
  console.log('\n📝 Next Steps:');
  console.log('  1. Add to .env: GNOSIS_SAFE_ADDRESS=' + safeAddress);
  console.log('  2. Install Gnosis Safe app: https://app.safe.global');
  console.log('  3. Import Safe using address above');
  console.log('  4. Test with a small transaction');
  console.log('  5. Update deployment scripts to use Safe\n');
  console.log('⚠️  IMPORTANT: Back up recovery phrases for all 3 owner wallets!');
  console.log('⚠️  Losing 2 wallets = permanent loss of contract access!\n');
}

// Error handling
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  });
