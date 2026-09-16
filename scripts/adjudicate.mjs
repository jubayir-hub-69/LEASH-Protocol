import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createAccount, createClient, isSuccessful } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const ADDRESSES_PATH = path.join(ROOT, "deployed_addresses.json");
const STUDIO_NEXT_RPC = "https://studio-next.genlayer.com/api";

const CASE =
  process.argv[2] === "overspend"
    ? {
        id: "overspend",
        action:
          "Book first-class JFK→LHR on BA-112 landing at 21:10 for $890 with lounge access.",
        spendAmount: 890,
        receipts:
          "airline=BA-112; fare_usd=890; arrival_local=21:10; cabin=first; extras=lounge",
      }
    : {
        id: "in-mandate",
        action:
          "Book economy SFO→JFK on Flight LE-441 landing at 17:40 local. Fare $186. No extras.",
        spendAmount: 186,
        receipts:
          "airline=LE-441; fare_usd=186; arrival_local=17:40; cabin=economy; extras=none; status=ticketed",
      };

function jsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}

function loadPrivateKey() {
  const key = (process.env.PRIVATE_KEY || "").trim();
  if (!key) {
    throw new Error("PRIVATE_KEY is missing from .env");
  }
  return key.startsWith("0x") ? key : `0x${key}`;
}

function loadAddress() {
  const fromEnv = (process.env.CONTRACT_ADDRESS || "").trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(fromEnv)) return fromEnv;
  const saved = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));
  const address = saved.LEASH || saved.contractAddress || saved.leashPy;
  if (!address) throw new Error("No contract address in deployed_addresses.json");
  return address;
}

function asRecord(value) {
  if (value instanceof Map) return Object.fromEntries(value.entries());
  if (value && typeof value === "object") return value;
  return {};
}

async function quoteFees(client, writeArgs) {
  if (typeof client.estimateTransactionFeesForWrite === "function") {
    try {
      const estimate = await client.estimateTransactionFeesForWrite(writeArgs);
      const enabled = estimate?.policy?.enabled !== false;
      const feeValue = estimate?.feeValue;
      const gasless =
        estimate?.gasless === true ||
        feeValue === 0n ||
        feeValue === 0 ||
        feeValue === undefined;
      if (enabled && !gasless && estimate?.distribution) {
        return { distribution: estimate.distribution, feeValue };
      }
    } catch (err) {
      console.log("Write fee estimate skipped:", err.message || err);
    }
  }
  if (typeof client.estimateTransactionFees === "function") {
    try {
      const estimate = await client.estimateTransactionFees();
      const enabled = estimate?.policy?.enabled !== false;
      const feeValue = estimate?.feeValue;
      const gasless =
        estimate?.gasless === true ||
        feeValue === 0n ||
        feeValue === 0 ||
        feeValue === undefined;
      if (enabled && !gasless && estimate?.distribution) {
        return { distribution: estimate.distribution, feeValue };
      }
    } catch (err) {
      console.log("Generic fee estimate skipped:", err.message || err);
    }
  }
  return undefined;
}

async function main() {
  const account = createAccount(loadPrivateKey());
  const chain = {
    ...studioDevnet,
    id: 61997,
    name: "studio_next",
    rpcUrls: {
      ...studioDevnet.rpcUrls,
      default: { http: [STUDIO_NEXT_RPC] },
    },
  };
  const client = createClient({
    chain,
    account,
    endpoint: STUDIO_NEXT_RPC,
  });
  const address = loadAddress();

  console.log("Seeding mandate jury on studio_next");
  console.log("  account:", account.address);
  console.log("  contract:", address);
  console.log("  case:    ", CASE.id);
  console.log("  action:  ", CASE.action);
  console.log("  spend:   ", CASE.spendAmount);

  const schema = await client.getContractSchema(address);
  console.log("  methods: ", Object.keys(schema?.methods || {}));
  if (!schema?.methods?.adjudicate) {
    throw new Error(
      "Deployed contract has no adjudicate() method. Redeploy genlayer-studio/leash.py first."
    );
  }

  const before = await client.readContract({
    address,
    functionName: "get_state",
    args: [],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  console.log("  before:  ", jsonSafe(before));

  const writeArgs = {
    account,
    address,
    functionName: "adjudicate",
    args: [CASE.action, CASE.spendAmount, CASE.receipts],
  };
  const fees = await quoteFees(client, {
    address,
    functionName: "adjudicate",
    args: writeArgs.args,
  });
  if (fees) writeArgs.fees = fees;

  const txHash = await client.writeContract(writeArgs);
  console.log("  tx:      ", txHash);
  console.log("  waiting for validator consensus (this can take a few minutes)...");

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    waitUntil: "finalized",
    interval: 3000,
    retries: 120,
    fullTransaction: true,
  });

  if (typeof isSuccessful === "function" && !isSuccessful(receipt)) {
    const consensus = asRecord(receipt.consensus_data || receipt.consensusData);
    const leader = consensus.leader_receipt || consensus.leaderReceipt;
    const one = Array.isArray(leader) ? leader[0] : leader;
    console.error("Jury execution failed:");
    console.error(jsonSafe(one || receipt));
    throw new Error("adjudicate() did not succeed");
  }

  const after = await client.readContract({
    address,
    functionName: "get_state",
    args: [],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });

  const saved = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));
  saved.lastJury = {
    caseId: CASE.id,
    txHash,
    status: receipt.statusName || receipt.status,
    result: receipt.resultName || receipt.result,
    state: jsonSafe(after),
    seededAt: new Date().toISOString(),
  };
  fs.writeFileSync(ADDRESSES_PATH, JSON.stringify(saved, null, 2) + "\n");

  console.log("  status:  ", receipt.statusName || receipt.status);
  console.log("  result:  ", receipt.resultName || receipt.result);
  console.log("  after:   ", jsonSafe(after));
  console.log("\nValidator-decided verdict is now on-chain and was read back.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
