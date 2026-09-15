import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  CHAIN_ID,
  FALLBACK_LEASH_ADDRESS,
  STUDIO_NEXT_RPC,
} from "./config";
import { formatUsd } from "./format";
import { createLeashClient, readLeashStorage } from "./genlayer";
import type { AgentResponse } from "./types";

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

function constructorParamNames(schema: unknown): string[] {
  const ctor = (schema as { ctor?: { params?: unknown } } | null)?.ctor;
  const params = ctor?.params;
  if (!Array.isArray(params)) return [];
  return params
    .map((entry) => (Array.isArray(entry) ? String(entry[0] ?? "") : ""))
    .filter(Boolean);
}

let cachedSchema: unknown = null;

function methodCount(schema: unknown): number {
  const methods = (schema as { methods?: Record<string, unknown> } | null)
    ?.methods;
  return methods ? Object.keys(methods).length : 0;
}

export async function fetchAgentSnapshot(): Promise<AgentResponse> {
  const rpc = STUDIO_NEXT_RPC;
  const { address, source } = loadLeashAddress();
  const fetchedAt = new Date().toISOString();

  try {
    const client = createLeashClient();
    const contractAddress = address as `0x${string}`;

    const { mandate, spendCap, deadline } = await readLeashStorage(
      client,
      contractAddress
    );

    let schema: unknown = cachedSchema;
    if (!schema) {
      try {
        schema = await client.getContractSchema(contractAddress);
        cachedSchema = schema;
      } catch {
        schema = { ctor: { params: [] }, methods: {} };
      }
    }

    const deadlineSeconds = Number(deadline);
    const deadlineOpen = deadlineSeconds === 0;
    const expired = !deadlineOpen && deadlineSeconds * 1000 <= Date.now();
    const capIsZero = spendCap === BigInt(0);
    const canProceed = !capIsZero && !expired;

    return {
      ok: true,
      connected: true,
      rpc,
      chainId: CHAIN_ID,
      blockNumber: null,
      contractAddress,
      addressSource: source,
      mandate,
      spendCap: spendCap.toString(),
      spendCapUsd: formatUsd(spendCap),
      deadline: deadlineSeconds,
      deadlineOpen,
      expired,
      canProceed,
      canProceedReason: capIsZero
        ? "spend_cap is zero"
        : expired
          ? "deadline has passed"
          : "spend_cap is live and deadline is open",
      killSwitchStatus: canProceed ? "DISABLED" : "ACTIVE",
      constructorParams: constructorParamNames(schema),
      methodCount: methodCount(schema),
      fetchedAt,
    };
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
