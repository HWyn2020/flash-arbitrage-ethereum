require('dotenv').config();
const hre = require("hardhat");

async function main() {
  let deployer;
  if (process.env.PRIVATE_KEY) {
    const wallet = new hre.ethers.Wallet(process.env.PRIVATE_KEY, hre.ethers.provider);
    deployer = wallet;
  } else {
    [deployer] = await hre.ethers.getSigners();
  }

  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

    const Flash = await hre.ethers.getContractFactory("FlashArbitrage");
    const flash = await Flash.connect(deployer).deploy();

    // Wait for deployment (support ethers v5 and v6)
    if (typeof flash.deployed === 'function') {
      await flash.deployed();
    } else if (typeof flash.waitForDeployment === 'function') {
      await flash.waitForDeployment();
    }

    // Determine deployed address
    const contractAddress = flash.address || flash.target || (flash.deployTransaction && flash.deployTransaction.contractAddress) || (flash.receipt && flash.receipt.contractAddress);

    // Determine tx hash
    const txHash = (flash.deployTransaction && flash.deployTransaction.hash) || flash.transactionHash || (flash.receipt && flash.receipt.transactionHash) || null;

    const ownerAddress = await flash.owner();

    console.log("FlashArbitrage deployed to:", contractAddress);
    console.log("Contract owner:", ownerAddress);

    // Fetch timestamp from the block if possible
    let deployedAt = new Date().toISOString();
    try {
      if (txHash) {
        const receipt = await hre.ethers.provider.getTransactionReceipt(txHash);
        if (receipt && receipt.blockNumber) {
          const block = await hre.ethers.provider.getBlock(receipt.blockNumber);
          deployedAt = new Date(block.timestamp * 1000).toISOString();
        }
      }
    } catch (err) {
      // ignore and keep current time
    }

    // Write detailed deployment info to deployments/sepolia.json and update deployments/local.json
    try {
      const fs = require('fs');
      const dir = 'deployments';
      fs.mkdirSync(dir, { recursive: true });

      const sepoliaPath = `${dir}/sepolia.json`;
      const sepoliaInfo = {
        address: contractAddress,
        owner: ownerAddress,
        deployer: deployer.address,
        network: 'sepolia',
        txHash: txHash,
        deployedAt: deployedAt
      };
      fs.writeFileSync(sepoliaPath, JSON.stringify(sepoliaInfo, null, 2));
      console.log('Wrote deployment info to', sepoliaPath);

      const localPath = `${dir}/local.json`;
      fs.writeFileSync(localPath, JSON.stringify(sepoliaInfo, null, 2));
      console.log('Updated', localPath);
    } catch (err) {
      console.error('Failed to write deployment files:', err.message);
    }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
