import { createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";
import { CHAIN_ID, STUDIO_NEXT_RPC } from "./config";

type HexAddress = `0x${string}`;

export type LeashOnChainState = {
  mandate: string;
  spendCap: bigint;
  deadline: bigint;
};

export function createLeashClient() {
  const chain = {
    ...studioDevnet,
    id: CHAIN_ID,
    name: "studio_next",
    rpcUrls: {
      ...studioDevnet.rpcUrls,
      default: { http: [STUDIO_NEXT_RPC] as const },
    },
  };

  return createClient({
    chain,
    endpoint: STUDIO_NEXT_RPC,
  });
}

export async function readLeashStorage(
  client: ReturnType<typeof createLeashClient>,
  address: HexAddress
): Promise<LeashOnChainState> {
  const previousError = console.error;
  console.error = (...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      (args[0].includes("GenLayer RPC error (gen_call)") ||
        args[0].includes("GenLayer RPC error (eth_blockNumber)"))
    ) {
      return;
    }
    previousError(...args);
  };

  try {
    await client.readContract({
      address,
      functionName: "mandate",
      args: [],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    });
  } catch (error) {
    const slots = extractContractState(error);
    if (slots) return decodeLeashStorage(slots);
    throw error;
  } finally {
    console.error = previousError;
  }

  throw new Error(
    "Studio Next returned a view result for mandate; expected storage-only gen_call state."
  );
}

function extractContractState(
  error: unknown
): Record<string, string> | null {
  const seen = new Set<unknown>();

  const walk = (value: unknown): Record<string, string> | null => {
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    const rec = value as Record<string, unknown>;

    if (rec.contract_state && typeof rec.contract_state === "object") {
      return rec.contract_state as Record<string, string>;
    }

    if (typeof rec.data === "string") {
      try {
        const parsed = JSON.parse(rec.data) as unknown;
        const nested = walk(parsed);
        if (nested) return nested;
      } catch {
        // data is not JSON
      }
    }

    for (const nested of [rec.data, rec.cause, rec.error, rec.receipt, rec.info]) {
      const found = walk(nested);
      if (found) return found;
    }
    return null;
  };

  return walk(error);
}

function readU256LE(bytes: Uint8Array): bigint {
  let value = BigInt(0);
  const width = Math.min(bytes.length, 32);
  for (let i = 0; i < width; i++) {
    value |= BigInt(bytes[i] ?? 0) << (BigInt(8) * BigInt(i));
  }
  return value;
}

function slotText(buf: Buffer): string {
  return buf.toString("utf8").replace(/\0+$/g, "").trim();
}

function isSourceSlot(text: string): boolean {
  return /class Contract|py-genlayer|import genlayer/.test(text);
}

function isPrintableMandate(text: string): boolean {
  return (
    text.length > 0 &&
    /^[\x20-\x7e]+$/.test(text) &&
    /[a-zA-Z]/.test(text) &&
    !isSourceSlot(text)
  );
}

export function decodeLeashStorage(
  contractState: Record<string, string>
): LeashOnChainState {
  const slots = Object.values(contractState).map((value) =>
    Buffer.from(value, "base64")
  );

  const strings = slots
    .map(slotText)
    .filter((text) => isPrintableMandate(text));

  for (const buf of slots) {
    if (buf.length < 68) continue;
    const mandateLength = buf.readUInt32LE(0);
    if (mandateLength < 1 || mandateLength > 10_000) continue;

    const spendCap = readU256LE(buf.subarray(4, 36));
    const deadline = readU256LE(buf.subarray(36, 68));
    const mandate = strings.find((text) => text.length === mandateLength);
    if (!mandate) continue;

    return { mandate, spendCap, deadline };
  }

  throw new Error(
    "Could not decode mandate, spend_cap, and deadline from Studio Next contract_state."
  );
}
