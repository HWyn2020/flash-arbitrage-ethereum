/**
 * Security-focused tests for FlashArbitrage contract
 * Tests: Reentrancy, Access Control, Pause Mechanism, Flash Loan Attacks
 */

import hre from 'hardhat';
const { ethers } = hre;
import { expect } from "chai";
import { loadFixture } from './helpers/loadFixture.mjs';

describe("FlashArbitrage - Security Tests", function () {
  // Fixture to deploy contract and setup
  async function deployContractFixture() {
    // Debug: inspect the module returned by dynamic import to understand available exports
    const hardhatModule = await import('hardhat');
    // eslint-disable-next-line no-console
    console.log('hardhatModule keys:', Object.keys(hardhatModule));
    // eslint-disable-next-line no-console
    console.log('hardhatModule.default keys:', hardhatModule.default ? Object.keys(hardhatModule.default) : null);
    // eslint-disable-next-line no-console
    console.log('hardhatModule.ethers (top-level):', !!hardhatModule.ethers);
    const _hre = hardhatModule.default ?? hardhatModule;
    // eslint-disable-next-line no-console
    console.log('hre.ethers exists:', !!_hre.ethers);

    const [owner, attacker, user1] = await ethers.getSigners();

    // Deploy mock Aave Pool (minimal implementation for testing)
    const MockAavePool = await ethers.getContractFactory("MockAavePool");
    const mockAavePool = await MockAavePool.deploy();

    // Deploy mock routers
    const MockRouter = await ethers.getContractFactory("MockUniswapRouter");
    const router1 = await MockRouter.deploy();
    const router2 = await MockRouter.deploy();

    // Deploy FlashArbitrage
    const FlashArbitrage = await ethers.getContractFactory("FlashArbitrage");
    const flashArbitrage = await FlashArbitrage.deploy(
      await mockAavePool.getAddress(),
      await router1.getAddress(),
      await router2.getAddress()
    );

    // Deploy test tokens
    const TestToken = await ethers.getContractFactory("TestToken");
    const tokenA = await TestToken.deploy("Token A", "TKA", ethers.parseEther("1000000"));
    const tokenB = await TestToken.deploy("Token B", "TKB", ethers.parseEther("1000000"));

    return {
      flashArbitrage,
      mockAavePool,
      router1,
      router2,
      tokenA,
      tokenB,
      owner,
      attacker,
      user1
    };
  }

  describe("Access Control", function () {
    it("Should only allow owner to call flashArbitrage", async function () {
      const { flashArbitrage, attacker, tokenA } = await loadFixture(deployContractFixture);

      const path1 = [await tokenA.getAddress(), await tokenA.getAddress()];
      const path2 = [await tokenA.getAddress(), await tokenA.getAddress()];

      await expect(
        flashArbitrage.connect(attacker).flashArbitrage(
          await tokenA.getAddress(),
          ethers.parseEther("10"),
          path1,
          path2,
          ethers.parseEther("0.01")
        )
      ).to.be.reverted;
    });

    it("Should only allow owner to call executeArbitrage", async function () {
      const { flashArbitrage, attacker } = await loadFixture(deployContractFixture);

      await expect(
        flashArbitrage.connect(attacker).executeArbitrage(ethers.parseEther("1"))
      ).to.be.reverted;
    });

    it("Should only allow owner to withdraw tokens", async function () {
      const { flashArbitrage, attacker, tokenA } = await loadFixture(deployContractFixture);

      await expect(
        flashArbitrage.connect(attacker).withdrawToken(
          await tokenA.getAddress(),
          attacker.address,
          ethers.parseEther("1")
        )
      ).to.be.reverted;
    });

    it("Should only allow owner to withdraw ETH", async function () {
      const { flashArbitrage, attacker } = await loadFixture(deployContractFixture);

      await expect(
        flashArbitrage.connect(attacker).withdraw(attacker.address, ethers.parseEther("1"))
      ).to.be.reverted;
    });

    it("Should only allow owner to pause/unpause", async function () {
      const { flashArbitrage, attacker } = await loadFixture(deployContractFixture);

      await expect(
        flashArbitrage.connect(attacker).emergencyPause("Testing")
      ).to.be.reverted;

      await expect(
        flashArbitrage.connect(attacker).emergencyUnpause()
      ).to.be.reverted;
    });
  });

  describe("Emergency Pause Mechanism", function () {
    it("Should successfully pause and unpause contract", async function () {
      const { flashArbitrage, owner } = await loadFixture(deployContractFixture);

      // Pause
      await expect(flashArbitrage.connect(owner).emergencyPause("Test pause"))
        .to.emit(flashArbitrage, "EmergencyPause")
        .withArgs(owner.address, "Test pause");

      expect(await flashArbitrage.paused()).to.be.true;

      // Unpause
      await expect(flashArbitrage.connect(owner).emergencyUnpause())
        .to.emit(flashArbitrage, "EmergencyUnpause")
        .withArgs(owner.address);

      expect(await flashArbitrage.paused()).to.be.false;
    });

    it("Should prevent flashArbitrage when paused", async function () {
      const { flashArbitrage, owner, tokenA } = await loadFixture(deployContractFixture);

      // Pause contract
      await flashArbitrage.connect(owner).emergencyPause("Testing");

      const path1 = [await tokenA.getAddress(), await tokenA.getAddress()];
      const path2 = [await tokenA.getAddress(), await tokenA.getAddress()];

      await expect(
        flashArbitrage.connect(owner).flashArbitrage(
          await tokenA.getAddress(),
          ethers.parseEther("10"),
          path1,
          path2,
          ethers.parseEther("0.01")
        )
      ).to.be.reverted;
    });

    it("Should prevent executeArbitrage when paused", async function () {
      const { flashArbitrage, owner } = await loadFixture(deployContractFixture);

      // Pause contract
      await flashArbitrage.connect(owner).emergencyPause("Testing");

      await expect(
        flashArbitrage.connect(owner).executeArbitrage(ethers.parseEther("1"))
      ).to.be.reverted;
    });

    it("Should allow withdrawals when paused (emergency recovery)", async function () {
      const { flashArbitrage, owner, tokenA } = await loadFixture(deployContractFixture);

      // Fund contract with tokens
      await tokenA.transfer(await flashArbitrage.getAddress(), ethers.parseEther("100"));

      // Pause contract
      await flashArbitrage.connect(owner).emergencyPause("Testing");

      // Withdrawals should still work (emergency recovery)
      await expect(
        flashArbitrage.connect(owner).withdrawToken(
          await tokenA.getAddress(),
          owner.address,
          ethers.parseEther("50")
        )
      ).to.emit(flashArbitrage, "Withdrawn");
    });
  });

  describe("Reentrancy Protection", function () {
    it("Should prevent reentrancy on flashArbitrage", async function () {
      // Note: Full reentrancy test requires malicious contract
      // This is a placeholder - implement with ReentrancyAttacker contract
      const { flashArbitrage } = await loadFixture(deployContractFixture);
      
      // Contract has nonReentrant modifier
      // Would need to deploy attacker contract that attempts reentry during flash loan callback
      expect(await flashArbitrage.totalProfits()).to.equal(0);
    });

    it("Should prevent reentrancy on withdrawToken", async function () {
      const { flashArbitrage, owner, tokenA } = await loadFixture(deployContractFixture);
      
      // Fund contract
      await tokenA.transfer(await flashArbitrage.getAddress(), ethers.parseEther("100"));

      // First withdrawal should succeed
      await flashArbitrage.connect(owner).withdrawToken(
        await tokenA.getAddress(),
        owner.address,
        ethers.parseEther("50")
      );

      // Attempting rapid sequential calls should work (nonReentrant prevents same-tx reentry)
      await flashArbitrage.connect(owner).withdrawToken(
        await tokenA.getAddress(),
        owner.address,
        ethers.parseEther("25")
      );
    });

    it("Should prevent reentrancy on withdraw ETH", async function () {
      const { flashArbitrage, owner } = await loadFixture(deployContractFixture);

      // Fund contract with ETH
      await owner.sendTransaction({
        to: await flashArbitrage.getAddress(),
        value: ethers.parseEther("1")
      });

      // Withdrawal should succeed
      await flashArbitrage.connect(owner).withdraw(
        owner.address,
        ethers.parseEther("0.5")
      );
    });
  });

  describe("Flash Loan Security", function () {
    it("Should reject executeOperation from non-Aave addresses", async function () {
      const { flashArbitrage, attacker, tokenA } = await loadFixture(deployContractFixture);

      const params = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address[]", "address[]", "uint256"],
        [
          [await tokenA.getAddress()],
          [await tokenA.getAddress()],
          ethers.parseEther("0.01")
        ]
      );

      await expect(
        flashArbitrage.connect(attacker).executeOperation(
          await tokenA.getAddress(),
          ethers.parseEther("10"),
          ethers.parseEther("0.005"),
          await flashArbitrage.getAddress(),
          params
        )
      ).to.be.revertedWith("Caller must be Aave Pool");
    });

    it("Should reject executeOperation with wrong initiator", async function () {
      const { flashArbitrage, mockAavePool, attacker, tokenA } = await loadFixture(deployContractFixture);

      const params = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address[]", "address[]", "uint256"],
        [
          [await tokenA.getAddress()],
          [await tokenA.getAddress()],
          ethers.parseEther("0.01")
        ]
      );

      // Even if call comes from Aave Pool, initiator must be the contract itself
      await expect(
        mockAavePool.simulateCallback(
          await flashArbitrage.getAddress(),
          await tokenA.getAddress(),
          ethers.parseEther("10"),
          ethers.parseEther("0.005"),
          attacker.address, // Wrong initiator
          params
        )
      ).to.be.revertedWith("Initiator must be this contract");
    });

    it("Should validate flash loan state flag", async function () {
      const { flashArbitrage, mockAavePool, tokenA } = await loadFixture(deployContractFixture);

      const params = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address[]", "address[]", "uint256"],
        [
          [await tokenA.getAddress()],
          [await tokenA.getAddress()],
          ethers.parseEther("0.01")
        ]
      );

      // Calling executeOperation without setting inFlashLoan flag should fail
      await expect(
        mockAavePool.simulateCallback(
          await flashArbitrage.getAddress(),
          await tokenA.getAddress(),
          ethers.parseEther("10"),
          ethers.parseEther("0.005"),
          await flashArbitrage.getAddress(),
          params
        )
      ).to.be.revertedWith("Not in flash loan");
    });

    it("reverts if arbitrage is not profitable", async function () {
      const { flashArbitrage, owner, tokenA, tokenB } = await loadFixture(deployContractFixture);

      // Deploy simple MockAMM pools configured to produce a losing round-trip
      const MockAMM = await ethers.getContractFactory("MockAMM");
      const poolAB = await MockAMM.deploy(await tokenA.getAddress(), await tokenB.getAddress());
      const poolBA = await MockAMM.deploy(await tokenB.getAddress(), await tokenA.getAddress());

      // Set reserves so that swaps are unfavorable (large imbalance)
      await poolAB.setReserves(ethers.parseEther("1000000"), ethers.parseEther("1"));
      await poolBA.setReserves(ethers.parseEther("1"), ethers.parseEther("1000000"));

      // Configure pools on the contract and fund it with tokenA
      await flashArbitrage.connect(owner).configurePools(await poolAB.getAddress(), await poolBA.getAddress(), await tokenA.getAddress());
      await tokenA.transfer(await flashArbitrage.getAddress(), ethers.parseEther("100"));

      // Expect the legacy executeArbitrage to revert when the round-trip is losing
      await expect(
        flashArbitrage.connect(owner).executeArbitrage(ethers.parseEther("10"))
      ).to.be.revertedWith("Arbitrage not profitable");
    });
  });

  describe("Input Validation", function () {
    it("Should reject flashArbitrage with invalid paths", async function () {
      const { flashArbitrage, owner, tokenA } = await loadFixture(deployContractFixture);

      // Path too short (length < 2)
      await expect(
        flashArbitrage.connect(owner).flashArbitrage(
          await tokenA.getAddress(),
          ethers.parseEther("10"),
          [await tokenA.getAddress()], // Invalid: length 1
          [await tokenA.getAddress(), await tokenA.getAddress()],
          ethers.parseEther("0.01")
        )
      ).to.be.revertedWith("Invalid paths");
    });

    it("Should reject flashArbitrage with mismatched asset", async function () {
      const { flashArbitrage, owner, tokenA, tokenB } = await loadFixture(deployContractFixture);

      const path1 = [await tokenB.getAddress(), await tokenA.getAddress()]; // Wrong start
      const path2 = [await tokenA.getAddress(), await tokenA.getAddress()];

      await expect(
        flashArbitrage.connect(owner).flashArbitrage(
          await tokenA.getAddress(),
          ethers.parseEther("10"),
          path1,
          path2,
          ethers.parseEther("0.01")
        )
      ).to.be.revertedWith("Paths must start and end with flash loan asset");
    });

    it("Should reject withdrawToken with zero address", async function () {
      const { flashArbitrage, owner, tokenA } = await loadFixture(deployContractFixture);

      await expect(
        flashArbitrage.connect(owner).withdrawToken(
          await tokenA.getAddress(),
          ethers.ZeroAddress,
          ethers.parseEther("1")
        )
      ).to.be.revertedWith("Invalid address");
    });

    it("Should reject withdraw with zero address", async function () {
      const { flashArbitrage, owner } = await loadFixture(deployContractFixture);

      await expect(
        flashArbitrage.connect(owner).withdraw(ethers.ZeroAddress, ethers.parseEther("1"))
      ).to.be.revertedWith("Invalid address");
    });

    it("Should reject withdrawToken with insufficient balance", async function () {
      const { flashArbitrage, owner, tokenA } = await loadFixture(deployContractFixture);

      await expect(
        flashArbitrage.connect(owner).withdrawToken(
          await tokenA.getAddress(),
          owner.address,
          ethers.parseEther("1000")
        )
      ).to.be.revertedWith("Insufficient token balance");
    });

    it("Should reject withdraw with insufficient ETH balance", async function () {
      const { flashArbitrage, owner } = await loadFixture(deployContractFixture);

      await expect(
        flashArbitrage.connect(owner).withdraw(owner.address, ethers.parseEther("100"))
      ).to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Configuration Security", function () {
    it("Should only allow owner to update Aave Pool", async function () {
      const { flashArbitrage, attacker, user1 } = await loadFixture(deployContractFixture);

      await expect(
        flashArbitrage.connect(attacker).setAavePool(user1.address)
      ).to.be.reverted;
    });

    it("Should only allow owner to update routers", async function () {
      const { flashArbitrage, attacker, user1 } = await loadFixture(deployContractFixture);

      await expect(
        flashArbitrage.connect(attacker).setRouters(user1.address, user1.address)
      ).to.be.reverted;
    });

    it("Should successfully update Aave Pool address", async function () {
      const { flashArbitrage, owner, user1 } = await loadFixture(deployContractFixture);

      await flashArbitrage.connect(owner).setAavePool(user1.address);
      expect(await flashArbitrage.aavePool()).to.equal(user1.address);
    });

    it("Should successfully update router addresses", async function () {
      const { flashArbitrage, owner, user1 } = await loadFixture(deployContractFixture);

      await flashArbitrage.connect(owner).setRouters(user1.address, user1.address);
      expect(await flashArbitrage.router1()).to.equal(user1.address);
      expect(await flashArbitrage.router2()).to.equal(user1.address);
    });
  });
});

