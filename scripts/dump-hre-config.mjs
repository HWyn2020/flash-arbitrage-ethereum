import hardhat from 'hardhat';

console.log('hre.config.paths.tests:', JSON.stringify(hardhat.config.paths.tests, null, 2));
console.log('hre.config.paths (full):', JSON.stringify(hardhat.config.paths, null, 2));
