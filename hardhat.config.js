require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

function accountsFromEnv() {
  const key = (process.env.PRIVATE_KEY || "").trim();
  const normalized = key.startsWith("0x") ? key.slice(2) : key;
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    return [];
  }
  return [`0x${normalized}`];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    genlayer_studio: {
      url: "http://127.0.0.1:8545",
      chainId: 61999,
      accounts: accountsFromEnv(),
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
    ignition: "./ignition",
  },
  mocha: {
    timeout: 60_000,
  },
};
