/**
 * Hardware Wallet / AWS KMS Signer Integration
 * Replaces PRIVATE_KEY in .env with secure signing methods
 * 
 * Supports:
 * - Ledger hardware wallet (via @ledgerhq/hw-app-eth)
 * - AWS KMS (via aws-sdk)
 * - Environment-based fallback for testing
 */

import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

export class SecureSigner {
  constructor(provider) {
    this.provider = provider;
    this.signerType = process.env.SIGNER_TYPE || 'private_key'; // 'ledger', 'kms', 'private_key'
  }

  /**
   * Get signer based on configuration
   * Priority: Ledger > KMS > Private Key (dev only)
   */
  async getSigner() {
    switch (this.signerType.toLowerCase()) {
      case 'ledger':
        return await this.getLedgerSigner();
      
      case 'kms':
        return await this.getKMSSigner();
      
      case 'private_key':
        if (!process.env.PRIVATE_KEY) {
          throw new Error('PRIVATE_KEY not found in .env');
        }
        console.warn('⚠️  WARNING: Using PRIVATE_KEY from .env. NOT SAFE for production!');
        return new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
      
      default:
        throw new Error(`Unknown SIGNER_TYPE: ${this.signerType}. Use 'ledger', 'kms', or 'private_key'`);
    }
  }

  /**
   * Get Ledger hardware wallet signer
   * Requires: npm install @ledgerhq/hw-app-eth @ledgerhq/hw-transport-node-hid
   */
  async getLedgerSigner() {
    try {
      // Dynamic import to avoid dependency if not using Ledger
      const TransportNodeHid = (await import('@ledgerhq/hw-transport-node-hid')).default;
      const Eth = (await import('@ledgerhq/hw-app-eth')).default;
      const { LedgerSigner } = await import('@anders-t/ethers-ledger');

      console.log('🔐 Connecting to Ledger hardware wallet...');
      console.log('📱 Please unlock your Ledger and open the Ethereum app');

      const transport = await TransportNodeHid.create();
      const ledger = new Eth(transport);

      // Default derivation path: m/44'/60'/0'/0/0
      const derivationPath = process.env.LEDGER_PATH || "m/44'/60'/0'/0/0";
      
      const signer = new LedgerSigner(this.provider, derivationPath);
      
      const address = await signer.getAddress();
      console.log('✅ Ledger connected:', address);
      
      return signer;
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        throw new Error(
          'Ledger dependencies not installed. Run: npm install @ledgerhq/hw-app-eth @ledgerhq/hw-transport-node-hid @anders-t/ethers-ledger'
        );
      }
      throw new Error(`Ledger connection failed: ${error.message}`);
    }
  }

  /**
   * Get AWS KMS signer
   * Requires: npm install @aws-sdk/client-kms @rumblefishdev/eth-signer-kms
   */
  async getKMSSigner() {
    try {
      const { KMSClient } = await import('@aws-sdk/client-kms');
      const { KMSSigner } = await import('@rumblefishdev/eth-signer-kms');

      if (!process.env.AWS_KMS_KEY_ID) {
        throw new Error('AWS_KMS_KEY_ID not configured');
      }

      console.log('🔐 Connecting to AWS KMS...');

      const kmsClient = new KMSClient({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
      });

      const signer = new KMSSigner(this.provider, kmsClient, process.env.AWS_KMS_KEY_ID);
      
      const address = await signer.getAddress();
      console.log('✅ AWS KMS connected:', address);
      
      return signer;
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        throw new Error(
          'AWS KMS dependencies not installed. Run: npm install @aws-sdk/client-kms @rumblefishdev/eth-signer-kms'
        );
      }
      throw new Error(`AWS KMS connection failed: ${error.message}`);
    }
  }

  /**
   * Verify signer can sign transactions (test before production)
   */
  async verifySigner(signer) {
    try {
      const address = await signer.getAddress();
      const balance = await this.provider.getBalance(address);
      
      console.log('\n📋 Signer Verification:');
      console.log('  Address:', address);
      console.log('  Balance:', ethers.formatEther(balance), 'ETH');
      console.log('  Type:', this.signerType);
      
      // Test signing a message (doesn't cost gas)
      const message = 'FlashArbitrage Bot Verification';
      const signature = await signer.signMessage(message);
      console.log('  ✅ Message signing: OK');
      
      // Verify signature
      const recoveredAddress = ethers.verifyMessage(message, signature);
      if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
        throw new Error('Signature verification failed!');
      }
      console.log('  ✅ Signature verification: OK\n');
      
      return true;
    } catch (error) {
      console.error('❌ Signer verification failed:', error.message);
      return false;
    }
  }
}

/**
 * Helper function for backwards compatibility
 * Replaces getSigner() in lib/signer.js
 */
export async function getSecureSigner(provider) {
  const secureSigner = new SecureSigner(provider);
  const signer = await secureSigner.getSigner();
  
  // Verify signer works before returning
  const isValid = await secureSigner.verifySigner(signer);
  if (!isValid) {
    throw new Error('Signer verification failed - check hardware wallet or KMS configuration');
  }
  
  return signer;
}

/**
 * Environment configuration guide
 */
export function printSignerSetupGuide() {
  console.log('\n📚 Signer Configuration Guide:\n');
  
  console.log('🔐 Ledger Hardware Wallet (RECOMMENDED):');
  console.log('  SIGNER_TYPE=ledger');
  console.log('  LEDGER_PATH=m/44\'/60\'/0\'/0/0  # Optional, default shown');
  console.log('  npm install @ledgerhq/hw-app-eth @ledgerhq/hw-transport-node-hid @anders-t/ethers-ledger\n');
  
  console.log('☁️  AWS KMS (PRODUCTION):');
  console.log('  SIGNER_TYPE=kms');
  console.log('  AWS_KMS_KEY_ID=your-key-id');
  console.log('  AWS_REGION=us-east-1');
  console.log('  AWS_ACCESS_KEY_ID=your-access-key');
  console.log('  AWS_SECRET_ACCESS_KEY=your-secret-key');
  console.log('  npm install @aws-sdk/client-kms @rumblefishdev/eth-signer-kms\n');
  
  console.log('⚠️  Private Key (DEVELOPMENT ONLY):');
  console.log('  SIGNER_TYPE=private_key');
  console.log('  PRIVATE_KEY=0x...\n');
  
  console.log('⛔ NEVER commit PRIVATE_KEY to git!');
  console.log('⛔ NEVER use PRIVATE_KEY on mainnet!\n');
}
