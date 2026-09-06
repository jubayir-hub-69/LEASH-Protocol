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

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  console.log("Deploying LEASH with account:", deployer.address);
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", network.chainId.toString());
  console.log(
    "Account balance:",
    hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)),
    "ETH"
  );

  // Studio's eth_estimateGas accepts only the tx object (no block tag).
  // Pin gas so ethers skips estimation on that RPC.
  const txOverrides =
    hre.network.name === "genlayer_studio"
      ? { gasLimit: 8_000_000, gasPrice: 0n, type: 0 }
      : {};

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
