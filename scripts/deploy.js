const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const README_SECTION_START = "<!-- DEPLOYED_ADDRESSES_START -->";
const README_SECTION_END = "<!-- DEPLOYED_ADDRESSES_END -->";

function writeDeployedAddresses(info) {
  const outputPath = path.join(__dirname, "..", "deployed_addresses.json");
  fs.writeFileSync(outputPath, JSON.stringify(info, null, 2) + "\n");
  console.log("Wrote deployed address file:", outputPath);
}

function formatReadmeSection(rows) {
  const header = [
    README_SECTION_START,
    "## Deployed Addresses",
    "",
    "| Network | Chain ID | Contract | Address | Timestamp |",
    "| --- | ---: | --- | --- | --- |",
  ];
  const body = rows.map(
    (row) =>
      `| ${row.network} | ${row.chainId} | LEASH | \`${row.address}\` | ${row.timestamp} |`
  );
  return [...header, ...body, README_SECTION_END].join("\n");
}

function parseExistingReadmeRows(section) {
  const rows = [];
  const lineRe =
    /^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*LEASH\s*\|\s*`?(0x[a-fA-F0-9]{40})`?\s*\|\s*([^|]+?)\s*\|$/;
  for (const line of section.split("\n")) {
    const match = line.trim().match(lineRe);
    if (match) {
      rows.push({
        network: match[1].trim(),
        chainId: match[2].trim(),
        address: match[3].trim(),
        timestamp: match[4].trim(),
      });
    }
  }
  return rows;
}

function updateReadme(info) {
  const readmePath = path.join(__dirname, "..", "README.md");
  let readme = fs.readFileSync(readmePath, "utf8");
  const newRow = {
    network: info.network,
    chainId: String(info.chainId),
    address: info.LEASH,
    timestamp: info.timestamp,
  };

  const start = readme.indexOf(README_SECTION_START);
  const end = readme.indexOf(README_SECTION_END);

  let rows = [];
  if (start !== -1 && end !== -1 && end > start) {
    const existing = readme.slice(start, end + README_SECTION_END.length);
    rows = parseExistingReadmeRows(existing);
    const idx = rows.findIndex((row) => row.network === newRow.network);
    if (idx >= 0) {
      rows[idx] = newRow;
    } else {
      rows.push(newRow);
    }
    const section = formatReadmeSection(rows);
    readme =
      readme.slice(0, start) +
      section +
      readme.slice(end + README_SECTION_END.length);
  } else {
    rows = [newRow];
    const section = `\n${formatReadmeSection(rows)}\n`;
    if (!readme.endsWith("\n")) {
      readme += "\n";
    }
    readme += section;
  }

  fs.writeFileSync(readmePath, readme.endsWith("\n") ? readme : `${readme}\n`);
  console.log("Updated README.md with LEASH address:", info.LEASH);
}

const STUDIO_NETWORKS = new Set(["genlayer_studio", "studio_next"]);

function isStudioNetwork(name) {
  return STUDIO_NETWORKS.has(name);
}

function studioTxOverrides() {
  // Studio eth_estimateGas accepts only the tx object (no block tag).
  // Pin gas + force legacy type-0 so Hardhat/ethers skip estimation and
  // do not attach EIP-1559 fields this RPC rejects.
  return { gasLimit: 8_000_000, gasPrice: 0n, type: 0 };
}

function trimStudioRpcParams(method, params) {
  if (!Array.isArray(params)) {
    return params;
  }
  if (method === "eth_estimateGas" && params.length > 1) {
    return params.slice(0, 1);
  }
  return params;
}

function patchStudioRpc(provider) {
  if (!provider || provider.__leashStudioPatched) {
    return;
  }
  provider.__leashStudioPatched = true;

  if (typeof provider.request === "function") {
    const originalRequest = provider.request.bind(provider);
    provider.request = (args) =>
      originalRequest({
        ...args,
        params: trimStudioRpcParams(args.method, args.params),
      });
  }

  if (typeof provider.send === "function") {
    const originalSend = provider.send.bind(provider);
    provider.send = (method, params, ...rest) =>
      originalSend(method, trimStudioRpcParams(method, params), ...rest);
  }
}

async function readNativeBalance(provider, address) {
  try {
    const raw = await provider.send("eth_getBalance", [address.toLowerCase()]);
    return BigInt(raw);
  } catch {
    return provider.getBalance(address);
  }
}

const STUDIO_NEXT_RPC = "https://studio-next.genlayer.com/api";
const LEASH_PY_PATH = path.join(__dirname, "..", "genlayer-studio", "leash.py");
const DEFAULT_MANDATE = "spend at most $200 on a flight that lands before 6pm.";

function loadPrivateKey() {
  const key = (process.env.PRIVATE_KEY || "").trim();
  if (!key) {
    throw new Error("PRIVATE_KEY is missing from .env");
  }
  return key.startsWith("0x") ? key : `0x${key}`;
}

function extractIcAddress(receipt) {
  const decoded = receipt?.txDataDecoded || {};
  return (
    decoded.contractAddress ||
    receipt?.recipient ||
    receipt?.to_address ||
    receipt?.data?.contract_address ||
    null
  );
}

function jsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}

function loadExistingAddresses() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "deployed_addresses.json"), "utf8")
    );
  } catch {
    return {};
  }
}

async function quoteStudioFees(client) {
  if (typeof client.estimateTransactionFees !== "function") {
    return undefined;
  }
  try {
    const estimate = await client.estimateTransactionFees();
    const enabled = estimate?.policy?.enabled !== false;
    const feeValue = estimate?.feeValue;
    const gasless =
      estimate?.gasless === true ||
      feeValue === 0n ||
      feeValue === 0 ||
      feeValue === undefined;
    if (!enabled || gasless || !estimate?.distribution) {
      console.log("Studio fee policy is gasless — submitting without fee params.");
      return undefined;
    }
    console.log("Quoted Studio Next protocol fee:", String(feeValue), "wei");
    return {
      distribution: estimate.distribution,
      feeValue,
    };
  } catch (err) {
    console.log(
      "Fee estimate unavailable, deploying without fee params:",
      err.message || err
    );
    return undefined;
  }
}

async function deployStudioNextIntelligentContract() {
  const { createAccount, createClient, isSuccessful } = await import("genlayer-js");
  const { studioDevnet, studionet } = await import("genlayer-js/chains");

  const rpc =
    (hre.network.config && hre.network.config.url) || STUDIO_NEXT_RPC;
  const baseChain = studioDevnet || studionet;
  const chain = {
    ...baseChain,
    id: 61997,
    name: "studio_next",
    rpcUrls: {
      ...baseChain.rpcUrls,
      default: { http: [rpc] },
    },
  };

  const account = createAccount(loadPrivateKey());
  const client = createClient({
    chain,
    account,
    endpoint: rpc,
  });

  // Official deploy scripts pass source as bytes, not a JS string.
  const code = new Uint8Array(fs.readFileSync(LEASH_PY_PATH));
  const mandate = DEFAULT_MANDATE;
  // Constructor: __init__(mandate: str, spend_cap: int, deadline: int)
  // genlayer-js encodes Number integers as calldata ints. Do not stringify.
  const spendCap = 200;
  const deadline = 0;

  console.log("Deploying leash.py Intelligent Contract via genlayer-js...");
  console.log("  account:", account.address);
  console.log("  rpc:    ", rpc);
  console.log("  chain:  ", 61997);
  console.log("  ctor:   ", {
    mandate,
    spend_cap: spendCap,
    deadline,
    types: {
      mandate: typeof mandate,
      spend_cap: typeof spendCap,
      deadline: typeof deadline,
    },
  });

  const deployArgs = {
    account,
    code,
    args: [mandate, spendCap, deadline],
  };
  const fees = await quoteStudioFees(client);
  if (fees) {
    deployArgs.fees = fees;
  }

  const txHash = await client.deployContract(deployArgs);
  console.log("  tx:     ", txHash);

  const waitOpts = { hash: txHash, interval: 2000, retries: 90, fullTransaction: true };
  const receipt =
    typeof client.waitForFinalization === "function"
      ? await client.waitForFinalization(waitOpts)
      : await client.waitForTransactionReceipt({
          ...waitOpts,
          status: "FINALIZED",
        });

  if (typeof isSuccessful === "function" && !isSuccessful(receipt)) {
    const leader =
      receipt?.consensus_data?.leader_receipt ||
      receipt?.consensus_data?.leaderReceipt ||
      {};
    const leaderOne = Array.isArray(leader) ? leader[0] : leader;
    console.error("GenVM execution error:");
    console.error("  status:", receipt.statusName || receipt.status);
    console.error("  exec:  ", receipt.txExecutionResultName || receipt.txExecutionResult);
    console.error("  error: ", leaderOne.error || leaderOne.stderr || leaderOne.result);
    console.error("  stdout:", leaderOne.stdout);
    console.error("  receipt dump:", jsonSafe(receipt));
    throw new Error(
      `Deployment failed: ${receipt.statusName || receipt.status} / ${
        receipt.txExecutionResultName || receipt.txExecutionResult
      }`
    );
  }

  const contractAddress = extractIcAddress(receipt);
  console.log("  status: ", receipt.statusName || receipt.status);
  console.log("  result: ", receipt.resultName || receipt.result);
  console.log("  exec:   ", receipt.txExecutionResultName || receipt.txExecutionResult);
  console.log("  address:", contractAddress);

  if (!contractAddress) {
    console.log("Receipt dump:", jsonSafe(receipt));
    throw new Error("Studio Next deploy finalized without a contract address");
  }

  try {
    const schema = await client.getContractSchema(contractAddress);
    const methods = Object.keys(schema?.methods || {});
    console.log("  schema methods:", methods.join(", ") || "(none)");
    if (!methods.includes("adjudicate") || !methods.includes("get_state")) {
      throw new Error(
        "Deployed schema is missing adjudicate/get_state. This is a constructor-only contract."
      );
    }
  } catch (err) {
    if (String(err.message || err).includes("constructor-only")) throw err;
    console.log("  schema read skipped:", err.message || err);
  }

  const timestamp = new Date().toISOString();
  const existing = loadExistingAddresses();
  const deployedAddresses = {
    network: "studio_next",
    chainId: 61997,
    rpc,
    contract: "leash.py",
    contractAddress,
    LEASH: contractAddress,
    leashPy: contractAddress,
    deployer: account.address,
    deployTx: txHash,
    constructorArgs: { mandate, spend_cap: spendCap, deadline },
    status: receipt.statusName || receipt.status,
    result: receipt.resultName || receipt.result,
    timestamp,
    deployedAt: timestamp,
    features: [
      "adjudicate() GenLayer LLM mandate jury (eq_principle.prompt_comparative)",
      "validator-agreed verdict writes last_verdict, spend_cap, kill_switch",
      "get_state / get_last_verdict / can_proceed view API for the dashboard",
      "emergency_freeze / appeal_and_unfreeze owner path",
      "dynamic threat score; kill switch at threat_threshold (default 10)",
    ],
  };
  if (existing.genlayerStudio) {
    deployedAddresses.genlayerStudio = existing.genlayerStudio;
  }

  writeDeployedAddresses(deployedAddresses);
  updateReadme(deployedAddresses);

  console.log("\nDeployment complete.");
  console.log(JSON.stringify(jsonSafe(deployedAddresses), null, 2));
}

async function main() {
  if (hre.network.name === "studio_next") {
    await deployStudioNextIntelligentContract();
    return;
  }

  if (isStudioNetwork(hre.network.name)) {
    patchStudioRpc(hre.network.provider);
    if (hre.ethers.provider._hardhatProvider) {
      patchStudioRpc(hre.ethers.provider._hardhatProvider);
    }
  }

  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const onStudio = isStudioNetwork(hre.network.name);

  console.log("Deploying LEASH with account:", deployer.address);
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log(
    "Account balance:",
    hre.ethers.formatEther(await readNativeBalance(hre.ethers.provider, deployer.address)),
    onStudio ? "GEN" : "ETH"
  );

  const txOverrides = onStudio ? studioTxOverrides() : {};

  const MockManager = await hre.ethers.getContractFactory(
    "MockERC7710DelegationManager"
  );
  const mockManager = await MockManager.deploy(txOverrides);
  await mockManager.waitForDeployment();
  const mockManagerAddress = await mockManager.getAddress();
  console.log("MockERC7710DelegationManager:", mockManagerAddress);

  // Single-validator threshold so a local / hackathon demo can finalize immediately.
  const verdictThreshold = 1;
  const LEASH = await hre.ethers.getContractFactory("LEASH");
  const leash = await LEASH.deploy(deployer.address, verdictThreshold, txOverrides);
  await leash.waitForDeployment();
  const leashAddress = await leash.getAddress();
  console.log("LEASH deployed to:", leashAddress);
  console.log("Deployed contract address:", leashAddress);

  const addValidatorTx = await leash.addValidator(deployer.address, txOverrides);
  await addValidatorTx.wait();

  const setRelayerTx = await leash.setGenLayerRelayer(deployer.address, txOverrides);
  await setRelayerTx.wait();

  const timestamp = new Date().toISOString();
  const existing = (() => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "deployed_addresses.json"), "utf8")
      );
    } catch {
      return {};
    }
  })();

  const deployedAddresses = {
    network: hre.network.name,
    chainId: Number(network.chainId),
    contractAddress: leashAddress,
    LEASH: leashAddress,
    deployer: deployer.address,
    MockERC7710DelegationManager: mockManagerAddress,
    verdictThreshold,
    threatThreshold: 10,
    timestamp,
    deployedAt: timestamp,
    features: [
      "emergencyFreeze / appealAndUnfreeze (owner bypass of the AI jury)",
      "time-bound mandate deadline with automatic kill switch",
      "milestone-based spendCap unlocking (UnlockMilestone verdict)",
      "strict destination allowlist + on-chain receipt extraction",
      "dynamic threat score; kill switch at threatThreshold (default 10)",
    ],
  };
  if (existing.genlayerStudio) {
    deployedAddresses.genlayerStudio = existing.genlayerStudio;
  }

  writeDeployedAddresses(deployedAddresses);
  updateReadme(deployedAddresses);

  console.log("Jury validator + GenLayer relayer:", deployer.address);
  console.log("Verdict threshold:", verdictThreshold);
  console.log("\nDeployment complete.");
  console.log(JSON.stringify(deployedAddresses, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
