/**
 * Interactive LEASH CLI — arbitrary mandates and amounts
 *
 * Deploys a fresh LEASH instance, registers an agent with your custom
 * mandate + spend cap, then Continue-or-Revoke based on whether the
 * requested next spend fits the remaining cap.
 *
 * Run:
 *   npx hardhat run studio_cases/interactive_test.js
 *
 * Against GenLayer Studio:
 *   npx hardhat run studio_cases/interactive_test.js --network genlayer_studio
 */
const fs = require("fs");
const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const hre = require("hardhat");
const { ethers } = hre;
const {
  USD,
  usd,
  Verdict,
  VERDICT_NAME,
  banner,
  castJury,
  printAgentState,
} = require("./lib");

function txOverrides() {
  return hre.network.name === "genlayer_studio"
    ? { gasLimit: 8_000_000, gasPrice: 0n, type: 0 }
    : {};
}

async function ask(rl, question) {
  const answer = await rl.question(question);
  return String(answer ?? "").trim();
}

async function askNonEmpty(rl, question) {
  for (;;) {
    const value = await ask(rl, question);
    if (value) return value;
    console.log("  (value cannot be empty — try again)");
  }
}

function parseUsd(raw, { allowZero } = { allowZero: false }) {
  const cleaned = String(raw).trim().replace(/[$,\s]/g, "");
  if (cleaned === "") {
    throw new Error("empty");
  }
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    throw new Error("not a number");
  }
  if (n < 0) {
    throw new Error("must be >= 0");
  }
  if (!allowZero && n === 0) {
    throw new Error("must be greater than 0");
  }
  return n;
}

async function askUsd(rl, question, options) {
  for (;;) {
    const raw = await ask(rl, question);
    try {
      return parseUsd(raw, options);
    } catch (error) {
      console.log(`  (invalid amount: ${error.message} — try again, e.g. 5000)`);
    }
  }
}

function printIntro() {
  banner("LEASH INTERACTIVE TEST");
  console.log("Pitch: live mandate jury, not an escrow.");
  console.log("Anyone can drive LEASH with a custom mandate and arbitrary amounts.");
  console.log("Question the jury answers: is this still the job I was allowed to do?");
  console.log("");
}

async function collectInputsInteractive() {
  const rl = readline.createInterface({ input, output });
  try {
    const mandate = await askNonEmpty(
      rl,
      "Enter custom mandate (e.g. 'Rent AI GPU cluster for 1 month'): "
    );
    const spendCapUsd = await askUsd(
      rl,
      "Enter total spend cap in USD (e.g. 5000): ",
      { allowZero: false }
    );
    const action = await askNonEmpty(
      rl,
      "Enter agent action description (e.g. 'Booked 8x H100 instances'): "
    );
    const nextSpendUsd = await askUsd(
      rl,
      "Enter next spend amount requested in USD (e.g. 3200): ",
      { allowZero: true }
    );
    return { mandate, spendCapUsd, action, nextSpendUsd };
  } finally {
    rl.close();
  }
}

function readStdinLines() {
  const raw = fs.readFileSync(0, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function collectInputsFromLines(lines) {
  if (lines.length < 4) {
    throw new Error(
      `Expected 4 answers (mandate, spend cap, action, next spend) but received ${lines.length}. ` +
        `Run in a terminal: npx hardhat run studio_cases/interactive_test.js`
    );
  }
  const mandate = lines[0];
  const spendCapUsd = parseUsd(lines[1], { allowZero: false });
  const action = lines[2];
  const nextSpendUsd = parseUsd(lines[3], { allowZero: true });
  console.log("Enter custom mandate (e.g. 'Rent AI GPU cluster for 1 month'): " + mandate);
  console.log("Enter total spend cap in USD (e.g. 5000): " + spendCapUsd);
  console.log("Enter agent action description (e.g. 'Booked 8x H100 instances'): " + action);
  console.log("Enter next spend amount requested in USD (e.g. 3200): " + nextSpendUsd);
  return { mandate, spendCapUsd, action, nextSpendUsd };
}

async function collectInputs() {
  printIntro();
  if (process.stdin.isTTY) {
    return collectInputsInteractive();
  }
  return collectInputsFromLines(readStdinLines());
}

async function deployFreshLeash() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No signer available. For --network genlayer_studio, set PRIVATE_KEY in .env."
    );
  }

  const overrides = txOverrides();
  const network = await ethers.provider.getNetwork();

  console.log("\nDeploying a fresh LEASH instance...");
  console.log("  network: ", hre.network.name);
  console.log("  chainId: ", network.chainId.toString());
  console.log("  deployer:", deployer.address);

  const MockManager = await ethers.getContractFactory("MockERC7710DelegationManager");
  const mockManager = await MockManager.deploy(overrides);
  await mockManager.waitForDeployment();

  const LEASH = await ethers.getContractFactory("LEASH");
  const leash = await LEASH.deploy(deployer.address, 1, overrides);
  await leash.waitForDeployment();

  await (await leash.addValidator(deployer.address, overrides)).wait();
  await (await leash.setGenLayerRelayer(deployer.address, overrides)).wait();

  const leashAddress = await leash.getAddress();
  const managerAddress = await mockManager.getAddress();
  console.log("  LEASH:   ", leashAddress);
  console.log("  ERC-7710:", managerAddress);

  return { leash, mockManager, deployer, leashAddress, managerAddress };
}

async function registerCustomAgent(leash, mockManager, deployer, mandate, spendCapWei) {
  const overrides = txOverrides();
  const agentWallet = new ethers.Wallet(ethers.Wallet.createRandom().privateKey, ethers.provider);

  const fundAmount =
    hre.network.name === "genlayer_studio" ? ethers.parseEther("0.05") : ethers.parseEther("1");
  const fundTx = await deployer.sendTransaction({
    to: agentWallet.address,
    value: fundAmount,
    ...overrides,
  });
  await fundTx.wait();

  const latest = await ethers.provider.getBlock("latest");
  const expiresAt = BigInt(latest.timestamp) + 7n * 24n * 60n * 60n;
  const delegationHash = ethers.id(`leash-interactive-${Date.now()}`);
  const managerAddress = await mockManager.getAddress();

  const registerTx = await leash.registerAgent(
    agentWallet.address,
    mandate,
    ethers.id(mandate),
    spendCapWei,
    expiresAt,
    delegationHash,
    managerAddress,
    overrides
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

  console.log("\nAgent registered");
  console.log("  mandate:    ", mandate);
  console.log("  principal:  ", deployer.address, "(jury / GenLayer validator)");
  console.log("  agent wallet:", agentWallet.address);
  console.log("  agent id:   ", agentId.toString());
  console.log("  spend cap:  ", usd(spendCapWei));
  console.log("  delegation: ", delegationHash);

  return { agentWallet, agentId, delegationHash };
}

async function submitCustomPacket(leash, agentWallet, agentId, mandate, action, nextSpendAmount) {
  const overrides = txOverrides();
  const receipts = `action=${action}; next_spend_usd=${ethers.formatEther(nextSpendAmount)}`;
  const tx = await leash
    .connect(agentWallet)
    .submitAction(
      agentId,
      mandate,
      action,
      receipts,
      nextSpendAmount,
      ethers.ZeroAddress,
      overrides
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
  console.log("  submissionId:", submissionId.toString());
  console.log("  action:      ", action);
  console.log("  receipts:    ", receipts);
  console.log("  nextSpend:   ", usd(nextSpendAmount));

  const gate = await leash.canProceed(agentId, nextSpendAmount);
  console.log("  canProceed:  ", gate.authorized, gate.reason ? `(${gate.reason})` : "");
  return submissionId;
}

async function expectPausedSubmit(leash, agentWallet, agentId, mandate) {
  const overrides = txOverrides();
  try {
    await leash
      .connect(agentWallet)
      .submitAction(agentId, mandate, "retry after revoke", "none", 1n, ethers.ZeroAddress, overrides);
    throw new Error("Agent was able to submit after Revoke — kill switch failed");
  } catch (error) {
    const message = `${error.shortMessage || ""} ${error.message || ""}`;
    if (!message.includes("AgentPaused")) {
      throw error;
    }
    console.log("Further agent submit reverted with AgentPaused (kill switch holds).");
    return true;
  }
}

function printSummary(rows) {
  const line = "─".repeat(72);
  const width = 22;
  console.log(`\n${line}`);
  console.log("  DYNAMIC ON-CHAIN STATE");
  console.log(line);
  for (const [label, value] of rows) {
    console.log(`  ${label.padEnd(width)} ${value}`);
  }
  console.log(line);
}

async function main() {
  const { mandate, spendCapUsd, action, nextSpendUsd } = await collectInputs();
  const spendCapWei = USD(spendCapUsd);
  const nextSpendWei = USD(nextSpendUsd);
  const overCap = nextSpendWei > spendCapWei;

  console.log("\nInputs captured");
  console.log("  mandate:   ", mandate);
  console.log("  spendCap:  ", `$${spendCapUsd}`);
  console.log("  action:    ", action);
  console.log("  nextSpend: ", `$${nextSpendUsd}`);
  console.log(
    "  rule:      ",
    overCap
      ? "nextSpend > spendCap → jury will Revoke (ERC-7710 kill switch)"
      : "nextSpend <= spendCap → jury will Continue (approve + deduct)"
  );

  const { leash, mockManager, deployer, leashAddress, managerAddress } =
    await deployFreshLeash();
  const { agentWallet, agentId, delegationHash } = await registerCustomAgent(
    leash,
    mockManager,
    deployer,
    mandate,
    spendCapWei
  );

  const submissionId = await submitCustomPacket(
    leash,
    agentWallet,
    agentId,
    mandate,
    action,
    nextSpendWei
  );

  const beforeDisabled = await mockManager.disabled(delegationHash);
  let remainingCap = spendCapWei;
  let subsequentReverted = false;

  if (overCap) {
    await castJury(
      leash,
      deployer,
      submissionId,
      Verdict.Revoke,
      0,
      `Over cap: requested ${usd(nextSpendWei)} exceeds spend cap ${usd(spendCapWei)}. Revoke the ERC-7710 delegation.`
    );

    const { agent, gate } = await printAgentState(leash, agentId, nextSpendWei);
    if (!agent.paused) {
      throw new Error("Expected agent to be paused after Revoke");
    }
    if (gate.authorized) {
      throw new Error("Expected canProceed=false after Revoke");
    }

    const afterDisabled = await mockManager.disabled(delegationHash);
    console.log("\nERC-7710 kill switch");
    console.log("  delegationHash: ", delegationHash);
    console.log("  disabled before:", beforeDisabled);
    console.log("  disabled after: ", afterDisabled);
    if (!afterDisabled) {
      throw new Error("Expected MockERC7710DelegationManager.disableDelegation to fire");
    }

    subsequentReverted = await expectPausedSubmit(leash, agentWallet, agentId, mandate);
    remainingCap = 0n;

    const finalAgent = await leash.getAgent(agentId);
    const finalGate = await leash.canProceed(agentId, nextSpendWei);
    printSummary([
      ["Network", hre.network.name],
      ["LEASH", leashAddress],
      ["ERC-7710 manager", managerAddress],
      ["Agent id", agentId.toString()],
      ["Agent wallet", agentWallet.address],
      ["Mandate", mandate],
      ["Initial spend cap", `$${spendCapUsd}`],
      ["Action", action],
      ["Next spend requested", `$${nextSpendUsd}`],
      ["Jury verdict", VERDICT_NAME[Number(finalAgent.lastVerdict)]],
      ["Agent paused", String(finalAgent.paused)],
      ["Remaining cap", usd(finalAgent.spendCap)],
      ["canProceed", `${finalGate.authorized}${finalGate.reason ? ` (${finalGate.reason})` : ""}`],
      ["ERC-7710 disabled", String(afterDisabled)],
      ["Follow-up tx", subsequentReverted ? "reverted AgentPaused" : "UNEXPECTED SUCCESS"],
    ]);
    console.log("RESULT: Revoke — ERC-7710 kill switch fired. Agent frozen.");
    console.log("The second transaction does not leave the wallet.");
  } else {
    await castJury(
      leash,
      deployer,
      submissionId,
      Verdict.Continue,
      0,
      `In cap: requested ${usd(nextSpendWei)} <= spend cap ${usd(spendCapWei)}. Continue.`
    );

    const { gate } = await printAgentState(leash, agentId, nextSpendWei);
    if (!gate.authorized) {
      throw new Error("Expected canProceed=true after Continue");
    }

    const spendTx = await leash
      .connect(agentWallet)
      .reportSpendExecuted(agentId, nextSpendWei, txOverrides());
    await spendTx.wait();

    const afterSpend = await leash.getAgent(agentId);
    remainingCap = afterSpend.spendCap;
    console.log("\nSpend approved and deducted on-chain.");
    console.log("  spent:         ", usd(nextSpendWei));
    console.log("  remaining cap: ", usd(remainingCap));

    const finalGate = await leash.canProceed(agentId, nextSpendWei);
    const afterDisabled = await mockManager.disabled(delegationHash);
    printSummary([
      ["Network", hre.network.name],
      ["LEASH", leashAddress],
      ["ERC-7710 manager", managerAddress],
      ["Agent id", agentId.toString()],
      ["Agent wallet", agentWallet.address],
      ["Mandate", mandate],
      ["Initial spend cap", `$${spendCapUsd}`],
      ["Action", action],
      ["Next spend requested", `$${nextSpendUsd}`],
      ["Jury verdict", VERDICT_NAME[Number(afterSpend.lastVerdict)]],
      ["Agent paused", String(afterSpend.paused)],
      ["Approved next spend", usd(afterSpend.approvedNextSpend)],
      ["Remaining cap", usd(remainingCap)],
      ["canProceed now", `${finalGate.authorized}${finalGate.reason ? ` (${finalGate.reason})` : ""}`],
      ["ERC-7710 disabled", String(afterDisabled)],
    ]);
    console.log(`RESULT: Continue — spend approved and deducted. Remaining cap: ${usd(remainingCap)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
