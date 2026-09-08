const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const { ethers } = hre;
const MANDATE = "spend at most $200 on a flight that lands before 6pm.";

async function main() {
  const [deployer, agentWallet] = await ethers.getSigners();
  const saved = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed_addresses.json"), "utf8")
  );
  const leash = await ethers.getContractAt("LEASH", saved.LEASH);
  const count = await leash.agentCount();

  if (count >= 1n) {
    const agent = await leash.getAgent(1);
    console.log("Agent 1 already registered");
    console.log({
      wallet: agent.wallet,
      principal: agent.principal,
      mandate: agent.mandate,
      spendCap: ethers.formatEther(agent.spendCap),
      threatScore: agent.threatScore.toString(),
      paused: agent.paused,
    });
    return;
  }

  const latest = await ethers.provider.getBlock("latest");
  const expiresAt = BigInt(latest.timestamp) + 30n * 24n * 60n * 60n;
  const tx = await leash.registerAgent(
    agentWallet.address,
    MANDATE,
    ethers.id(MANDATE),
    ethers.parseEther("200"),
    expiresAt,
    expiresAt,
    ethers.id("erc7710-delegation-agent-1"),
    saved.MockERC7710DelegationManager
  );
  await tx.wait();

  const agent = await leash.getAgent(1);
  console.log("Registered Agent 1");
  console.log({
    agentId: 1,
    wallet: agent.wallet,
    principal: deployer.address,
    mandate: agent.mandate,
    spendCap: ethers.formatEther(agent.spendCap),
    threatScore: agent.threatScore.toString(),
    paused: agent.paused,
    contract: saved.LEASH,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
