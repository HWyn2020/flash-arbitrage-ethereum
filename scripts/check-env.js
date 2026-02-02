#!/usr/bin/env node
const { execSync } = require('child_process');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const nodeVersion = process.version; // e.g. v18.20.6
const major = parseInt(nodeVersion.replace(/^v/, '').split('.')[0], 10);
if (Number.isNaN(major)) fail(`Unable to parse Node version: ${nodeVersion}`);
if (major < 18) fail(`Node ${nodeVersion} is too old. Require Node >= 18.`);
if (major < 22) console.warn(`Node ${nodeVersion} is below recommended 22.x for Hardhat; proceed with caution.`);

try {
  const out = execSync('npx hardhat --version', { stdio: 'pipe' }).toString().trim();
  console.log('Hardhat:', out);
} catch (err) {
  fail('Hardhat not found locally. Run `npm install` to install devDependencies.');
}

console.log('Environment check passed.');
