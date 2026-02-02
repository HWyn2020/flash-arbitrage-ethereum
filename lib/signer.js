import { ethers } from 'ethers';

// Signer abstraction: returns a signer depending on env configuration.
// Accepts an optional `provider` (ethers v6 Provider). If not provided, falls back to
// `process.env.RPC_URL`.
export async function getSigner(provider) {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const RPC_SIGNER_URL = process.env.RPC_SIGNER_URL;

  if (RPC_SIGNER_URL) {
    const remote = new ethers.JsonRpcProvider(RPC_SIGNER_URL);
    return remote.getSigner();
  }

  if (PRIVATE_KEY) {
    if (!provider) {
      provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    }
    return new ethers.Wallet(PRIVATE_KEY, provider);
  }

  // If provider supports getSigner (node provider), use it
  if (provider && typeof provider.getSigner === 'function') {
    return provider.getSigner();
  }

  throw new Error('No signer available: set PRIVATE_KEY or RPC_SIGNER_URL or provide a provider');
}
