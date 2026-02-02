// Simple circuit breaker to stop bot after failures or negative profit

export class CircuitBreaker {
  constructor(options = {}) {
    this.maxFailures = options.maxFailures || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.minProfitThreshold = options.minProfitThreshold || 0; // Total profit threshold
    
    this.failures = 0;
    this.totalProfit = 0n;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.lastFailureTime = null;
  }

  recordSuccess(profit = 0n) {
    this.totalProfit += profit;
    this.failures = 0;
    this.state = 'CLOSED';
    console.log(`✅ Circuit breaker: Success recorded. Total profit: ${this.totalProfit}`);
  }

  recordFailure(error) {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    console.log(`❌ Circuit breaker: Failure ${this.failures}/${this.maxFailures} - ${error}`);
    
    if (this.failures >= this.maxFailures) {
      this.state = 'OPEN';
      console.log(`🚨 CIRCUIT BREAKER OPEN - Bot stopped after ${this.maxFailures} failures`);
      return true; // Signal to stop bot
    }
    return false;
  }

  shouldAllowRequest() {
    if (this.state === 'CLOSED') return true;
    
    if (this.state === 'OPEN') {
      // Check if we should try again
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        console.log('🔄 Circuit breaker: Entering HALF_OPEN state');
        this.state = 'HALF_OPEN';
        this.failures = 0;
        return true;
      }
      return false;
    }
    
    if (this.state === 'HALF_OPEN') {
      return true; // Try one request
    }
    
    return false;
  }

  getStats() {
    return {
      state: this.state,
      failures: this.failures,
      totalProfit: this.totalProfit.toString(),
      maxFailures: this.maxFailures,
    };
  }
}

// Simple Discord webhook notifier
export class DiscordNotifier {
  constructor(webhookUrl) {
    this.webhookUrl = webhookUrl;
    this.enabled = !!webhookUrl;
  }

  async send(message, isError = false) {
    if (!this.enabled) return;
    
    try {
      const color = isError ? 15158332 : 3066993; // Red for errors, green for success
      const payload = {
        embeds: [{
          title: isError ? '🚨 Arbitrage Bot Alert' : '✅ Arbitrage Bot',
          description: message,
          color,
          timestamp: new Date().toISOString(),
        }]
      };

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.warn('Failed to send Discord notification');
      }
    } catch (error) {
      console.warn('Discord notification error:', error.message);
    }
  }

  async notifyProfit(amount, txHash) {
    await this.send(`💰 Profit: ${amount} ETH\nTx: ${txHash}`);
  }

  async notifyError(error) {
    await this.send(`Error: ${error}`, true);
  }

  async notifyCircuitBreaker(stats) {
    await this.send(`🚨 Circuit breaker ${stats.state}\nFailures: ${stats.failures}/${stats.maxFailures}`, true);
  }
}
