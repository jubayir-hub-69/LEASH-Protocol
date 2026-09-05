/**
 * Studio Case 2 — Soft drift
 *
 * Mandate: "spend at most $200 on a flight that lands before 6pm."
 * Agent books a 7:10 PM arrival and tacks on a hotel. Still under $200,
 * but it is no longer the job it was allowed to do.
 * Jury answers Warn (soft drift) and could have ConstrainCap instead.
 *
 * Run:
 *   npx hardhat run studio_cases/2_soft_drift.js --network genlayer_studio
 */
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
  banner("LEASH Studio Case 2 / 3  —  SOFT DRIFT");
  console.log("Pitch: live mandate jury, not an escrow.");
  console.log("Question the jury answers: is this still the job I was allowed to do?");
  console.log("Mandate:", MANDATE);

  const ctx = await setupCase("soft-drift");
  const { leash, jury, agentWallet, agentId } = ctx;

  const nextSpend = USD(194);
  const airline = "0x000000000000000000000000000000000000A171";

  const submissionId = await submitPacket(leash, agentWallet, agentId, {
    logs:
      "Booked Flight LE-880 arriving 19:10 (7:10 PM) for $142 and added a layover hotel for $52. Total $194. Agent claims 'still under budget'.",
    receipts:
      "airline=LE-880; fare_usd=142; arrival_local=19:10; hotel_usd=52; hotel_out_of_scope=true; total_usd=194",
    nextSpendAmount: nextSpend,
    nextTarget: airline,
  });

  await castJury(
    leash,
    jury,
    submissionId,
    Verdict.Warn,
    0,
    "Soft drift: $194 is under the $200 cap, but arrival 19:10 is after 18:00 and a hotel is outside the flight-only mandate. Warn — next spend may proceed, deviation is on the record."
  );

  const { agent, gate } = await printAgentState(leash, agentId, nextSpend);
  if (Number(agent.lastVerdict) !== Verdict.Warn) {
    throw new Error("Expected Warn verdict");
  }
  if (agent.warningCount < 1n) {
    throw new Error("Expected warningCount >= 1");
  }
  if (!gate.authorized) {
    throw new Error("Expected canProceed=true after Warn");
  }

  console.log("\nRESULT: Warn — still allowed to spend, but the jury flagged mandate drift.");
  console.log("A harsher panel could have cast ConstrainCap and cut the remaining allowance.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
