/**
 * scripts/flashbots-offline-bundle.js
 *
 * Template for building an offline-signed Flashbots v2 bundle and simulating it first.
 * Usage (adjust .env):
 *   - Create a .env file with PROVIDER_URL, SIGNER_PRIVATE_KEY, FLASHBOTS_SIGNING_KEY
 *   - Start a local fork or point PROVIDER_URL at your RPC
 *   - Run: `node scripts/flashbots-offline-bundle.js` OR
 *     `npx hardhat run scripts/flashbots-offline-bundle.js --network mainnet` (for Hardhat runtime)
 *
 * IMPORTANT: This script does NOT broadcast to the public mempool. It prepares and (optionally)
 * simulates the bundle using Flashbots RPC. You must run actual sending locally with your keys.
 */

require('dotenv').config();
const { ethers } = require('ethers');
async function main() {
  const PROVIDER_URL = process.env.PROVIDER_URL;
  const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY;
  const FLASHBOTS_SIGNING_KEY = process.env.FLASHBOTS_SIGNING_KEY;

  if (!PROVIDER_URL || !SIGNER_PRIVATE_KEY || !FLASHBOTS_SIGNING_KEY) {
    console.error('Set PROVIDER_URL, SIGNER_PRIVATE_KEY, FLASHBOTS_SIGNING_KEY in .env');
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(PROVIDER_URL);
  const wallet = new ethers.Wallet(SIGNER_PRIVATE_KEY, provider);
  const authSigner = new ethers.Wallet(FLASHBOTS_SIGNING_KEY, provider);

  // Lazy-load Flashbots provider to avoid hard dependency failures in CI
  let FlashbotsBundleProvider;
  try {
    FlashbotsBundleProvider = require('@flashbots/ethers-provider-bundle').FlashbotsBundleProvider;
  } catch (e) {
    console.error('Install @flashbots/ethers-provider-bundle in this project to use this script.');
    console.error('npm install --save @flashbots/ethers-provider-bundle');
    process.exit(1);
  }

  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner);

  // Example: build a transaction to call your deployed contract's `flashArbitrage` method.
  // Replace with your contract address and call data.
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS; // set this before running
  if (!CONTRACT_ADDRESS) {
    console.error('Set CONTRACT_ADDRESS in .env to the deployed FlashArbitrage contract address');
    process.exit(1);
  }

  // Build a sample transaction (this is only a template; replace with your real call)
  const iface = new ethers.utils.Interface([
    'function flashArbitrage(address asset,uint256 amount,address[] path1,address[] path2,uint256 minProfit)'
  ]);

  // Example parameters (replace):
  const asset = process.env.ASSET || '0x0000000000000000000000000000000000000000';
  const amount = process.env.AMOUNT || '0';
  const path1 = [];
  const path2 = [];
  const minProfit = process.env.MIN_PROFIT || '0';

  const data = iface.encodeFunctionData('flashArbitrage', [asset, amount, path1, path2, minProfit]);

  const tx = {
    to: CONTRACT_ADDRESS,
    data,
    gasLimit: ethers.BigNumber.from(process.env.GAS_LIMIT || '1000000'),
    maxFeePerGas: process.env.MAX_FEE_PER_GAS ? ethers.BigNumber.from(process.env.MAX_FEE_PER_GAS) : undefined,
    maxPriorityFeePerGas: process.env.MAX_PRIORITY_FEE_PER_GAS ? ethers.BigNumber.from(process.env.MAX_PRIORITY_FEE_PER_GAS) : undefined,
    value: ethers.BigNumber.from(process.env.VALUE || '0')
  };

  // Populate missing fields (nonce, chainId)
  const populated = await wallet.populateTransaction(tx);
  populated.nonce = populated.nonce ?? (await provider.getTransactionCount(wallet.address));
  populated.chainId = populated.chainId ?? (await provider.getNetwork()).chainId;

  // Offline sign the transaction
  const signedTx = await wallet.signTransaction(populated);
  console.log('Signed tx (hex):', signedTx);

  // Prepare v2-style bundle (signer + transaction object)
  const bundleV2 = [
    { signer: wallet, transaction: populated }
  ];

  console.log('Prepared v2 bundle template (not signed):', JSON.stringify(bundleV2.map(b => ({
    signer: b.signer.address,
    transaction: { to: b.transaction.to, data: b.transaction.data, value: String(b.transaction.value || '0') }
  })), null, 2));

  // For simulation we can use the signed tx (array) or the v2 bundle if the provider supports simulate
  const block = await provider.getBlock('latest');
  const targetBlock = block.number + 1;

  // Try simulate() with signed txs (Flashbots RPC). This does not broadcast.
  try {
    const simulation = await flashbotsProvider.simulate([signedTx], targetBlock);
    console.log('Simulation result:', simulation);
  } catch (err) {
    console.warn('Simulation via flashbotsProvider.simulate failed or is unsupported in this environment:', err.message || err);
    console.log('You can still inspect the signed tx and use a local fork to simulate it.');
  }

  console.log('Offline bundle prepared. To send the v2 bundle, call flashbotsProvider.sendBundle(bundleV2, targetBlock) locally.');
}

main().catch(err => { console.error(err); process.exit(1); });
