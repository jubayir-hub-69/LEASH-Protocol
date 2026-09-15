export const STUDIO_NEXT_RPC = "https://studio-next.genlayer.com/api";
export const HARDHAT_RPC =
  process.env.NEXT_PUBLIC_RPC_URL ||
  process.env.NEXT_PUBLIC_HARDHAT_RPC ||
  STUDIO_NEXT_RPC;
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 61997);
export const AGENT_ID = 1;
export const FALLBACK_LEASH_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
  process.env.NEXT_PUBLIC_LEASH_ADDRESS ||
  "0x379Bf9C412995Fc78B2C603635CBA622583DCf2F";
export const POLL_INTERVAL_MS = 4000;

/** Well-known Hardhat Account #0. Local demo signer only — never a mainnet key. */
export const HARDHAT_DEPLOYER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const HARDHAT_DEPLOYER_ADDRESS =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const RESTORE_CAP_USD = 200;
