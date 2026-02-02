require('dotenv').config();
const hre = require('hardhat');
const fs = require('fs');

async function main() {
  const deploymentsPath = 'deployments/local.json';
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`${deploymentsPath} not found. Deploy first or update the path.`);
  }
  const info = JSON.parse(fs.readFileSync(deploymentsPath));
  const address = process.env.CONTRACT_ADDRESS || info.address;
  if (!address) throw new Error('No address found in deployments/local.json and CONTRACT_ADDRESS not set. Provide the deployed contract address or run deploy first.');

  const provider = hre.ethers.provider;
  let signer;
  if (process.env.PRIVATE_KEY) {
    signer = new hre.ethers.Wallet(process.env.PRIVATE_KEY, provider);
  } else {
    [signer] = await hre.ethers.getSigners();
  }

  console.log('Using signer:', signer.address);
  console.log('Signer balance:', (await provider.getBalance(signer.address)).toString());

  const contract = await hre.ethers.getContractAt('FlashArbitrage', address, signer);
  console.log('Calling executeArbitrage()...');
  const tx = await contract.executeArbitrage();

  if (typeof tx.wait === 'function') {
    const receipt = await tx.wait();
    console.log('Transaction hash:', receipt.transactionHash || tx.hash);
    console.log('Status:', receipt.status);
  } else if (typeof tx.waitFor === 'function') {
    // ethers v6
    const receipt = await tx.waitFor(1);
    console.log('Transaction hash:', receipt.transactionHash || tx.hash);
    console.log('Status:', receipt.status);
  } else {
    console.log('Sent transaction:', tx);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
