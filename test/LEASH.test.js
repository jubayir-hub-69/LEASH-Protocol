const { expect } = require("chai");
const { ethers } = require("hardhat");

const Verdict = {
  Continue: 0,
  Warn: 1,
  ConstrainCap: 2,
  Revoke: 3,
};

describe("LEASH", function () {
  async function deployFixture() {
    const [owner, agent, principal, validator, stranger] = await ethers.getSigners();

    const MockManager = await ethers.getContractFactory("MockERC7710DelegationManager");
    const mockManager = await MockManager.deploy();

    const LEASH = await ethers.getContractFactory("LEASH");
    const leash = await LEASH.deploy(owner.address, 1);

    await leash.addValidator(validator.address);
    await leash.setGenLayerRelayer(owner.address);

    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
    const spendCap = ethers.parseEther("10");
    const delegationHash = ethers.id("erc7710-delegation-1");

    const tx = await leash
      .connect(principal)
      .registerAgent(
        agent.address,
        "Buy compute for dataset preprocessing only",
        ethers.id("mandate-v1"),
        spendCap,
        expiresAt,
        delegationHash,
        await mockManager.getAddress()
      );
    await tx.wait();

    return {
      leash,
      mockManager,
      owner,
      agent,
      principal,
      validator,
      stranger,
      spendCap,
      expiresAt,
      delegationHash,
    };
  }

  async function submitSample(leash, agent, nextSpend = ethers.parseEther("1")) {
    const tx = await leash
      .connect(agent)
      .submitAction(
        1,
        "Buy compute for dataset preprocessing only",
        "called provider.complete(job=preprocess)",
        "tx:0xabc receipt:ok",
        nextSpend,
        ethers.ZeroAddress
      );
    await tx.wait();
    return nextSpend;
  }

  it("registers an agent and stores the mandate", async function () {
    const { leash, agent, principal, spendCap } = await deployFixture();
    const stored = await leash.getAgent(1);
    expect(stored.wallet).to.equal(agent.address);
    expect(stored.principal).to.equal(principal.address);
    expect(stored.spendCap).to.equal(spendCap);
    expect(stored.registered).to.equal(true);
    expect(stored.paused).to.equal(false);
  });

  it("lets only the authorized agent submit an action packet", async function () {
    const { leash, agent, stranger } = await deployFixture();

    await expect(
      leash.connect(stranger).submitAction(1, "mandate", "logs", "receipts", 1n, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(leash, "NotAgent");

    await expect(
      leash.connect(agent).submitAction(1, "mandate", "logs", "receipts", 1n, ethers.ZeroAddress)
    ).to.emit(leash, "ActionSubmitted");

    const sub = await leash.getSubmission(1);
    expect(sub.mandate).to.equal("mandate");
    expect(sub.logs).to.equal("logs");
    expect(sub.receipts).to.equal("receipts");
    expect(sub.nextSpendAmount).to.equal(1n);
    expect(sub.adjudicated).to.equal(false);
  });

  it("blocks the next spend until the jury adjudicates", async function () {
    const { leash, agent } = await deployFixture();
    await submitSample(leash, agent);

    const pending = await leash.canProceed(1, ethers.parseEther("1"));
    expect(pending.authorized).to.equal(false);
    expect(pending.reason).to.equal("awaiting jury");
  });

  it("Continue unlocks the next spend up to the posted amount", async function () {
    const { leash, agent, validator } = await deployFixture();
    const amount = await submitSample(leash, agent);

    await expect(leash.connect(validator).castVerdict(1, Verdict.Continue, 0, "still the job"))
      .to.emit(leash, "VerdictApplied")
      .withArgs(1, 1, Verdict.Continue, ethers.parseEther("10"), amount, validator.address, "still the job");

    const gate = await leash.canProceed(1, amount);
    expect(gate.authorized).to.equal(true);
  });

  it("ConstrainCap reduces the remaining allowance", async function () {
    const { leash, agent, validator } = await deployFixture();
    await submitSample(leash, agent, ethers.parseEther("5"));

    const newCap = ethers.parseEther("2");
    await leash.connect(validator).castVerdict(1, Verdict.ConstrainCap, newCap, "over-scoped");

    const stored = await leash.getAgent(1);
    expect(stored.spendCap).to.equal(newCap);
    expect(stored.approvedNextSpend).to.equal(newCap);
    expect(stored.lastVerdict).to.equal(Verdict.ConstrainCap);
  });

  it("Revoke pauses the agent and disables the ERC-7710 delegation", async function () {
    const { leash, mockManager, agent, validator, delegationHash } = await deployFixture();
    await submitSample(leash, agent);

    await expect(leash.connect(validator).castVerdict(1, Verdict.Revoke, 0, "off mandate"))
      .to.emit(leash, "KillSwitchFired")
      .and.to.emit(mockManager, "DelegationDisabled")
      .withArgs(delegationHash, await leash.getAddress());

    const stored = await leash.getAgent(1);
    expect(stored.paused).to.equal(true);
    expect(stored.spendCap).to.equal(0n);
    expect(await mockManager.disabled(delegationHash)).to.equal(true);

    const gate = await leash.canProceed(1, 1n);
    expect(gate.authorized).to.equal(false);
    expect(gate.reason).to.equal("revoked");

    await expect(
      leash.connect(agent).submitAction(1, "mandate", "logs", "receipts", 1n, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(leash, "AgentPaused");
  });

  it("accepts a GenLayer consensus verdict from the relayer", async function () {
    const { leash, agent, owner } = await deployFixture();
    await submitSample(leash, agent);

    await expect(
      leash.connect(owner).submitConsensusVerdict(1, Verdict.Warn, 0, "watch this agent")
    ).to.emit(leash, "VerdictApplied");

    const stored = await leash.getAgent(1);
    expect(stored.warningCount).to.equal(1n);
    expect(stored.lastVerdict).to.equal(Verdict.Warn);
    expect(stored.awaitingVerdict).to.equal(false);
  });
});
