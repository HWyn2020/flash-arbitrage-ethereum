const hardhat = require('hardhat');
(async ()=>{
  try{
    const hre = hardhat;
    console.log('config.paths.tests =', hre.config.paths.tests);
  }catch(e){
    console.error('ERR', e);
    process.exit(1);
  }
})();
