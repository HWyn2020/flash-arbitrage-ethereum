import { ethers } from 'ethers';

console.log('\n🔐 Creating new Sepolia testnet wallet...\n');

const wallet = ethers.Wallet.createRandom();

console.log('✅ NEW WALLET CREATED:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('📍 Address:', wallet.address);
console.log('🔑 Private Key:', wallet.privateKey);
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('📝 NEXT STEPS:\n');
console.log('1. Copy this address:', wallet.address);
console.log('2. Go to https://sepoliafaucet.com');
console.log('3. Paste address and get 0.5 Sepolia ETH');
console.log('4. Update .env file:');
console.log(`   PRIVATE_KEY="${wallet.privateKey}"`);
console.log('\n5. Deploy:');
console.log('   npx hardhat run scripts/deploy-sepolia.js --network sepolia\n');

console.log('⚠️  SAVE THIS PRIVATE KEY - You won\'t see it again!');
console.log('⚠️  This is TESTNET ONLY - Not for mainnet!\n');
