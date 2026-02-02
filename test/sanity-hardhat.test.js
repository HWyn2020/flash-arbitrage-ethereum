import { expect } from 'chai';
import hardhat from 'hardhat';
const { ethers } = hardhat;

describe('Sanity with Hardhat chai matchers', function () {
  it('works with a basic matcher', async function () {
    expect(1 + 1).to.equal(2);
  });
});
