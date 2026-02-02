import 'dotenv/config';
import '@nomicfoundation/hardhat-ethers';

const validKey = typeof process.env.PRIVATE_KEY === 'string' && /^0x[a-fA-F0-9]{64}$/.test(process.env.PRIVATE_KEY)
  ? process.env.PRIVATE_KEY
  : null;

export default {
  solidity: '0.8.20',
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || process.env.RPC_URL || '',
      accounts: validKey ? [validKey] : []
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || ''
  }
};