import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CONTRACT_PATH = path.join(ROOT, "leash.py");
const ADDRESSES_PATH = path.join(ROOT, "deployed_addresses.json");

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

function extractAddress(receipt) {
  const decoded = receipt?.txDataDecoded || {};
  return (
    decoded.contractAddress ||
    receipt?.recipient ||
    receipt?.to_address ||
    receipt?.data?.contract_address ||
    null
  );
}

async function main() {
  const account = createAccount(loadPrivateKey());
  const client = createClient({
    chain: studionet,
    account,
  });

  const code = fs.readFileSync(CONTRACT_PATH, "utf8");
  const mandate = "spend at most $200 on a flight that lands before 6pm.";
  const spendCap = 200;
  const deadline = 0;

  console.log("Deploying leash.py to GenLayer Studio");
  console.log("  account:", account.address);
  console.log("  rpc:    ", studionet.rpcUrls.default.http[0]);
  console.log("  kwargs: ", { mandate, spend_cap: spendCap, deadline });

  const txHash = await client.deployContract({
    account,
    code,
    kwargs: { mandate, spend_cap: spendCap, deadline },
    leaderOnly: true,
  });
  console.log("  tx:     ", txHash);

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.FINALIZED,
    interval: 2000,
    retries: 90,
  });

  const contractAddress = extractAddress(receipt);
  console.log("  status: ", receipt.statusName || receipt.status);
  console.log("  result: ", receipt.resultName || receipt.result);
  console.log("  exec:   ", receipt.txExecutionResultName || receipt.txExecutionResult);
  console.log("  address:", contractAddress);

  const existing = fs.existsSync(ADDRESSES_PATH)
    ? JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"))
    : {};

  const updated = {
    ...existing,
    genlayerStudio: {
      network: "genlayer_studio",
      chainId: studionet.id,
      rpc: studionet.rpcUrls.default.http[0],
      deployer: account.address,
      leashPy: contractAddress,
      deployTx: txHash,
      constructorArgs: { mandate, spendCap, deadline },
      status: receipt.statusName || receipt.status,
      result: receipt.resultName || receipt.result,
      deployedAt: new Date().toISOString(),
    },
  };

  fs.writeFileSync(ADDRESSES_PATH, JSON.stringify(updated, null, 2) + "\n");
  console.log("Wrote", ADDRESSES_PATH);

  if (!contractAddress) {
    console.log("Receipt dump:", jsonSafe(receipt));
    throw new Error("Studio deploy finalized without a contract address");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
