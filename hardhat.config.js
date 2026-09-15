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
      url: "https://studio.genlayer.com/api",
      chainId: 61999,
      accounts: accountsFromEnv(),
      gas: 8_000_000,
      gasPrice: 0,
    },
    studio_next: {
      url: "https://studio-next.genlayer.com/api",
      chainId: 61997,
      accounts: accountsFromEnv(),
      // Studio's EVM wallet layer is gasless (eth_gasPrice = 0). Protocol
      // fees are a separate Intelligent-Contract layer, not EIP-1559 gas.
      // Pinning gas + gasPrice forces Hardhat to send legacy type-0 txs and
      // skip eth_estimateGas, which this RPC rejects (block tag = extra param).
      gas: 8_000_000,
      gasPrice: 0,
    },
    genlayer_bradbury: {
      url: "https://rpc.testnet-chain.genlayer.com",
      chainId: 4221,
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
