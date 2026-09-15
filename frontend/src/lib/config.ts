export const STUDIO_NEXT_RPC = "https://studio-next.genlayer.com/api";
export const HARDHAT_RPC =
  process.env.NEXT_PUBLIC_RPC_URL ||
  process.env.NEXT_PUBLIC_HARDHAT_RPC ||
  STUDIO_NEXT_RPC;
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 61997);
export const FALLBACK_LEASH_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
  process.env.NEXT_PUBLIC_LEASH_ADDRESS ||
  "0xF1eAC68be6E0fC866CcCb75c3656C96Cc42c859F";
export const POLL_INTERVAL_MS = 15000;
