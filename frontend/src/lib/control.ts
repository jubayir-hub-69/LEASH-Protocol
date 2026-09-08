import { Contract, JsonRpcProvider, Wallet, parseEther } from "ethers";
import { LEASH_ABI } from "./abi";
import {
  AGENT_ID,
  FALLBACK_LEASH_ADDRESS,
  HARDHAT_DEPLOYER_KEY,
  HARDHAT_RPC,
  RESTORE_CAP_USD,
} from "./config";

export type ControlReceipt = {
  hash: string;
  blockNumber: number;
  rpc: string;
};

function rpcCandidates(): string[] {
  const urls = [HARDHAT_RPC];
  if (typeof window !== "undefined") {
    urls.push(`${window.location.origin}/api/rpc`);
  }
  return urls;
}

export function formatControlError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const e = error as {
    shortMessage?: string;
    reason?: string;
    message?: string;
    code?: string;
    info?: { error?: { message?: string } };
  };
  const raw =
    e.shortMessage || e.reason || e.info?.error?.message || e.message || String(error);

  if (/AgentPaused/i.test(raw)) return "Kill switch is already active.";
  if (/AgentNotPaused/i.test(raw)) return "Agent is not frozen.";
  if (/OwnableUnauthorizedAccount/i.test(raw)) return "Signer is not the LEASH owner.";
  if (/InvalidCap/i.test(raw)) return "Restore cap must be greater than zero.";
  return raw;
}

async function connectOwner(contractAddress: string) {
  const address = contractAddress || FALLBACK_LEASH_ADDRESS;
  let lastError: unknown;

  for (const rpc of rpcCandidates()) {
    try {
      const provider = new JsonRpcProvider(rpc);
      await provider.getBlockNumber();
      const signer = new Wallet(HARDHAT_DEPLOYER_KEY, provider);
      return { contract: new Contract(address, LEASH_ABI, signer), rpc };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Could not connect the demo owner wallet to Hardhat.");
}

export async function sendEmergencyFreeze(
  contractAddress: string,
  agentId = AGENT_ID
): Promise<ControlReceipt> {
  const { contract, rpc } = await connectOwner(contractAddress);
  const tx = await contract.emergencyFreeze(agentId);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("emergencyFreeze was submitted but not mined.");
  return { hash: receipt.hash, blockNumber: Number(receipt.blockNumber), rpc };
}

export async function sendAppealAndUnfreeze(
  contractAddress: string,
  agentId = AGENT_ID
): Promise<ControlReceipt> {
  const { contract, rpc } = await connectOwner(contractAddress);
  const newCap = parseEther(String(RESTORE_CAP_USD));
  const tx = await contract.appealAndUnfreeze(agentId, newCap);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("appealAndUnfreeze was submitted but not mined.");
  return { hash: receipt.hash, blockNumber: Number(receipt.blockNumber), rpc };
}
