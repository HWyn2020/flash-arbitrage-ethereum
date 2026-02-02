import hardhat from 'hardhat';

async function main() {
  const { ethers } = hardhat;
  const [signer] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory('FlashArbitrage', signer);
  // show deploy tx data length
  try {
    const deployTx = Factory.getDeployTransaction?.();
    console.log('deployTx data length:', deployTx && deployTx.data ? deployTx.data.length : 'no-data');
  } catch (e) {
    console.error('getDeployTransaction error', e.message || e);
  }

  const contract = await Factory.deploy();
  if (typeof contract.waitForDeployment === 'function') {
    await contract.waitForDeployment();
  }
  console.log('deployed at', contract.target || contract.address);
}

main().catch(e => { console.error(e); process.exit(1); });
