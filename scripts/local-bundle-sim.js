import hre from 'hardhat';
import fs from 'fs';

// Simulate an atomic bundle locally by disabling automine, sending signed txs, then mining one block.
// Requires a local node (localhost:8545) or a forked hardhat node as RPC_URL in .env.

async function main() {
  const providerUrl = process.env.LOCAL_FORK_RPC || process.env.RPC_URL || 'http://127.0.0.1:8545';
  console.log('Using provider:', providerUrl);

  const { ethers } = hre;
  const provider = new ethers.JsonRpcProvider(providerUrl);

  const signerPk = process.env.SIGNER_PRIVATE_KEY;
  if (!signerPk) {
    console.error('Set SIGNER_PRIVATE_KEY in .env to sign the simulated bundle (can be ephemeral for fork).');
    process.exit(1);
  }

  const wallet = new ethers.Wallet(signerPk, provider);

  const contractAddr = process.env.CONTRACT_ADDRESS;
  if (!contractAddr) {
    console.error('Set CONTRACT_ADDRESS to the deployed FlashArbitrage contract on the fork (or run setup-mock).');
    process.exit(1);
  }

  // ABI for two calls
  const arbIface = new ethers.Interface([
    'function executeArbitrage(uint256 amountIn) external',
    'function recordProfit(uint256 amount) external'
  ]);

  const amountIn = hre.ethers.parseUnits(process.env.SIM_AMOUNT || '1', 18);
  const profitAmount = hre.ethers.parseUnits(process.env.SIM_PROFIT || '0.1', 18);

  const tx1 = {
    to: contractAddr,
    data: arbIface.encodeFunctionData('executeArbitrage', [amountIn]),
    gasLimit: 500000
  };

  const tx2 = {
    to: contractAddr,
    data: arbIface.encodeFunctionData('recordProfit', [profitAmount]),
    gasLimit: 100000
  };

  // Disable automine so both txs land in the same block
  try {
    await provider.send('evm_setAutomine', [false]);
    console.log('Automine disabled');
  } catch (e) {
    console.warn('Could not disable automine (provider may not support it). Proceeding anyway.');
  }

  console.log('Signing and sending tx1 (executeArbitrage)');
  const signed1 = await wallet.signTransaction(tx1);
  const sent1 = await provider.sendTransaction(signed1);
  console.log('Sent tx1 hash:', sent1.hash);

  console.log('Signing and sending tx2 (recordProfit)');
  const signed2 = await wallet.signTransaction(tx2);
  const sent2 = await provider.sendTransaction(signed2);
  console.log('Sent tx2 hash:', sent2.hash);

  console.log('Mining a single block to include both transactions');
  try {
    await provider.send('evm_mine', []);
  } catch (e) {
    console.warn('evm_mine failed:', e.message || e);
  }

  const rec1 = await sent1.wait();
  const rec2 = await sent2.wait();

  console.log('tx1 receipt:', { hash: rec1.transactionHash, status: rec1.status });
  console.log('tx2 receipt:', { hash: rec2.transactionHash, status: rec2.status });

  // Print balances and totalProfits
  const tokenAbi = ['function balanceOf(address) view returns (uint256)'];
  const tokenA = process.env.TOKEN_A_ADDRESS;
  if (tokenA) {
    const token = new ethers.Contract(tokenA, tokenAbi, provider);
    const bal = await token.balanceOf(contractAddr);
    console.log('Contract tokenA balance:', hre.ethers.formatUnits(bal, 18));
  }

  // Try to read totalProfits
  try {
    const arbAbi = ['function totalProfits() view returns (uint256)'];
    const arb = new ethers.Contract(contractAddr, arbAbi, provider);
    const total = await arb.totalProfits();
    console.log('totalProfits:', hre.ethers.formatUnits(total, 18));
  } catch (e) {
    console.warn('Could not read totalProfits:', e.message || e);
  }

  // Re-enable automine
  try {
    await provider.send('evm_setAutomine', [true]);
    console.log('Automine re-enabled');
  } catch (e) {
    // ignore
  }

  console.log('Bundle simulation complete');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
