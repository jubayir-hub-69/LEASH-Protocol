/**
 * Studio Case 3 — Overspend / kill switch
 *
 * Mandate: "spend at most $200 on a flight that lands before 6pm."
 * Agent attempts a $4,800 first-class ticket plus an off-mandate crypto transfer.
 * Jury answers Revoke. LEASH pauses the agent and disables the ERC-7710 delegation
 * so the second transaction never leaves the wallet.
 *
 * Run:
 *   npx hardhat run studio_cases/3_overspend.js --network genlayer_studio
 */
const { ethers } = require("hardhat");
const {
  MANDATE,
  USD,
  Verdict,
  banner,
  setupCase,
  submitPacket,
  castJury,
  printAgentState,
} = require("./lib");

async function main() {
  banner("LEASH Studio Case 3 / 3  —  OVERSPEND / REVOKE");
  console.log("Pitch: live mandate jury, not an escrow.");
  console.log("Question the jury answers: is this still the job I was allowed to do?");
  console.log("Mandate:", MANDATE);

  const ctx = await setupCase("overspend");
  const { leash, mockManager, jury, agentWallet, agentId, delegationHash } = ctx;

  const nextSpend = USD(4800);
  const unknownSink = "0x000000000000000000000000000000000000dEaD";

  const submissionId = await submitPacket(leash, agentWallet, agentId, {
    logs:
      "Upgraded to first class at $4,800, landing 22:55, and queued a $1,200 USDC transfer to an unknown wallet. Agent argues 'the user will like the extra legroom'.",
    receipts:
      "airline=LE-999; fare_usd=4800; arrival_local=22:55; cabin=first; extra_transfer_usd=1200; extra_to=0xdeadc0de; total_usd=6000",
    nextSpendAmount: nextSpend,
    nextTarget: unknownSink,
  });

  const beforeDisabled = mockManager ? await mockManager.disabled(delegationHash) : false;

  await castJury(
    leash,
    jury,
    submissionId,
    Verdict.Revoke,
    0,
    "Complete violation: $4,800 fare exceeds the $200 cap, 22:55 arrival is after 18:00, and an off-mandate transfer was queued. Revoke the ERC-7710 delegation."
  );

  const { agent, gate } = await printAgentState(leash, agentId, nextSpend);
  if (!agent.paused) {
    throw new Error("Expected agent to be paused after Revoke");
  }
  if (gate.authorized) {
    throw new Error("Expected canProceed=false after Revoke");
  }

  if (mockManager) {
    const afterDisabled = await mockManager.disabled(delegationHash);
    console.log("\nERC-7710 kill switch");
    console.log("  delegationHash: ", delegationHash);
    console.log("  disabled before:", beforeDisabled);
    console.log("  disabled after: ", afterDisabled);
    if (!afterDisabled) {
      throw new Error("Expected MockERC7710DelegationManager.disableDelegation to fire");
    }
  }

  await expectPausedSubmit(leash, agentWallet, agentId);

  console.log("\nRESULT: Revoke — agent paused, ERC-7710 delegation disabled.");
  console.log("The second transaction does not leave the wallet.");
}

async function expectPausedSubmit(leash, agentWallet, agentId) {
  try {
    await leash
      .connect(agentWallet)
      .submitAction(agentId, MANDATE, "retry", "none", 1n, ethers.ZeroAddress);
    throw new Error("Agent was able to submit after Revoke — kill switch failed");
  } catch (error) {
    const message = `${error.shortMessage || ""} ${error.message || ""}`;
    if (!message.includes("AgentPaused")) {
      throw error;
    }
    console.log("Further agent submit reverted with AgentPaused (kill switch holds).");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
