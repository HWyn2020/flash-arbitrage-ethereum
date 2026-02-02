#!/usr/bin/env node
/**
 * scripts/auto-analyze.js
 *
 * Watches new blocks and prints any logs emitted by your deployed FlashArbitrage
 * contract. When it sees an event it prints the tx hash and decodes events if
 * the ABI is available at the standard Hardhat artifact path.
 *
 * Usage:
 *   - put PROVIDER_URL and CONTRACT_ADDRESS in .env
 *   - node scripts/auto-analyze.js
 */

import 'dotenv/config';
import { JsonRpcProvider, Interface } from 'ethers';
import fs from 'fs';

const PROVIDER_URL = process.env.PROVIDER_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

if (!PROVIDER_URL) {
  console.error('Set PROVIDER_URL in .env');
  process.exit(2);
}
if (!CONTRACT_ADDRESS) {
  console.error('Set CONTRACT_ADDRESS in .env');
  process.exit(2);
}

const provider = new JsonRpcProvider(PROVIDER_URL);

let iface = null;
const abiPath = './artifacts/contracts/FlashArbitrage.sol/FlashArbitrage.json';
if (fs.existsSync(abiPath)) {
  try {
  const json = JSON.parse(fs.readFileSync(abiPath));
  iface = new Interface(json.abi);
    console.log('Loaded ABI from', abiPath);
  } catch (e) {
    console.warn('Failed to parse ABI at', abiPath);
  }
} else {
  console.log('ABI not found at', abiPath, '- will print raw logs only.');
}

console.log('Watching blocks for logs from', CONTRACT_ADDRESS);

provider.on('block', async (blockNumber) => {
  try {
    const logs = await provider.getLogs({
      fromBlock: blockNumber,
      toBlock: blockNumber,
      address: CONTRACT_ADDRESS
    });
    if (logs.length === 0) return;
    for (const log of logs) {
      console.log('---');
      console.log('Block:', blockNumber);
      console.log('TxHash:', log.transactionHash);
      console.log('Log Index:', log.logIndex);
      if (iface) {
        try {
          const parsed = iface.parseLog(log);
          console.log('Event:', parsed.name, parsed.args);
        } catch (e) {
          console.log('Could not parse log with ABI:', e.message);
          console.log('Raw topics/data:', log.topics, log.data);
        }
      } else {
        console.log('Raw topics/data:', log.topics, log.data);
      }
    }
  } catch (e) {
    console.error('Error fetching logs for block', blockNumber, e);
  }
});

process.on('SIGINT', () => {
  console.log('Stopping watcher.');
  process.exit(0);
});
