const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const { ethers } = hre;

/** Demo mapping: $1 = 1 native token unit so logs stay readable on-chain. */
const USD = (amount) => ethers.parseEther(String(amount));

const MANDATE = "spend at most $200 on a flight that lands before 6pm.";

const Verdict = {
  Continue: 0,
  Warn: 1,
  ConstrainCap: 2,
  Revoke: 3,
};

const VERDICT_NAME = ["Continue", "Warn", "ConstrainCap", "Revoke"];

const ADDRESSES_PATH = path.join(__dirname, "..", "deployed_addresses.json");

function usd(wei) {
  return `$${ethers.formatEther(wei)}`;
}

function banner(title) {
  const line = "=".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

async function getOrDeployLeash() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No signer available. Set a real PRIVATE_KEY in .env before using --network genlayer_studio."
    );
  }

  if (fs.existsSync(ADDRESSES_PATH)) {
    const saved = JSON.parse(fs.readFileSync(ADDRESSES_PATH, "utf8"));
    if (saved.LEASH && (await ethers.provider.getCode(saved.LEASH)) !== "0x") {
      const leash = await ethers.getContractAt("LEASH", saved.LEASH);
      const mockManager = saved.MockERC7710DelegationManager
        ? await ethers.getContractAt(
            "MockERC7710DelegationManager",
            saved.MockERC7710DelegationManager
          )
        : null;
      console.log("Using deployed LEASH at", saved.LEASH);
      return { leash, mockManager, deployer, saved };
    }
  }

  console.log("No live LEASH found — deploying a fresh instance...");

  const MockManager = await ethers.getContractFactory("MockERC7710DelegationManager");
  const mockManager = await MockManager.deploy();
  await mockManager.waitForDeployment();

  const LEASH = await ethers.getContractFactory("LEASH");
  const leash = await LEASH.deploy(deployer.address, 1);
  await leash.waitForDeployment();

  await (await leash.addValidator(deployer.address)).wait();
  await (await leash.setGenLayerRelayer(deployer.address)).wait();

  const saved = {
    network: hre.network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    LEASH: await leash.getAddress(),
    MockERC7710DelegationManager: await mockManager.getAddress(),
    verdictThreshold: 1,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(ADDRESSES_PATH, JSON.stringify(saved, null, 2) + "\n");
  console.log("Deployed LEASH at", saved.LEASH);
  console.log("Wrote", ADDRESSES_PATH);
  return { leash, mockManager, deployer, saved };
}

async function setupCase(caseId) {
  const { leash, mockManager, deployer } = await getOrDeployLeash();

  if (!(await leash.isValidator(deployer.address))) {
    await (await leash.addValidator(deployer.address)).wait();
  }

  const agentWallet = new ethers.Wallet(ethers.Wallet.createRandom().privateKey, ethers.provider);
  const fundTx = await deployer.sendTransaction({
    to: agentWallet.address,
    value: ethers.parseEther("0.05"),
  });
  await fundTx.wait();

  const latest = await ethers.provider.getBlock("latest");
  const expiresAt = BigInt(latest.timestamp) + 7n * 24n * 60n * 60n;
  const delegationHash = ethers.id(`leash-${caseId}-${Date.now()}`);
  const managerAddress = mockManager ? await mockManager.getAddress() : ethers.ZeroAddress;

  const registerTx = await leash.registerAgent(
    agentWallet.address,
    MANDATE,
    ethers.id(MANDATE),
    USD(200),
    expiresAt,
    delegationHash,
    managerAddress
  );
  const receipt = await registerTx.wait();

  let agentId;
  for (const log of receipt.logs) {
    try {
      const parsed = leash.interface.parseLog(log);
      if (parsed && parsed.name === "AgentRegistered") {
        agentId = parsed.args.agentId;
      }
    } catch {
      // ignore logs from other contracts
    }
  }
  if (agentId === undefined) {
    agentId = await leash.agentCount();
  }

  console.log("Mandate:     ", MANDATE);
  console.log("Principal:   ", deployer.address, "(jury / GenLayer validator)");
  console.log("Agent wallet:", agentWallet.address);
  console.log("Agent id:    ", agentId.toString());
  console.log("Spend cap:   ", usd(USD(200)));
  console.log("Delegation:  ", delegationHash);

  return {
    leash,
    mockManager,
    jury: deployer,
    agentWallet,
    agentId,
    delegationHash,
  };
}

async function submitPacket(leash, agentWallet, agentId, packet) {
  const tx = await leash
    .connect(agentWallet)
    .submitAction(
      agentId,
      MANDATE,
      packet.logs,
      packet.receipts,
      packet.nextSpendAmount,
      packet.nextTarget || ethers.ZeroAddress
    );
  const receipt = await tx.wait();

  let submissionId;
  for (const log of receipt.logs) {
    try {
      const parsed = leash.interface.parseLog(log);
      if (parsed && parsed.name === "ActionSubmitted") {
        submissionId = parsed.args.submissionId;
      }
    } catch {
      // ignore
    }
  }
  if (submissionId === undefined) {
    submissionId = await leash.submissionCount();
  }

  console.log("\nAgent submitted action");
  console.log("  submissionId:   ", submissionId.toString());
  console.log("  nextSpend:      ", usd(packet.nextSpendAmount));
  console.log("  logs:           ", packet.logs);
  console.log("  receipts:       ", packet.receipts);

  const gate = await leash.canProceed(agentId, packet.nextSpendAmount);
  console.log("  canProceed now: ", gate.authorized, gate.reason ? `(${gate.reason})` : "");
  return submissionId;
}

async function castJury(leash, jury, submissionId, verdict, newCap, reason) {
  console.log("\nGenLayer jury deliberating...");
  console.log('  question: "Is this still the job I was allowed to do?"');
  console.log("  proposed: ", VERDICT_NAME[verdict]);
  console.log("  reason:   ", reason);

  const tx = await leash.connect(jury).castVerdict(submissionId, verdict, newCap, reason);
  await tx.wait();

  const sub = await leash.getSubmission(submissionId);
  console.log("\nVerdict applied:", VERDICT_NAME[Number(sub.finalVerdict)]);
  console.log("  adjudicated:  ", sub.adjudicated);
  console.log("  finalReason:  ", sub.finalReason);
  return sub;
}

async function printAgentState(leash, agentId, amount) {
  const agent = await leash.getAgent(agentId);
  const gate = await leash.canProceed(agentId, amount);
  console.log("\nAgent state after verdict");
  console.log("  paused:            ", agent.paused);
  console.log("  awaitingVerdict:   ", agent.awaitingVerdict);
  console.log("  lastVerdict:       ", VERDICT_NAME[Number(agent.lastVerdict)]);
  console.log("  warningCount:      ", agent.warningCount.toString());
  console.log("  spendCap:          ", usd(agent.spendCap));
  console.log("  approvedNextSpend: ", usd(agent.approvedNextSpend));
  console.log("  canProceed:        ", gate.authorized, gate.reason ? `(${gate.reason})` : "");
  return { agent, gate };
}

module.exports = {
  MANDATE,
  USD,
  usd,
  Verdict,
  VERDICT_NAME,
  banner,
  setupCase,
  submitPacket,
  castJury,
  printAgentState,
};
