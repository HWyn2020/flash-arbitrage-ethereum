async function check() {
  try {
    const mod = await import('@nomicfoundation/hardhat-mocha');
    console.log('imported hardhat-mocha:', Object.keys(mod));
  }
  catch (e) {
    console.error('hardhat-mocha import failed:', e && e.message ? e.message : e);
  }
}

check();
