import { expect } from 'chai';
const { ethers } = await import('hardhat');

describe('FlashArbitrage', function () {
  let Flash, flash, owner, addr;

  beforeEach(async function () {
    [owner, addr] = await ethers.getSigners();
    Flash = await ethers.getContractFactory('FlashArbitrage');
    flash = await Flash.deploy();
    if (typeof flash.waitForDeployment === 'function') {
      await flash.waitForDeployment();
    } else if (typeof flash.deployed === 'function') {
      await flash.deployed();
    }
  });

  it('should allow owner to record profit and withdraw', async function () {
    // send some value to contract
    const contractAddr = flash.target || flash.address || await flash.getAddress();
    await owner.sendTransaction({ to: contractAddr, value: ethers.parseEther('0.01') });
    expect(await ethers.provider.getBalance(contractAddr)).to.equal(ethers.parseEther('0.01'));

    // record profit
    await flash.connect(owner).recordProfit(100);
    expect(await flash.totalProfits()).to.equal(100);

    // withdraw partial
    const ownerAddress = await owner.getAddress();
    const before = await ethers.provider.getBalance(ownerAddress);
    const tx = await flash.connect(owner).withdraw(owner.address, ethers.parseEther('0.005'));
    await tx.wait();
    const after = await ethers.provider.getBalance(ownerAddress);
    expect(after).to.be.gt(before);
  });

  it('should prevent non-owner from recording profit', async function () {
    await expect(flash.connect(addr).recordProfit(1)).to.be.reverted;
  });
});
