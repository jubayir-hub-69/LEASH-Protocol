import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  CHAIN_ID,
  FALLBACK_LEASH_ADDRESS,
  STUDIO_NEXT_RPC,
} from "./config";
import { formatUsd } from "./format";
import {
  createLeashClient,
  readLeashSchema,
  readLeashState,
  writeLeashAndWait,
  type HexAddress,
  type LeashOnChainState,
} from "./genlayer";
import type { AgentResponse, AgentSnapshot, JuryWriteResult } from "./types";

type DeployedFile = {
  LEASH?: string;
  contractAddress?: string;
  leashPy?: string;
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
      const address = parsed.LEASH || parsed.contractAddress || parsed.leashPy;
      if (typeof address === "string" && /^0x[a-fA-F0-9]{40}$/.test(address)) {
        return { address, source: file };
      }
    } catch {
      continue;
    }
  }
  return { address: FALLBACK_LEASH_ADDRESS, source: "studio-next-fallback" };
}

let cachedSchema: { methods: string[]; constructorParams: string[] } | null =
  null;

function snapshotFromState(
  state: LeashOnChainState,
  address: string,
  source: string,
  schema: { methods: string[]; constructorParams: string[] }
): AgentSnapshot {
  const deadlineSeconds = Number(state.deadline);
  const deadlineOpen = deadlineSeconds === 0;
  const expired = !deadlineOpen && deadlineSeconds * 1000 <= Date.now();
  const capIsZero = state.spendCap === BigInt(0);
  const killSwitch = state.killSwitch || state.frozen || capIsZero;
  const canProceed = state.canProceed && !expired && !killSwitch;
  const canProceedReason = state.frozen
    ? "owner freeze is active"
    : state.killSwitch
      ? `jury verdict ${state.lastVerdict || "REVOKE"} fired the kill switch`
      : capIsZero
        ? "spend_cap is zero"
        : expired
          ? "deadline has passed"
          : "jury gate is open";

  return {
    ok: true,
    connected: true,
    rpc: STUDIO_NEXT_RPC,
    chainId: CHAIN_ID,
    blockNumber: null,
    contractAddress: address,
    addressSource: source,
    mandate: state.mandate,
    spendCap: state.spendCap.toString(),
    spendCapUsd: formatUsd(state.spendCap),
    deadline: deadlineSeconds,
    deadlineOpen,
    expired,
    canProceed,
    canProceedReason,
    killSwitchStatus: killSwitch ? "ACTIVE" : "DISABLED",
    killSwitch,
    frozen: state.frozen,
    lastVerdict: state.lastVerdict,
    lastReason: state.lastReason,
    lastAction: state.lastAction,
    lastReceipts: state.lastReceipts,
    lastSpend: state.lastSpend.toString(),
    approvedNextSpend: state.approvedNextSpend.toString(),
    threatScore: state.threatScore.toString(),
    threatThreshold: state.threatThreshold.toString(),
    submissionCount: state.submissionCount.toString(),
    owner: state.owner,
    constructorParams: schema.constructorParams,
    methodCount: schema.methods.length,
    methods: schema.methods,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchAgentSnapshot(): Promise<AgentResponse> {
  const rpc = STUDIO_NEXT_RPC;
  const { address, source } = loadLeashAddress();
  const fetchedAt = new Date().toISOString();

  try {
    const client = createLeashClient();
    const contractAddress = address as HexAddress;
    const state = await readLeashState(client, contractAddress);

    if (!cachedSchema) {
      try {
        cachedSchema = await readLeashSchema(client, contractAddress);
      } catch {
        cachedSchema = {
          methods: [
            "get_state",
            "get_mandate",
            "adjudicate",
            "emergency_freeze",
            "appeal_and_unfreeze",
          ],
          constructorParams: ["mandate", "spend_cap", "deadline"],
        };
      }
    }

    return snapshotFromState(state, contractAddress, source, cachedSchema);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const offline =
      /ECONNREFUSED|ENOTFOUND|failed to detect network|could not detect network|connect|fetch failed/i.test(
        message
      );

    return {
      ok: false,
      connected: !offline,
      rpc,
      contractAddress: address,
      error: offline
        ? "Studio Next RPC unreachable at https://studio-next.genlayer.com/api"
        : "Failed to read LEASH state from Studio Next",
      detail: message,
      fetchedAt,
    };
  }
}

export async function submitLeashWrite(args: {
  functionName: "adjudicate" | "emergency_freeze" | "appeal_and_unfreeze";
  callArgs: Array<string | number | boolean>;
}): Promise<JuryWriteResult> {
  const { address, source } = loadLeashAddress();
  try {
    const client = createLeashClient(true);
    const write = await writeLeashAndWait(client, {
      address: address as HexAddress,
      functionName: args.functionName,
      callArgs: args.callArgs,
    });
    const state = await readLeashState(client, address as HexAddress);
    if (!cachedSchema) {
      try {
        cachedSchema = await readLeashSchema(client, address as HexAddress);
      } catch {
        cachedSchema = { methods: [], constructorParams: [] };
      }
    }
    return {
      ok: true,
      functionName: args.functionName,
      txHash: write.hash,
      status: write.status,
      result: write.result,
      state: snapshotFromState(state, address, source, cachedSchema),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      functionName: args.functionName,
      error: `Failed to call ${args.functionName} on Studio Next`,
      detail: message,
    };
  }
}
