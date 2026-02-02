async function check() {
  try {
    const mh = await import('@nomicfoundation/hardhat-mocha');
    console.log('hardhat-mocha plugin id:', mh.default?.id);
    console.log('hardhat-mocha has tasks:', Array.isArray(mh.default?.tasks) ? mh.default.tasks.map(t=>t.name) : undefined);
  }
  catch (e) {
    console.error('hardhat-mocha import failed:', e && e.message ? e.message : e);
  }

  try {
    const he = await import('@nomicfoundation/hardhat-ethers');
    console.log('hardhat-ethers plugin id:', he.default?.id);
  }
  catch (e) {
    console.error('hardhat-ethers import failed:', e && e.message ? e.message : e);
  }
}

check();
