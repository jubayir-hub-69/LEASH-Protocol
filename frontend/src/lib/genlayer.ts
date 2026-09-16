import { existsSync, readFileSync } from "fs";
import path from "path";
import { createAccount, createClient, isSuccessful } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";
import {
  CHAIN_ID,
  JURY_WAIT_INTERVAL_MS,
  JURY_WAIT_RETRIES,
  STUDIO_NEXT_RPC,
} from "./config";

export type HexAddress = `0x${string}`;

export type LeashClient = ReturnType<typeof createClient>;

export type LeashOnChainState = {
  mandate: string;
  spendCap: bigint;
  deadline: bigint;
  owner: string;
  killSwitch: boolean;
  frozen: boolean;
  lastVerdict: string;
  lastReason: string;
  lastAction: string;
  lastReceipts: string;
  lastSpend: bigint;
  approvedNextSpend: bigint;
  threatScore: bigint;
  threatThreshold: bigint;
  submissionCount: bigint;
  canProceed: boolean;
};

function studioNextChain() {
  return {
    ...studioDevnet,
    id: CHAIN_ID,
    name: "studio_next",
    rpcUrls: {
      ...studioDevnet.rpcUrls,
      default: { http: [STUDIO_NEXT_RPC] as const },
    },
  };
}

function envCandidates(): string[] {
  return [
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(__dirname, "../../../.env"),
  ];
}

function readEnvFileValue(key: string): string {
  for (const file of envCandidates()) {
    if (!existsSync(file)) continue;
    try {
      const text = readFileSync(file, "utf8");
      const match = text.match(new RegExp(`^${key}\\s*=\\s*(.*)$`, "m"));
      if (!match) continue;
      return match[1].trim().replace(/^['"]|['"]$/g, "");
    } catch {
      continue;
    }
  }
  return "";
}

export function loadPrivateKey(): `0x${string}` {
  const raw = (process.env.PRIVATE_KEY || readEnvFileValue("PRIVATE_KEY")).trim();
  if (!raw) {
    throw new Error(
      "PRIVATE_KEY is missing. Put it in the repo-root .env so the dashboard can submit jury writes."
    );
  }
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

export function createLeashClient(withAccount = false) {
  const chain = studioNextChain();
  if (!withAccount) {
    return createClient({
      chain,
      endpoint: STUDIO_NEXT_RPC,
    });
  }
  return createClient({
    chain,
    endpoint: STUDIO_NEXT_RPC,
    account: createAccount(loadPrivateKey()),
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value instanceof Map) {
    return Object.fromEntries(value.entries());
  }
  if (Array.isArray(value)) {
    const rec: Record<string, unknown> = {};
    for (const entry of value) {
      if (Array.isArray(entry) && entry.length >= 2) {
        rec[String(entry[0])] = entry[1];
      }
    }
    if (Object.keys(rec).length) return rec;
  }
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return {};
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "bigint" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value == null) return fallback;
  return String(value);
}

function asBigInt(value: unknown, fallback = BigInt(0)): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim() !== "") {
    try {
      return BigInt(value);
    } catch {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return BigInt(Math.trunc(numeric));
    }
  }
  if (typeof value === "boolean") return value ? BigInt(1) : BigInt(0);
  return fallback;
}

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value !== BigInt(0);
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    return lowered === "true" || lowered === "1" || lowered === "yes";
  }
  return false;
}

export function parseLeashState(value: unknown): LeashOnChainState {
  const rec = asRecord(value);
  if (!rec.mandate && rec.mandate !== "") {
    throw new Error("get_state did not return a mandate field");
  }
  return {
    mandate: asString(rec.mandate),
    spendCap: asBigInt(rec.spend_cap),
    deadline: asBigInt(rec.deadline),
    owner: asString(rec.owner),
    killSwitch: asBool(rec.kill_switch),
    frozen: asBool(rec.frozen),
    lastVerdict: asString(rec.last_verdict, "NONE"),
    lastReason: asString(rec.last_reason),
    lastAction: asString(rec.last_action),
    lastReceipts: asString(rec.last_receipts),
    lastSpend: asBigInt(rec.last_spend),
    approvedNextSpend: asBigInt(rec.approved_next_spend),
    threatScore: asBigInt(rec.threat_score),
    threatThreshold: asBigInt(rec.threat_threshold, BigInt(10)),
    submissionCount: asBigInt(rec.submission_count),
    canProceed: asBool(rec.can_proceed),
  };
}

const READ_OPTS = {
  transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
} as const;

export async function readLeashState(
  client: LeashClient,
  address: HexAddress
): Promise<LeashOnChainState> {
  const raw = await client.readContract({
    address,
    functionName: "get_state",
    args: [],
    ...READ_OPTS,
  });
  return parseLeashState(raw);
}

export async function readLeashSchema(
  client: LeashClient,
  address: HexAddress
): Promise<{ methods: string[]; constructorParams: string[] }> {
  const schema = (await client.getContractSchema(address)) as {
    ctor?: { params?: unknown };
    methods?: Record<string, unknown>;
  };
  const params = Array.isArray(schema?.ctor?.params) ? schema.ctor.params : [];
  const constructorParams = params
    .map((entry) => (Array.isArray(entry) ? String(entry[0] ?? "") : ""))
    .filter(Boolean);
  const methods = Object.keys(schema?.methods ?? {});
  return { methods, constructorParams };
}

type FeeQuote = {
  distribution: unknown;
  feeValue: bigint;
};

async function quoteWriteFees(
  client: LeashClient,
  writeArgs: {
    address: HexAddress;
    functionName: string;
    args: unknown[];
  }
): Promise<FeeQuote | undefined> {
  const estimateWrite = (
    client as LeashClient & {
      estimateTransactionFeesForWrite?: (args: unknown) => Promise<{
        policy?: { enabled?: boolean };
        distribution?: unknown;
        feeValue?: bigint | number;
        gasless?: boolean;
      }>;
    }
  ).estimateTransactionFeesForWrite;

  if (typeof estimateWrite === "function") {
    try {
      const estimate = await estimateWrite(writeArgs);
      return normalizeFeeEstimate(estimate);
    } catch {
      // Fall through to the generic quote.
    }
  }

  if (typeof client.estimateTransactionFees !== "function") return undefined;
  try {
    const estimate = await client.estimateTransactionFees();
    return normalizeFeeEstimate(estimate);
  } catch {
    return undefined;
  }
}

function normalizeFeeEstimate(estimate: {
  policy?: { enabled?: boolean };
  distribution?: unknown;
  feeValue?: bigint | number;
  gasless?: boolean;
} | null | undefined): FeeQuote | undefined {
  if (!estimate) return undefined;
  const enabled = estimate.policy?.enabled !== false;
  const feeValue = estimate.feeValue;
  const gasless =
    estimate.gasless === true ||
    feeValue === BigInt(0) ||
    feeValue === 0 ||
    feeValue === undefined;
  if (!enabled || gasless || !estimate.distribution) return undefined;
  return {
    distribution: estimate.distribution,
    feeValue: typeof feeValue === "bigint" ? feeValue : BigInt(feeValue ?? 0),
  };
}

export type WriteReceipt = {
  hash: `0x${string}`;
  status: string;
  result: string;
  successful: boolean;
  receipt: unknown;
};

function receiptField(receipt: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = receipt[key];
    if (value != null && value !== "") return String(value);
  }
  return "";
}

function leaderError(receipt: unknown): string {
  const rec = asRecord(receipt);
  const consensus = asRecord(rec.consensus_data ?? rec.consensusData);
  const leader = consensus.leader_receipt ?? consensus.leaderReceipt;
  const one = Array.isArray(leader) ? leader[0] : leader;
  const leaderRec = asRecord(one);
  return asString(
    leaderRec.error || leaderRec.stderr || leaderRec.result || leaderRec.stdout
  );
}

export async function writeLeashAndWait(
  client: LeashClient,
  args: {
    address: HexAddress;
    functionName: string;
    callArgs: Array<string | number | boolean>;
  }
): Promise<WriteReceipt> {
  const account = createAccount(loadPrivateKey());
  const writeArgs = {
    account,
    address: args.address,
    functionName: args.functionName,
    args: args.callArgs,
  };
  const fees = await quoteWriteFees(client, {
    address: args.address,
    functionName: args.functionName,
    args: args.callArgs,
  });
  const txHash = await client.writeContract(
    fees
      ? {
          ...writeArgs,
          fees: fees as Parameters<LeashClient["writeContract"]>[0]["fees"],
        }
      : writeArgs
  );

  const receipt = (await client.waitForTransactionReceipt({
    hash: txHash,
    waitUntil: "finalized",
    interval: JURY_WAIT_INTERVAL_MS,
    retries: JURY_WAIT_RETRIES,
    fullTransaction: true,
  })) as Record<string, unknown>;

  const successful =
    typeof isSuccessful === "function"
      ? isSuccessful(receipt as Parameters<typeof isSuccessful>[0])
      : true;
  const status = receiptField(receipt, ["statusName", "status"]);
  const result = receiptField(receipt, ["resultName", "result"]);
  if (!successful) {
    const detail = leaderError(receipt) || `${status} / ${result}`;
    throw new Error(`GenLayer write failed: ${detail}`);
  }

  return {
    hash: txHash,
    status,
    result,
    successful,
    receipt,
  };
}
