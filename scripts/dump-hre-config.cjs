const hre = require('hardhat');

async function main() {
  console.log('hre.config.paths.tests:', JSON.stringify(hre.config.paths.tests, null, 2));
  console.log('hre.config.paths (full):', JSON.stringify(hre.config.paths, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
