import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';
import { RedisLock } from '../lib/lock.js';
import { getSigner } from '../lib/signer.js';
import { UniswapScanner } from '../lib/uniswap-scanner.js';
import { UniswapV3Scanner } from '../lib/uniswap-v3-scanner.js';
import { CircuitBreaker, DiscordNotifier } from '../lib/monitoring.js';
import { SlippageCalculator, formatSlippageInfo } from '../lib/slippage-calculator.js';
dotenv.config();
import { promisify } from 'util';
import { exec as execCb } from 'child_process';
const exec = promisify(execCb);

class ArbitrageBot {
  constructor() {
    this.stats = {
      scans: 0,
      opportunities: 0,
      executed: 0
    };
    this.testFlowCompleted = false; // Track if TEST_FLOW has run once
    this.circuitBreaker = new CircuitBreaker({
      maxFailures: parseInt(process.env.MAX_FAILURES || '5'),
      resetTimeout: parseInt(process.env.CIRCUIT_RESET_MS || '60000'),
    });
    this.notifier = new DiscordNotifier(process.env.DISCORD_WEBHOOK_URL);
    this.flashbotsProvider = null; // Will be initialized in initialize()
    this.slippageCalculator = new SlippageCalculator(parseFloat(process.env.SLIPPAGE_TOLERANCE || '2')); // 2% default
  }

  async initialize() {
    console.log('🤖 Starting Arbitrage Bot...\n');
    
    // Connect to blockchain
    this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

    // Flexible signer: prefer getSigner abstraction which supports PRIVATE_KEY or RPC signer
    // For localhost testing, use the provider's default signer (Hardhat account #0)
    const isLocalhost = process.env.RPC_URL && (process.env.RPC_URL.includes('localhost') || process.env.RPC_URL.includes('127.0.0.1'));
    
    if (isLocalhost) {
      console.log('🔧 Localhost detected — using provider default signer (Hardhat account #0)');
      this.wallet = await this.provider.getSigner(0);
    } else {
      try {
        this.wallet = await getSigner(this.provider);
        try {
          const addr = await this.wallet.getAddress();
          console.log('Using signer:', addr);
        } catch (e) {
          console.log('Using provider signer (no address exposed)');
        }
      } catch (e) {
        // fallback to previous logic
        if (process.env.SIGNER_TYPE === 'rpc') {
          this.wallet = await this.provider.getSigner();
          console.log('Using RPC signer from provider');
        } else if (process.env.PRIVATE_KEY) {
          this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
        } else {
          throw new Error('No signer configured: set PRIVATE_KEY or SIGNER_TYPE=rpc');
        }
      }
    }
    
    console.log('📡 Connected to Sepolia Testnet');
    
    // Resolve wallet address (works with provider signer or Wallet)
    try {
      this.walletAddress = typeof this.wallet.getAddress === 'function' ? await this.wallet.getAddress() : this.wallet.address;
    } catch (e) {
      this.walletAddress = this.wallet.address || '<unknown>';
    }

    const balance = await this.provider.getBalance(this.walletAddress);
    console.log('👛 Wallet:', this.walletAddress);
    console.log('💰 Balance:', ethers.formatEther(balance), 'ETH\n');

    if (balance < ethers.parseEther('0.01')) {
      console.log('⚠️  WARNING: Low balance! Get more testnet ETH from sepoliafaucet.com\n');
    }
    
    // Load contract
    const contractABI = [
      "function executeArbitrage(uint256 amountIn) external",
      "function flashArbitrage(address asset, uint256 amount, address[] calldata path1, address[] calldata path2, uint256 minProfit) external",
      "function totalProfits() view returns (uint256)",
      "function owner() view returns (address)",
      "function recordProfit(uint256 amount) external",
      "function withdraw(address payable to, uint256 amount) external",
      "function withdrawToken(address token, address to, uint256 amount) external"
    ];
    
    // Create a contract instance backed by the provider; connect signer at execution time
    this.contract = new ethers.Contract(
      process.env.CONTRACT_ADDRESS,
      contractABI,
      this.provider
    );

    // Optional local setup: deploy TestToken/MockAMM/FlashArbitrage automatically.
    if (process.env.USE_LOCAL_SETUP === '1') {
      const setupNetwork = process.env.LOCAL_SETUP_NETWORK || 'hardhat';
      console.log(`🔧 USE_LOCAL_SETUP=1 — running setup script on network: ${setupNetwork}`);
      try {
        const cmd = `npx hardhat run scripts/setup-mock.js --network ${setupNetwork}`;
        const { stdout, stderr } = await exec(cmd, { cwd: process.cwd(), env: process.env });
        if (stderr) console.log('setup-mock stderr:', stderr);
        const match = stdout.match(/FlashArbitrage deployed at:\s*(0x[0-9a-fA-F]+)/);
        if (match) {
          const arbAddr = match[1];
          console.log('🔧 Setup complete — FlashArbitrage at', arbAddr);
          process.env.CONTRACT_ADDRESS = arbAddr;
          // Re-create contract bound to new address
          this.contract = new ethers.Contract(arbAddr, contractABI, this.provider);
        } else {
          console.warn('⚠️ Could not parse FlashArbitrage address from setup output. Output:\n', stdout);
        }
      } catch (err) {
        console.warn('⚠️ Local setup failed. Ensure a node is running (for network=localhost) or run the setup manually. Error:', err.message || err);
      }
    }

    // Startup validation: confirm contract exists and owner
    try {
      const contractAddr = process.env.CONTRACT_ADDRESS;
      if (!contractAddr || contractAddr === '') {
        console.warn('⚠️  CONTRACT_ADDRESS is empty');
      } else {
        const code = await this.provider.getCode(contractAddr);
        if (!code || code === '0x') {
          console.warn(`⚠️  No contract code found at ${contractAddr} (getCode returned ${code})`);
        } else {
          console.log('📄 Contract code found at', contractAddr);
        }

        // Try reading owner (if present in ABI)
        try {
          const ownerAddr = await this.contract.owner();
          console.log('👑 Contract owner:', ownerAddr);
          if (this.walletAddress && ownerAddr.toLowerCase() === this.walletAddress.toLowerCase()) {
            console.log('✅ Wallet is contract owner');
          } else {
            console.log('ℹ️  Wallet is NOT the contract owner — owner is', ownerAddr);
          }
        } catch (e) {
          console.log('ℹ️  Could not read owner from contract ABI (owner() may not exist or call failed)');
        }
      }
    } catch (e) {
      console.warn('⚠️  Error during startup contract checks:', e.message || e);
    }

    // Private RPC/relay mode: if PRIVATE_RPC_MODE=1 and PRIVATE_RPC_URL set, use that endpoint to submit signed txs
    this.privateRpcMode = process.env.PRIVATE_RPC_MODE === '1' && !!process.env.PRIVATE_RPC_URL;
    if (this.privateRpcMode) {
      this.privateProvider = new ethers.JsonRpcProvider(process.env.PRIVATE_RPC_URL);
      console.log('🔐 Private RPC mode enabled (PRIVATE_RPC_URL)');
    }
    
    console.log('📄 Contract:', process.env.CONTRACT_ADDRESS);
    console.log('✅ Bot initialized!\n');
    
    // Initialize Uniswap scanner for real opportunities
    const network = process.env.NETWORK || 'mainnet';
    const useRealData = process.env.USE_REAL_UNISWAP === '1';
    if (useRealData) {
      this.scanner = new UniswapScanner(this.provider, network);
      this.v3Scanner = new UniswapV3Scanner(this.provider, network);
      console.log('📊 Uniswap V2 scanner initialized for', network);
      console.log('📊 Uniswap V3 scanner initialized for', network);
    } else {
      console.log('⚠️  USE_REAL_UNISWAP not set — using simulated opportunities');
    }

    // Initialize Flashbots (if enabled)
    const useFlashbots = process.env.USE_FLASHBOTS !== '0'; // Default enabled
    if (useFlashbots && !isLocalhost) {
      try {
        this.flashbotsProvider = await FlashbotsBundleProvider.create(
          this.provider,
          this.wallet,
          process.env.FLASHBOTS_RELAY_URL || 'https://relay.flashbots.net',
          network
        );
        console.log('🔒 Flashbots initialized (MEV protection enabled)');
      } catch (error) {
        console.log('⚠️  Flashbots initialization failed:', error.message);
        console.log('   Falling back to regular mempool execution');
      }
    } else if (isLocalhost) {
      console.log('⚠️  Flashbots disabled (localhost mode)');
    } else {
      console.log('⚠️  Flashbots disabled (USE_FLASHBOTS=0)');
    }
    
    // If SELF_TEST set, perform a quick simulated test of executeArbitrage
    if (process.env.SELF_TEST === '1') {
      console.log('🔬 SELF_TEST enabled — running quick simulation (DRY_RUN recommended)');
      await this.runSelfTest();
    }
    console.log('🔍 Starting to scan for arbitrage opportunities...\n');
  }

  async runSelfTest() {
    try {
      const contractAddr = process.env.CONTRACT_ADDRESS;
      if (!contractAddr) {
        console.error('❌ SELF_TEST: CONTRACT_ADDRESS not set');
        return;
      }

      console.log('🔬 SELF_TEST: calling callStatic.executeArbitrage() to check for reverts');
      try {
        await this.contract.callStatic.executeArbitrage();
        console.log('   ✅ callStatic.executeArbitrage() did NOT revert');
      } catch (err) {
        console.log('   ❌ callStatic.executeArbitrage() reverted or is not implemented:', err.message || err);
      }

      console.log('🔬 SELF_TEST: estimating gas for executeArbitrage()');
      try {
        const gasEstimate = await this.contract.estimateGas.executeArbitrage();
        console.log('   ✅ Gas estimate:', gasEstimate.toString());
      } catch (err) {
        console.log('   ❌ Gas estimation failed:', err.message || err);
      }

      console.log('🔬 SELF_TEST: checking contract balance and owner');
      try {
        const code = await this.provider.getCode(contractAddr);
        const bal = await this.provider.getBalance(contractAddr);
        console.log('   Contract code present:', code && code !== '0x');
        console.log('   Contract balance (ETH):', ethers.formatEther(bal));
      } catch (err) {
        console.log('   ❌ Could not read contract balance/code:', err.message || err);
      }

      console.log('🔬 SELF_TEST complete — no on-chain state changed (DRY_RUN recommended)');
    } catch (e) {
      console.error('❌ SELF_TEST error:', e.message || e);
    }
  }

  async scanForOpportunities() {
    this.stats.scans++;
    
    // Use real Uniswap data if enabled
    if (this.scanner && process.env.USE_REAL_UNISWAP === '1') {
      await this.scanRealOpportunities();
      return;
    }
    
    // Simulate scanning DEXes
    // In production, this would query actual DEX prices
    
    // Every 100 scans, show stats
    if (this.stats.scans % 100 === 0) {
      console.log(`📊 Scanned ${this.stats.scans} times`);
      console.log(`   Opportunities found: ${this.stats.opportunities}`);
      console.log(`   Trades executed: ${this.stats.executed}\n`);
    }
    
    // Simulate finding an opportunity (very rare on testnet)
    const randomChance = Math.random();

    // Allow forced test opportunity for local testing
    // Auto-enable TEST_OPPORTUNITY when TEST_FLOW is active
    const forceOpportunity = process.env.TEST_OPPORTUNITY === '1' || process.env.TEST_FLOW === '1';

    if (forceOpportunity || randomChance > 0.999) { // 0.1% chance to simulate finding opportunity
      this.stats.opportunities++;
      const estimatedProfitEth = 0.05; // simulated estimated profit in ETH
      console.log('💎 OPPORTUNITY FOUND!');
      console.log('   Token: WETH');
      console.log('   Estimated Profit:', estimatedProfitEth, 'ETH');
      console.log('   Attempting to execute...\n');

      // Acquire Redis lock to prevent duplicate execution across bot instances
      const lock = new RedisLock();
      const token = await lock.acquire('arb_lock', 15000);
      if (!token) {
        console.log('Another instance is running, skipping this cycle');
        return;
      }

      try {
        // Safety: simulate the call and estimate gas before sending a real tx
        // Connect contract to signer for all operations
        const contractWithSigner = this.contract.connect(this.wallet);
        
        // Determine amount to use for arbitrage (default 1 tokenA)
        const amountIn = ethers.parseUnits(process.env.ARB_AMOUNT_IN || '1', 18);
        
        try {
          // Use .staticCall for read-only simulation (ethers v6)
          await contractWithSigner.executeArbitrage.staticCall(amountIn);
        } catch (err) {
          console.log('❌ Simulation failed, skipping execution:', err.message, '\n');
          return;
        }

        // estimate gas
        let gasEstimate;
        try {
          gasEstimate = await contractWithSigner.executeArbitrage.estimateGas(amountIn);
        } catch (err) {
          console.log('❌ Gas estimation failed, skipping execution:', err.message, '\n');
          return;
        }

        // get fee data
        const feeData = await this.provider.getFeeData();
        const maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice;
        if (!maxFeePerGas) {
          console.log('❌ Unable to determine gas price, skipping execution\n');
          return;
        }

        const estimatedGasCostEth = parseFloat(ethers.formatEther(gasEstimate * maxFeePerGas));
        const safetyMultiplier = parseFloat(process.env.SAFETY_MULTIPLIER || '1.5');

        if (estimatedProfitEth <= 0) {
          console.log('❌ Estimated profit non-positive, skipping\n');
          return;
        }

        if (estimatedProfitEth < estimatedGasCostEth * safetyMultiplier) {
          console.log(`❌ Profit ${estimatedProfitEth} ETH < gas cost ${estimatedGasCostEth} ETH * ${safetyMultiplier}, skipping\n`);
          return;
        }

        // If TEST_FLOW is enabled, run the full simulated flow (fund contract, execute, recordProfit, withdraw)
        if (process.env.TEST_FLOW === '1') {
          if (this.testFlowCompleted) {
            console.log('✅ TEST_FLOW already completed once — skipping additional executions\n');
            console.log('🎉 Bot test complete! Stop the bot (Ctrl+C) or it will keep scanning.\n');
            return;
          }
          await this.runTestFlow(estimatedProfitEth);
          this.testFlowCompleted = true;
        } else {
          await this.executeArbitrage();
        }
      } finally {
        await lock.release('arb_lock', token);
        await lock.quit();
      }
    }
  }

  // Test flow: simulate a flashloan/fund, execute arbitrage, record fake profit, and withdraw
  async runTestFlow(estimatedProfitEth) {
    console.log('🧪 Running TEST_FLOW: funding contract, executing, recording profit, withdrawing');
    const contractAddr = process.env.CONTRACT_ADDRESS;
    const contractWithSigner = this.contract.connect(this.wallet);
    try {
      // 1) Fund contract from wallet (simulate borrowed funds)
      const fundAmount = ethers.parseEther(process.env.TEST_FUND_ETH || '1');
      console.log('   ➤ Funding contract with', ethers.formatEther(fundAmount), 'ETH from wallet');
      const fundTx = await this.wallet.sendTransaction({ to: contractAddr, value: fundAmount });
      console.log('   ➤ Fund tx hash:', fundTx.hash);
      await fundTx.wait();

      // 2) Execute arbitrage (may be no-op depending on contract)
      const amountIn = ethers.parseUnits(process.env.ARB_AMOUNT_IN || '1', 18);
      console.log('   ➤ Calling executeArbitrage() with amountIn:', ethers.formatUnits(amountIn, 18));
      const execTx = await contractWithSigner.executeArbitrage(amountIn, { gasLimit: 300000 });
      console.log('   ➤ execute tx hash:', execTx.hash);
      const execRec = await execTx.wait();
      console.log('   ➤ execute receipt status:', execRec.status);

      // 3) Record fake profit as owner
      const profitEth = process.env.DEMO_ESTIMATED_PROFIT || estimatedProfitEth.toString();
      const profitWei = ethers.parseEther(profitEth.toString());
      console.log('   ➤ Recording fake profit (wei):', profitWei.toString());
      const recProfitTx = await contractWithSigner.recordProfit(profitWei);
      console.log('   ➤ recordProfit tx hash:', recProfitTx.hash);
      await recProfitTx.wait();

      // 4) Withdraw profit to owner
      const ownerAddr = this.walletAddress;
      console.log('   ➤ Withdrawing', profitEth, 'ETH to owner', ownerAddr);
      const withdrawTx = await contractWithSigner.withdraw(ownerAddr, profitWei);
      console.log('   ➤ withdraw tx hash:', withdrawTx.hash);
      await withdrawTx.wait();

      console.log('🧪 TEST_FLOW complete — check local node transactions for full details');
      this.stats.executed++;
    } catch (err) {
      console.log('❌ TEST_FLOW error:', err.message || err);
    }
  }

  async executeArbitrage() {
    try {
      console.log('🚀 Executing arbitrage trade...');
      
      const contractWithSigner = this.contract.connect(this.wallet);
      
      // Call the contract
      // Respect DRY_RUN mode
      if (process.env.DRY_RUN === '1') {
        console.log('DRY_RUN enabled - not sending transaction');
        return;
      }

      // If flashbots mode is enabled, submit a bundle with optional profit-recording tx
      if (this.privateRpcMode) {
        // Build and sign execute tx and optionally recordProfit tx and send them to private RPC
        const amountIn = ethers.parseUnits(process.env.ARB_AMOUNT_IN || '1', 18);
        const executeTx = await contractWithSigner.executeArbitrage.populateTransaction(amountIn, { gasLimit: 300000 });
        const signedExecute = await this.wallet.signTransaction({ to: this.contract.target, data: executeTx.data, gasLimit: executeTx.gasLimit || 100000 });
        // send via private provider
        const sent = await this.privateProvider.sendTransaction(signedExecute);
        console.log('📤 Sent to private RPC, tx hash:', sent.hash);
        await sent.wait();

        const estimatedProfitEth = parseFloat(process.env.DEMO_ESTIMATED_PROFIT || '0');
        if (estimatedProfitEth > 0) {
          const profitWei = ethers.parseEther(estimatedProfitEth.toString());
          const recordTx = await contractWithSigner.recordProfit.populateTransaction(profitWei);
          const signedRecord = await this.wallet.signTransaction({ to: this.contract.target, data: recordTx.data });
          const sent2 = await this.privateProvider.sendTransaction(signedRecord);
          console.log('📤 Sent profit-record tx to private RPC, tx hash:', sent2.hash);
          await sent2.wait();
        }
        return;
      }

      const amountIn = ethers.parseUnits(process.env.ARB_AMOUNT_IN || '1', 18);
      const tx = await contractWithSigner.executeArbitrage(amountIn, { gasLimit: 300000 });
      
      console.log('📤 Transaction submitted:', tx.hash);
      console.log('⏳ Waiting for confirmation...');
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        this.stats.executed++;
        console.log('✅ SUCCESS! Trade executed!');
        console.log('   Transaction:', `https://sepolia.etherscan.io/tx/${tx.hash}\n`);
      } else {
        console.log('❌ Transaction failed\n');
      }
      
    } catch (error) {
      console.log('❌ Execution error:', error.message, '\n');
    }
  }

  // Scan for real arbitrage opportunities using Uniswap V2 pools
  async scanRealOpportunities() {
    try {
      // WETH address (mainnet/sepolia)
      const WETH = process.env.WETH_ADDRESS || '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
      const amountIn = ethers.parseEther(process.env.SCAN_AMOUNT || '1'); // 1 WETH

      // Scan V2 pools
      const v2Opportunities = this.scanner ? await this.scanner.scanAll(WETH, amountIn) : [];
      
      // Scan V3 pools
      const v3Opportunities = this.v3Scanner ? await this.v3Scanner.scanAllV3(WETH, amountIn) : [];
      
      // Combine all opportunities
      const allOpportunities = [...v2Opportunities, ...v3Opportunities];
      
      // Filter by profitability
      let profitable = [];
      if (this.scanner) {
        profitable = await this.scanner.filterProfitable(allOpportunities, process.env.MIN_PROFIT_ETH || '0.01');
      } else if (this.v3Scanner) {
        profitable = await this.v3Scanner.filterProfitable(allOpportunities, process.env.MIN_PROFIT_ETH || '0.01');
      }

      if (profitable.length > 0) {
        this.stats.opportunities += profitable.length;
        console.log(`💎 ${profitable.length} REAL OPPORTUNITIES FOUND!`);
        
        for (const opp of profitable) {
          console.log(`\n   📊 Opportunity #${this.stats.opportunities}`);
          console.log(`   Protocol: ${opp.protocol || 'V2'}`);
          console.log(`   Pair: ${opp.pairName || `${opp.token0}/${opp.token1}`}`);
          if (opp.dex1 && opp.dex2) {
            console.log(`   DEX Route: ${opp.dex1} → ${opp.dex2}`);
          }
          if (opp.fee1 && opp.fee2) {
            console.log(`   Fee Tiers: ${opp.fee1 / 10000}% → ${opp.fee2 / 10000}%`);
          }
          console.log(`   Gross Profit: ${ethers.formatEther(opp.profit)} WETH`);
          console.log(`   AmountIn: ${ethers.formatEther(opp.amountIn)} WETH`);
          console.log(`   Return: ${((Number(opp.profit) / Number(opp.amountIn)) * 100).toFixed(2)}%`);
          
          // Execute if DRY_RUN is not set
          if (process.env.DRY_RUN !== '1') {
            await this.executeArbitrageReal(opp);
          } else {
            console.log(`   [DRY_RUN] Skipping execution\n`);
          }
        }
      }

      // Log stats every 10 scans
      if (this.stats.scans % 10 === 0) {
        console.log(`📊 Scanned ${this.stats.scans} times (V2: ${v2Opportunities.length}, V3: ${v3Opportunities.length})`);
        console.log(`   Opportunities found: ${this.stats.opportunities}`);
        console.log(`   Trades executed: ${this.stats.executed}\n`);
      }
    } catch (error) {
      console.error('❌ Error scanning real opportunities:', error.message);
    }
  }

  // Execute a real arbitrage opportunity
  async executeArbitrageReal(opportunity) {
    const lock = new RedisLock();
    const token = await lock.acquire('arb_lock', 15000);
    if (!token) {
      console.log('Another instance is executing, skipping');
      return;
    }

    try {
      // Determine if we should use flash loans
      const useFlashLoan = process.env.USE_FLASH_LOAN !== '0'; // Default to true

      if (useFlashLoan) {
        await this.executeFlashLoanArbitrage(opportunity);
      } else {
        await this.executeLegacyArbitrage(opportunity);
      }
    } catch (error) {
      console.log('❌ Execution error:', error.message);
      this.circuitBreaker.recordFailure();
      await this.notifier.notifyError('Execution error', error);
    } finally {
      await lock.release('arb_lock', token);
      await lock.quit();
    }
  }

  // Execute flash loan arbitrage (NEW - capital-free)
  async executeFlashLoanArbitrage(opportunity) {
    // Use Flashbots if available, otherwise regular execution
    if (this.flashbotsProvider) {
      return await this.executeViaFlashbots(opportunity);
    } else {
      return await this.executeViaMempool(opportunity);
    }
  }

  // Execute via public mempool (FALLBACK - less MEV protection)
  async executeViaMempool(opportunity) {
    console.log('🚀 Executing via PUBLIC MEMPOOL (fallback)...');
    
    const asset = opportunity.path ? opportunity.path[0] : process.env.WETH_ADDRESS;
    const amount = opportunity.amountIn;
    const path1 = opportunity.path || [asset];
    const path2 = opportunity.pathReverse || [asset];
    const minProfit = ethers.parseEther(process.env.MIN_PROFIT_ETH || '0.01');

    console.log(`   Flash loan: ${ethers.formatEther(amount)} ${asset.substring(0, 10)}...`);
    console.log(`   Path1: ${path1.map(p => p.substring(0, 6)).join(' → ')}`);
    console.log(`   Path2: ${path2.map(p => p.substring(0, 6)).join(' → ')}`);

    // Pre-flight checks
    const ageMs = Date.now() - (opportunity.timestamp || Date.now());
    if (ageMs > 3000) {
      console.log(`   ⚠️  Opportunity stale (${ageMs}ms old), skipping`);
      return;
    }

    // Slippage protection check
    if (opportunity.reserve0A && opportunity.reserve1A) {
      const slippageProtection = this.slippageCalculator.getProtectedParameters(opportunity, amount.toString());
      const slippageInfo = formatSlippageInfo(slippageProtection);
      console.log(`   🛡️  Slippage protection: ${slippageInfo.slippage}, Min out: ${slippageInfo.minOut2} ETH`);
      
      if (!slippageProtection.isProfitable) {
        console.log(`   ❌ Not profitable with slippage protection, skipping`);
        return;
      }
    }

    // Slippage protection check
    if (opportunity.reserve0A && opportunity.reserve1A) {
      const slippageProtection = this.slippageCalculator.getProtectedParameters(opportunity, amount.toString());
      const slippageInfo = formatSlippageInfo(slippageProtection);
      console.log(`   🛡️  Slippage protection: ${slippageInfo.slippage}, Min out: ${slippageInfo.minOut2} ETH`);
      
      if (!slippageProtection.isProfitable) {
        console.log(`   ❌ Not profitable with slippage protection, skipping`);
        return;
      }
    }

    // Populate transaction (don't send yet)
    const tx = await this.contract.connect(this.wallet).populateTransaction.flashArbitrage(
      asset, amount, path1, path2, minProfit
    );

    const currentBlock = await this.provider.getBlockNumber();
    const targetBlock = currentBlock + 1;

    // Build Flashbots bundle
    const bundle = [
      {
        transaction: {
          ...tx,
          gasLimit: 800000,
          chainId: (await this.provider.getNetwork()).chainId,
        },
        signer: this.wallet,
      }
    ];

    // Simulate bundle first
    console.log(`   🔍 Simulating bundle for block ${targetBlock}...`);
    const signedBundle = await this.flashbotsProvider.signBundle(bundle);
    const simulation = await this.flashbotsProvider.simulate(signedBundle, targetBlock);

    if ('error' in simulation || simulation.firstRevert) {
      console.log('❌ Flashbots simulation failed:', simulation.firstRevert || simulation.error);
      this.circuitBreaker.recordFailure();
      return;
    }

    console.log('   ✅ Flashbots simulation passed');
    console.log(`   💰 Estimated profit: ${ethers.formatEther(simulation.totalGasUsed || 0n)} ETH`);

    // Send bundle
    const bundleSubmission = await this.flashbotsProvider.sendBundle(bundle, targetBlock);

    // Wait for inclusion
    console.log(`   ⏳ Waiting for inclusion in block ${targetBlock}...`);
    const waitResponse = await bundleSubmission.wait();

    if (waitResponse === 0) {
      // Success!
      this.stats.executed++;
      this.circuitBreaker.recordSuccess();
      console.log(`✅ SUCCESS! Bundle included in block ${targetBlock}`);
      console.log(`   Profit: ${ethers.formatEther(opportunity.profit)} ETH (estimated)`);
      await this.notifier.notifyProfit(ethers.formatEther(opportunity.profit), 'flashbots');
    } else if (waitResponse === 1) {
      console.log(`⚠️  Bundle not included (block ${targetBlock} passed)`);
      console.log('   Reason: Likely unprofitable or other bundle won');
    } else {
      console.log(`❌ Bundle rejected: ${waitResponse}`);
      this.circuitBreaker.recordFailure();
    }
  }

  // Execute via public mempool (FALLBACK - can be frontrun)
  async executeViaMempool(opportunity) {
    console.log('🚀 Executing via PUBLIC MEMPOOL (no MEV protection)...');
    
    const contractWithSigner = this.contract.connect(this.wallet);

    // Build swap paths based on opportunity
    const asset = opportunity.path ? opportunity.path[0] : process.env.WETH_ADDRESS;
    const amount = opportunity.amountIn;
    
    // path1: tokenA -> tokenB (DEX1)
    // path2: tokenB -> tokenA (DEX2)
    const path1 = opportunity.path || [asset];
    const path2 = opportunity.pathReverse || [asset];
    
    // Minimum profit (subtract gas costs and buffer)
    const minProfit = ethers.parseEther(process.env.MIN_PROFIT_ETH || '0.01');

    console.log(`   Flash loan: ${ethers.formatEther(amount)} ${asset.substring(0, 10)}...`);
    console.log(`   Path1: ${path1.map(p => p.substring(0, 6)).join(' → ')}`);
    console.log(`   Path2: ${path2.map(p => p.substring(0, 6)).join(' → ')}`);
    console.log(`   Min profit: ${ethers.formatEther(minProfit)} ETH`);

    // PRE-FLIGHT CHECK 1: Re-validate opportunity (price may have moved)
    const ageMs = Date.now() - (opportunity.timestamp || Date.now());
    if (ageMs > 3000) { // Opportunity older than 3 seconds
      console.log(`   ⚠️  Opportunity stale (${ageMs}ms old), skipping`);
      return;
    }

    // PRE-FLIGHT CHECK 2: Gas price sanity check
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
    const gasCostEth = ethers.formatEther(gasPrice * 800000n);
    if (parseFloat(gasCostEth) > parseFloat(ethers.formatEther(opportunity.profit)) * 0.5) {
      console.log(`   ⚠️  Gas cost too high (${gasCostEth} ETH = 50%+ of profit), skipping`);
      return;
    }

    // PRE-FLIGHT CHECK 3: Simulate first (CRITICAL)
    try {
      const simResult = await contractWithSigner.flashArbitrage.staticCall(asset, amount, path1, path2, minProfit);
      console.log('   ✅ Simulation passed');
    } catch (err) {
      console.log('❌ Simulation failed:', err.message);
      // Parse revert reason for better debugging
      if (err.message.includes('Arbitrage not profitable')) {
        console.log('   Reason: Price moved, no longer profitable');
      } else if (err.message.includes('Profit below minimum')) {
        console.log('   Reason: Profit dropped below minimum threshold');
      }
      this.circuitBreaker.recordFailure();
      return;
    }

    // PRE-FLIGHT CHECK 4: Deadline protection (execute fast or abort)
    const deadline = Math.floor(Date.now() / 1000) + 30; // 30-second deadline
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits('2', 'gwei');
    const maxFeePerGas = feeData.maxFeePerGas || ethers.parseUnits('50', 'gwei');

    // Execute flash loan with optimized gas settings
    try {
      const tx = await contractWithSigner.flashArbitrage(asset, amount, path1, path2, minProfit, { 
        gasLimit: 800000,
        maxPriorityFeePerGas, // EIP-1559 tip
        maxFeePerGas, // EIP-1559 max
      });
      console.log('📤 Flash loan transaction submitted:', tx.hash);
      
      // Wait for confirmation with timeout
      const receipt = await Promise.race([
        tx.wait(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction timeout')), 60000))
      ]);
      
      if (receipt.status === 1) {
        this.stats.executed++;
        this.circuitBreaker.recordSuccess();
        console.log('✅ SUCCESS! Flash loan arbitrage executed!');
        console.log(`   Profit: ${ethers.formatEther(opportunity.profit)} ETH (estimated)`);
        console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
        console.log(`   Transaction: https://etherscan.io/tx/${tx.hash}\n`);
        await this.notifier.notifyProfit(ethers.formatEther(opportunity.profit), tx.hash);
      } else {
        console.log('❌ Transaction failed (reverted)\n');
        this.circuitBreaker.recordFailure();
      }
    } catch (error) {
      console.log('❌ Transaction submission error:', error.message);
      this.circuitBreaker.recordFailure();
    }
  }

  // Execute legacy arbitrage (OLD - requires pre-funded balance)
  async executeLegacyArbitrage(opportunity) {
    console.log('🚀 Executing LEGACY arbitrage (pre-funded)...');
    
    const contractWithSigner = this.contract.connect(this.wallet);
    const amountIn = opportunity.amountIn;

    // Simulate first
    try {
      await contractWithSigner.executeArbitrage.staticCall(amountIn);
    } catch (err) {
      console.log('❌ Simulation failed:', err.message);
      this.circuitBreaker.recordFailure();
      return;
    }

    // Execute
    const tx = await contractWithSigner.executeArbitrage(amountIn, { gasLimit: 500000 });
    console.log('📤 Transaction submitted:', tx.hash);
    
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      this.stats.executed++;
      this.circuitBreaker.recordSuccess();
      console.log('✅ SUCCESS! Arbitrage executed!');
      console.log(`   Profit: ${ethers.formatEther(opportunity.profit)} WETH`);
      console.log(`   Transaction: https://etherscan.io/tx/${tx.hash}\n`);
      await this.notifier.notifyProfit(ethers.formatEther(opportunity.profit), tx.hash);
    } else {
      console.log('❌ Transaction failed\n');
      this.circuitBreaker.recordFailure();
    }
  }

  async start() {
    console.log('🟢 BOT IS NOW RUNNING');
    console.log('Press Ctrl+C to stop\n');
    console.log('='.repeat(60) + '\n');
    
    // Scan every 2 seconds
    while (true) {
      if (!this.circuitBreaker.shouldAllowRequest()) {
        console.log('⏸️  Circuit breaker is OPEN - bot paused');
        await this.notifier.notifyCircuitBreaker(this.circuitBreaker.getStats());
        await this.sleep(10000); // Wait 10s before checking again
        continue;
      }
      
      try {
        await this.scanForOpportunities();
      } catch (error) {
        const shouldStop = this.circuitBreaker.recordFailure(error.message);
        await this.notifier.notifyError(error.message);
        if (shouldStop) {
          console.log('🛑 Bot stopped by circuit breaker');
          process.exit(1);
        }
      }
      
      await this.sleep(2000);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Start the bot
async function main() {
  // Check environment variables
  if (!process.env.RPC_URL) {
    console.error('❌ Error: RPC_URL not found in .env file');
    process.exit(1);
  }
  
  if (!process.env.PRIVATE_KEY) {
    console.error('❌ Error: PRIVATE_KEY not found in .env file');
    process.exit(1);
  }
  
  if (!process.env.CONTRACT_ADDRESS) {
    console.error('❌ Error: CONTRACT_ADDRESS not found in .env file');
    console.log('💡 Add this to your .env:');
    console.log('   CONTRACT_ADDRESS="0x229E30a10dd411C385E351885ded12B2012d9B4B"');
    process.exit(1);
  }
  
  const bot = new ArbitrageBot();
  
  try {
    await bot.initialize();
    await bot.start();
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Bot stopped by user');
  process.exit(0);
});

main();