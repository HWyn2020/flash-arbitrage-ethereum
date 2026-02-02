import path from 'path';

async function main() {
  // Load Hardhat runtime to ensure plugins (ethers, chai matchers) register
  console.log('Importing Hardhat to initialize plugins...');
  await import('hardhat');

  // Load Mocha programmatically
  const MochaModule = await import('mocha');
  const Mocha = MochaModule.default || MochaModule;

  const mocha = new Mocha({
    timeout: 40000,
  });

  const testFile = path.resolve(process.cwd(), 'test', 'sanity-hardhat.test.js');
  mocha.addFile(testFile);

  console.log('Running Mocha on', testFile);
  mocha.run((failures) => {
    if (failures) {
      console.error('Tests failed:', failures);
      process.exitCode = 1;
    }
    else {
      console.log('All tests passed');
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
