export const STUDIO_NEXT_RPC = "https://studio-next.genlayer.com/api";
export const HARDHAT_RPC =
  process.env.NEXT_PUBLIC_RPC_URL ||
  process.env.NEXT_PUBLIC_HARDHAT_RPC ||
  STUDIO_NEXT_RPC;
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 61997);
export const FALLBACK_LEASH_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
  process.env.NEXT_PUBLIC_LEASH_ADDRESS ||
  "0xcCB0708FD9fB3c80E8931692ee9eE374AB1C8F95";
export const POLL_INTERVAL_MS = 15000;
export const JURY_WAIT_INTERVAL_MS = 3000;
export const JURY_WAIT_RETRIES = 120;
