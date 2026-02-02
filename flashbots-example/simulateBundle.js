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
  const PROVIDER_URL = process.env.PROVIDER_URL || process.env.LOCAL_FORK_RPC;
  const SIGNER_PRIVATE_KEY = process.env.SIGNER_PRIVATE_KEY;
  const FLASHBOTS_SIGNING_KEY = process.env.FLASHBOTS_SIGNING_KEY;
  const TARGET_CONTRACT = process.env.CONTRACT_ADDRESS;

  if (!PROVIDER_URL || !SIGNER_PRIVATE_KEY || !FLASHBOTS_SIGNING_KEY || !TARGET_CONTRACT) {
    console.error('Set PROVIDER_URL (or LOCAL_FORK_RPC), SIGNER_PRIVATE_KEY, FLASHBOTS_SIGNING_KEY, and CONTRACT_ADDRESS in .env');
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(PROVIDER_URL);
  const wallet = new ethers.Wallet(SIGNER_PRIVATE_KEY, provider);
  const authSigner = new ethers.Wallet(FLASHBOTS_SIGNING_KEY, provider);

  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner);

  // Build an executeArbitrage transaction calling the target contract
  const arbAbi = ["function executeArbitrage(uint256 amountIn) external"];
  const iface = new ethers.utils.Interface(arbAbi);
  const data = iface.encodeFunctionData('executeArbitrage', [ethers.utils.parseUnits('1', 18)]);

  const tx = {
    to: TARGET_CONTRACT,
    data,
    gasLimit: 300000
  };

  const signedTx = await wallet.signTransaction(tx);

  const block = await provider.getBlock('latest');
  const targetBlock = block.number + 1;

  console.log('Sending bundle to Flashbots for simulation/targetBlock', targetBlock);
  const bundleResponse = await flashbotsProvider.sendBundle(
    [{ signedTransaction: signedTx }],
    targetBlock
  );

  const waitResponse = await bundleResponse.wait();
  console.log('Bundle response:', waitResponse);
}

main().catch(console.error);
