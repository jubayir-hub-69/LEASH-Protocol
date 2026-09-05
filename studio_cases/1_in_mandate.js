/**
 * Studio Case 1 — In mandate
 *
 * Mandate: "spend at most $200 on a flight that lands before 6pm."
 * Agent books a $186 flight that lands at 5:40 PM. Jury answers Continue.
 *
 * Run:
 *   npx hardhat run studio_cases/1_in_mandate.js --network genlayer_studio
 */
const {
  MANDATE,
  USD,
  usd,
  Verdict,
  banner,
  setupCase,
  submitPacket,
  castJury,
  printAgentState,
} = require("./lib");

async function main() {
  banner("LEASH Studio Case 1 / 3  —  IN MANDATE");
  console.log("Pitch: live mandate jury, not an escrow.");
  console.log("Question the jury answers: is this still the job I was allowed to do?");
  console.log("Mandate:", MANDATE);

  const ctx = await setupCase("in-mandate");
  const { leash, jury, agentWallet, agentId } = ctx;

  const nextSpend = USD(186);
  const airline = "0x000000000000000000000000000000000000A171";

  const submissionId = await submitPacket(leash, agentWallet, agentId, {
    logs:
      "Booked economy SFO→JFK on Flight LE-441. Fare $186. Scheduled arrival 17:40 local (before 6pm). No extras.",
    receipts:
      "airline=LE-441; fare_usd=186; arrival_local=17:40; cabin=economy; extras=none; status=ticketed",
    nextSpendAmount: nextSpend,
    nextTarget: airline,
  });

  await castJury(
    leash,
    jury,
    submissionId,
    Verdict.Continue,
    0,
    "In mandate: fare $186 <= $200 and arrival 17:40 is before 18:00. Continue."
  );

  const { gate } = await printAgentState(leash, agentId, nextSpend);
  if (!gate.authorized) {
    throw new Error("Expected canProceed=true after Continue");
  }

  await (await leash.connect(agentWallet).reportSpendExecuted(agentId, nextSpend)).wait();
  const afterSpend = await leash.getAgent(agentId);
  console.log("\nSpend executed. Remaining cap:", usd(afterSpend.spendCap));
  console.log("RESULT: Continue — second transaction is allowed to leave the wallet.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
