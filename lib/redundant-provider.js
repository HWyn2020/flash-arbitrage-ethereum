/**
 * Redundant RPC Provider with Automatic Failover
 * Monitors RPC health and switches to backup providers on failure
 */

import { ethers } from 'ethers';

export class RedundantProvider {
  constructor(rpcUrls = []) {
    if (rpcUrls.length === 0) {
      throw new Error('At least one RPC URL required');
    }

    this.rpcUrls = rpcUrls;
    this.currentIndex = 0;
    this.providers = rpcUrls.map(url => new ethers.JsonRpcProvider(url));
    this.failedProviders = new Set();
    this.stats = rpcUrls.map((url, index) => ({
      url,
      index,
      calls: 0,
      errors: 0,
      lastError: null,
      avgLatency: 0,
      isHealthy: true
    }));
  }

  /**
   * Get current active provider with automatic failover
   */
  getProvider() {
    // Try current provider
    if (!this.failedProviders.has(this.currentIndex)) {
      return this.providers[this.currentIndex];
    }

    // Find next healthy provider
    for (let i = 0; i < this.providers.length; i++) {
      const nextIndex = (this.currentIndex + i + 1) % this.providers.length;
      if (!this.failedProviders.has(nextIndex)) {
        console.log(`🔄 Switching to RPC ${nextIndex + 1}: ${this.rpcUrls[nextIndex]}`);
        this.currentIndex = nextIndex;
        return this.providers[nextIndex];
      }
    }

    // All providers failed - reset and try again
    console.warn('⚠️  All RPC providers failed. Resetting and retrying...');
    this.failedProviders.clear();
    return this.providers[0];
  }

  /**
   * Execute a provider call with automatic retry on failure
   */
  async call(method, ...args) {
    const maxRetries = this.providers.length;
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const provider = this.getProvider();
      const startTime = Date.now();

      try {
        this.stats[this.currentIndex].calls++;
        
        const result = await provider[method](...args);
        
        // Update latency stats
        const latency = Date.now() - startTime;
        const stat = this.stats[this.currentIndex];
        stat.avgLatency = (stat.avgLatency * (stat.calls - 1) + latency) / stat.calls;
        stat.isHealthy = true;

        return result;
      } catch (error) {
        lastError = error;
        
        // Record error
        const stat = this.stats[this.currentIndex];
        stat.errors++;
        stat.lastError = error.message;
        stat.isHealthy = false;

        console.error(`❌ RPC ${this.currentIndex + 1} error:`, error.message);
        
        // Mark as failed and try next
        this.failedProviders.add(this.currentIndex);
        
        if (attempt < maxRetries - 1) {
          console.log(`⏳ Retrying with backup RPC (attempt ${attempt + 2}/${maxRetries})...`);
        }
      }
    }

    throw new Error(`All RPC providers failed. Last error: ${lastError?.message}`);
  }

  /**
   * Common provider methods with failover
   */
  async getBalance(address) {
    return this.call('getBalance', address);
  }

  async getBlock(blockNumber) {
    return this.call('getBlock', blockNumber);
  }

  async getBlockNumber() {
    return this.call('getBlockNumber');
  }

  async getTransaction(txHash) {
    return this.call('getTransaction', txHash);
  }

  async getTransactionReceipt(txHash) {
    return this.call('getTransactionReceipt', txHash);
  }

  async getNetwork() {
    return this.call('getNetwork');
  }

  async getFeeData() {
    return this.call('getFeeData');
  }

  async estimateGas(transaction) {
    return this.call('estimateGas', transaction);
  }

  async send(method, params) {
    return this.call('send', method, params);
  }

  /**
   * Get signer from current provider
   */
  async getSigner(index = 0) {
    return this.getProvider().getSigner(index);
  }

  /**
   * Create contract with failover support
   */
  getContract(address, abi) {
    return new ethers.Contract(address, abi, this.getProvider());
  }

  /**
   * Health check all providers
   */
  async healthCheck() {
    console.log('\n🏥 RPC Health Check:');
    
    const results = await Promise.allSettled(
      this.providers.map(async (provider, index) => {
        const startTime = Date.now();
        try {
          await provider.getBlockNumber();
          const latency = Date.now() - startTime;
          return { index, healthy: true, latency };
        } catch (error) {
          return { index, healthy: false, error: error.message };
        }
      })
    );

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const { healthy, latency, error } = result.value;
        const emoji = healthy ? '✅' : '❌';
        const info = healthy ? `${latency}ms` : error;
        console.log(`  ${emoji} RPC ${index + 1}: ${this.rpcUrls[index]} (${info})`);
        
        // Update health status
        this.stats[index].isHealthy = healthy;
        if (healthy) {
          this.failedProviders.delete(index);
        }
      }
    });

    console.log('');
  }

  /**
   * Get performance statistics
   */
  getStats() {
    return {
      currentProvider: {
        url: this.rpcUrls[this.currentIndex],
        index: this.currentIndex
      },
      providers: this.stats.map(stat => ({
        url: stat.url,
        calls: stat.calls,
        errors: stat.errors,
        errorRate: stat.calls > 0 ? ((stat.errors / stat.calls) * 100).toFixed(2) + '%' : '0%',
        avgLatency: stat.avgLatency.toFixed(0) + 'ms',
        isHealthy: stat.isHealthy,
        lastError: stat.lastError
      }))
    };
  }

  /**
   * Print statistics
   */
  printStats() {
    const stats = this.getStats();
    
    console.log('\n📊 RPC Provider Statistics:');
    console.log('  Current:', stats.currentProvider.url, '\n');
    
    stats.providers.forEach((provider, index) => {
      const emoji = provider.isHealthy ? '✅' : '❌';
      console.log(`  ${emoji} RPC ${index + 1}:`);
      console.log(`     URL: ${provider.url}`);
      console.log(`     Calls: ${provider.calls}`);
      console.log(`     Errors: ${provider.errors} (${provider.errorRate})`);
      console.log(`     Latency: ${provider.avgLatency}`);
      if (provider.lastError) {
        console.log(`     Last Error: ${provider.lastError}`);
      }
      console.log('');
    });
  }
}

/**
 * Load RPC URLs from environment
 */
export function getRedundantProvider() {
  const primaryUrl = process.env.RPC_URL;
  const backup1 = process.env.RPC_URL_BACKUP_1;
  const backup2 = process.env.RPC_URL_BACKUP_2;
  const backup3 = process.env.RPC_URL_BACKUP_3;

  const rpcUrls = [primaryUrl, backup1, backup2, backup3].filter(Boolean);

  if (rpcUrls.length === 0) {
    throw new Error('No RPC URLs configured. Set RPC_URL in .env');
  }

  if (rpcUrls.length === 1) {
    console.warn('⚠️  Only one RPC URL configured. Add RPC_URL_BACKUP_1, RPC_URL_BACKUP_2 for redundancy.');
  } else {
    console.log(`🔗 Loaded ${rpcUrls.length} RPC endpoints with automatic failover`);
  }

  return new RedundantProvider(rpcUrls);
}

/**
 * Performance monitoring dashboard (simple)
 */
export class PerformanceMonitor {
  constructor() {
    this.metrics = {
      opportunities: 0,
      executed: 0,
      successful: 0,
      failed: 0,
      totalProfit: 0n,
      totalGasSpent: 0n,
      startTime: Date.now()
    };
  }

  recordOpportunity() {
    this.metrics.opportunities++;
  }

  recordExecution(success, profit = 0n, gasSpent = 0n) {
    this.metrics.executed++;
    if (success) {
      this.metrics.successful++;
      this.metrics.totalProfit += profit;
    } else {
      this.metrics.failed++;
    }
    this.metrics.totalGasSpent += gasSpent;
  }

  getStats() {
    const runtime = (Date.now() - this.metrics.startTime) / 1000 / 60; // minutes
    const successRate = this.metrics.executed > 0 
      ? ((this.metrics.successful / this.metrics.executed) * 100).toFixed(2)
      : '0.00';

    return {
      runtime: runtime.toFixed(2) + ' minutes',
      opportunities: this.metrics.opportunities,
      executed: this.metrics.executed,
      successful: this.metrics.successful,
      failed: this.metrics.failed,
      successRate: successRate + '%',
      totalProfit: ethers.formatEther(this.metrics.totalProfit),
      totalGasSpent: ethers.formatEther(this.metrics.totalGasSpent),
      netProfit: ethers.formatEther(this.metrics.totalProfit - this.metrics.totalGasSpent)
    };
  }

  printDashboard() {
    const stats = this.getStats();
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Performance Dashboard');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Runtime:', stats.runtime);
    console.log('  Opportunities Found:', stats.opportunities);
    console.log('  Trades Executed:', stats.executed);
    console.log('  Successful:', stats.successful);
    console.log('  Failed:', stats.failed);
    console.log('  Success Rate:', stats.successRate);
    console.log('  Total Profit:', stats.totalProfit, 'ETH');
    console.log('  Total Gas Spent:', stats.totalGasSpent, 'ETH');
    console.log('  Net Profit:', stats.netProfit, 'ETH');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}
