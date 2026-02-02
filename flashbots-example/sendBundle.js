require('dotenv').config();
const { ethers } = require('ethers');
let FlashbotsBundleProvider;
try {
  FlashbotsBundleProvider = require('@flashbots/ethers-provider-bundle').FlashbotsBundleProvider;
} catch (e) {
  console.error('Missing dependency @flashbots/ethers-provider-bundle. To run this example,');
  console.error('install it in flashbots-example with: npm install @flashbots/ethers-provider-bundle@latest');
  process.exit(1);
}

async function main() {
  const PROVIDER_URL = process.env.PROVIDER_URL;
  const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY;
  const FLASHBOTS_SIGNING_KEY = process.env.FLASHBOTS_SIGNING_KEY;

  if (!PROVIDER_URL || !SIGNER_PRIVATE_KEY || !FLASHBOTS_SIGNING_KEY) {
    console.error('set PROVIDER_URL, SIGNER_PRIVATE_KEY, FLASHBOTS_SIGNING_KEY in .env');
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(PROVIDER_URL);
  const authSigner = new ethers.Wallet(FLASHBOTS_SIGNING_KEY, provider);
  const wallet = new ethers.Wallet(SIGNER_PRIVATE_KEY, provider);

  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner);

  // Example: a simple signed transaction (replace with real signed txs you want bundled)
  const tx = await wallet.populateTransaction({
    to: wallet.address,
    value: ethers.utils.parseEther('0.001'),
    gasLimit: 21000,
  });

  const signedTx = await wallet.signTransaction(tx);

  const block = await provider.getBlock('latest');
  const targetBlock = block.number + 1;

  // Flashbots v2 style bundle: signer + transaction object pairs
  const bundle = [
    { signer: wallet, transaction: tx }
  ];

  const bundleResponse = await flashbotsProvider.sendBundle(bundle, targetBlock);
  const waitResponse = await bundleResponse.wait();
  console.log('Bundle wait result:', waitResponse);
}

main().catch(console.error);
