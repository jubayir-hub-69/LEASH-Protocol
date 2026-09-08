import { existsSync, readFileSync } from "fs";
import path from "path";
import { Contract, JsonRpcProvider, ZeroAddress } from "ethers";
import { LEASH_ABI } from "./abi";
import { AGENT_ID, FALLBACK_LEASH_ADDRESS, HARDHAT_RPC } from "./config";
import { formatUsdFromWei, verdictName } from "./format";
import type { AgentResponse } from "./types";

type DeployedFile = {
  LEASH?: string;
  contractAddress?: string;
};

function deployedAddressCandidates(): string[] {
  return [
    path.resolve(process.cwd(), "..", "deployed_addresses.json"),
    path.resolve(process.cwd(), "deployed_addresses.json"),
    path.resolve(__dirname, "../../../deployed_addresses.json"),
  ];
}

export function loadLeashAddress(): { address: string; source: string } {
  for (const file of deployedAddressCandidates()) {
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as DeployedFile;
      const address = parsed.LEASH || parsed.contractAddress;
      if (typeof address === "string" && /^0x[a-fA-F0-9]{40}$/.test(address)) {
        return { address, source: file };
      }
    } catch {
      continue;
    }
  }
  return { address: FALLBACK_LEASH_ADDRESS, source: "hardhat-fallback" };
}

export async function fetchAgentSnapshot(
  agentId = AGENT_ID
): Promise<AgentResponse> {
  const rpc = HARDHAT_RPC;
  const { address, source } = loadLeashAddress();
  const fetchedAt = new Date().toISOString();

  try {
    const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();
    const code = await provider.getCode(address);

    if (!code || code === "0x") {
      return {
        ok: false,
        connected: true,
        rpc,
        contractAddress: address,
        error: "No contract bytecode at the deployed LEASH address.",
        detail:
          "Start `npx hardhat node` and redeploy with `npx hardhat run scripts/deploy.js --network localhost`.",
        fetchedAt,
      };
    }

    const leash = new Contract(address, LEASH_ABI, provider);
    const agentCount = await leash.agentCount();

    if (agentCount < BigInt(agentId)) {
      return {
        ok: false,
        connected: true,
        rpc,
        contractAddress: address,
        error: `Agent ID ${agentId} is not registered (agentCount=${agentCount}).`,
        detail: "Run `npx hardhat run scripts/seed-demo-agent.js --network localhost`.",
        fetchedAt,
      };
    }

    const [agent, threatThreshold] = await Promise.all([
      leash.getAgent(agentId),
      leash.threatThreshold(),
    ]);

    const approvedNext = agent.approvedNextSpend as bigint;
    const [authorized, reason] = await leash.canProceed(agentId, approvedNext);

    return {
      ok: true,
      connected: true,
      rpc,
      chainId: Number(network.chainId),
      blockNumber,
      contractAddress: address,
      addressSource: source,
      agentId,
      agentCount: Number(agentCount),
      wallet: agent.wallet,
      principal: agent.principal,
      mandate: agent.mandate,
      mandateHash: agent.mandateHash,
      spendCapWei: agent.spendCap.toString(),
      spendCapUsd: formatUsdFromWei(agent.spendCap),
      expiresAt: Number(agent.expiresAt),
      deadline: Number(agent.deadline),
      erc7710DelegationHash: agent.erc7710DelegationHash,
      delegationManager: agent.delegationManager,
      paused: Boolean(agent.paused),
      registered: Boolean(agent.registered),
      awaitingVerdict: Boolean(agent.awaitingVerdict),
      nonce: agent.nonce.toString(),
      warningCount: Number(agent.warningCount),
      threatScore: Number(agent.threatScore),
      threatThreshold: Number(threatThreshold),
      approvedNextSpendUsd: formatUsdFromWei(approvedNext),
      lastSubmissionId: agent.lastSubmissionId.toString(),
      approvedDestination:
        agent.approvedDestination === ZeroAddress
          ? "—"
          : agent.approvedDestination,
      lastVerdict: verdictName(agent.lastVerdict),
      killSwitchStatus: agent.paused ? "ACTIVE" : "DISABLED",
      canProceed: Boolean(authorized),
      canProceedReason: reason || (authorized ? "authorized" : "blocked"),
      fetchedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const offline =
      /ECONNREFUSED|ENOTFOUND|failed to detect network|could not detect network|connect/i.test(
        message
      );

    return {
      ok: false,
      connected: !offline,
      rpc,
      contractAddress: address,
      error: offline
        ? "Hardhat node unreachable at http://127.0.0.1:8545"
        : "Failed to read Agent ID 1 from LEASH",
      detail: message,
      fetchedAt,
    };
  }
}
