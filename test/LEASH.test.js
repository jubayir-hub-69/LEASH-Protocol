const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const Verdict = {
  Continue: 0,
  Warn: 1,
  ConstrainCap: 2,
  Revoke: 3,
  UnlockMilestone: 4,
};

const DEAD = "0x000000000000000000000000000000000000dEaD";

describe("LEASH", function () {
  async function deployFixture({ deadlineOffset = 7 * 24 * 60 * 60 } = {}) {
    const [owner, agent, principal, validator, stranger] = await ethers.getSigners();

    const MockManager = await ethers.getContractFactory("MockERC7710DelegationManager");
    const mockManager = await MockManager.deploy();

    const LEASH = await ethers.getContractFactory("LEASH");
    const leash = await LEASH.deploy(owner.address, 1);

    await leash.addValidator(validator.address);
    await leash.setGenLayerRelayer(owner.address);

    const latest = await time.latest();
    const expiresAt = BigInt(latest + Math.max(deadlineOffset, 60));
    const deadline = expiresAt;
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
        deadline,
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
      deadline,
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
    const { leash, agent, principal, spendCap, expiresAt, deadline } = await deployFixture();
    const stored = await leash.getAgent(1);
    expect(stored.wallet).to.equal(agent.address);
    expect(stored.principal).to.equal(principal.address);
    expect(stored.spendCap).to.equal(spendCap);
    expect(stored.registered).to.equal(true);
    expect(stored.paused).to.equal(false);
    expect(stored.expiresAt).to.equal(expiresAt);
    expect(stored.deadline).to.equal(deadline);
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

  describe("human override & appeal", function () {
    it("lets only the owner emergencyFreeze an agent", async function () {
      const { leash, stranger } = await deployFixture();
      await expect(leash.connect(stranger).emergencyFreeze(1)).to.be.revertedWithCustomError(
        leash,
        "OwnableUnauthorizedAccount"
      );
    });

    it("emergencyFreeze pauses the agent, zeros the cap, and disables ERC-7710", async function () {
      const { leash, mockManager, owner, agent, delegationHash } = await deployFixture();

      await expect(leash.connect(owner).emergencyFreeze(1))
        .to.emit(leash, "EmergencyFrozen")
        .withArgs(1, owner.address, delegationHash)
        .and.to.emit(leash, "KillSwitchFired")
        .and.to.emit(mockManager, "DelegationDisabled")
        .withArgs(delegationHash, await leash.getAddress());

      const stored = await leash.getAgent(1);
      expect(stored.paused).to.equal(true);
      expect(stored.spendCap).to.equal(0n);
      expect(stored.approvedNextSpend).to.equal(0n);
      expect(await mockManager.disabled(delegationHash)).to.equal(true);

      const gate = await leash.canProceed(1, 1n);
      expect(gate.authorized).to.equal(false);
      expect(gate.reason).to.equal("revoked");

      await expect(
        leash.connect(agent).submitAction(1, "mandate", "logs", "receipts", 1n, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(leash, "AgentPaused");
    });

    it("emergencyFreeze bypasses a pending AI jury", async function () {
      const { leash, owner, agent, validator } = await deployFixture();
      await submitSample(leash, agent);

      const pending = await leash.canProceed(1, ethers.parseEther("1"));
      expect(pending.reason).to.equal("awaiting jury");

      await leash.connect(owner).emergencyFreeze(1);

      const stored = await leash.getAgent(1);
      expect(stored.paused).to.equal(true);
      expect(stored.awaitingVerdict).to.equal(false);
      expect(stored.spendCap).to.equal(0n);

      await expect(
        leash.connect(validator).castVerdict(1, Verdict.Continue, 0, "jury overruled")
      ).to.be.revertedWithCustomError(leash, "AgentPaused");
    });

    it("reverts emergencyFreeze on an already paused agent", async function () {
      const { leash, owner } = await deployFixture();
      await leash.connect(owner).emergencyFreeze(1);
      await expect(leash.connect(owner).emergencyFreeze(1)).to.be.revertedWithCustomError(
        leash,
        "AgentPaused"
      );
    });

    it("lets only the owner appealAndUnfreeze", async function () {
      const { leash, owner, stranger } = await deployFixture();
      await leash.connect(owner).emergencyFreeze(1);
      await expect(
        leash.connect(stranger).appealAndUnfreeze(1, ethers.parseEther("3"))
      ).to.be.revertedWithCustomError(leash, "OwnableUnauthorizedAccount");
    });

    it("appealAndUnfreeze restores operations with a new cap", async function () {
      const { leash, owner, agent } = await deployFixture();
      await leash.connect(owner).emergencyFreeze(1);

      const newCap = ethers.parseEther("4");
      const deadlineBefore = (await leash.getAgent(1)).deadline;
      await expect(leash.connect(owner).appealAndUnfreeze(1, newCap))
        .to.emit(leash, "AgentAppealed")
        .withArgs(1, owner.address, newCap, deadlineBefore);

      const stored = await leash.getAgent(1);
      expect(stored.paused).to.equal(false);
      expect(stored.spendCap).to.equal(newCap);
      expect(stored.awaitingVerdict).to.equal(false);
      expect(stored.lastVerdict).to.equal(Verdict.Continue);

      await expect(
        leash.connect(agent).submitAction(1, "mandate", "logs", "receipts", 1n, ethers.ZeroAddress)
      ).to.emit(leash, "ActionSubmitted");
    });

    it("reverts appealAndUnfreeze when the agent is not paused or the cap is zero", async function () {
      const { leash, owner } = await deployFixture();
      await expect(
        leash.connect(owner).appealAndUnfreeze(1, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(leash, "AgentNotPaused");

      await leash.connect(owner).emergencyFreeze(1);
      await expect(leash.connect(owner).appealAndUnfreeze(1, 0)).to.be.revertedWithCustomError(
        leash,
        "InvalidCap"
      );
    });
  });

  describe("time-bound mandate", function () {
    it("defaults deadline to expiresAt when zero is passed", async function () {
      const [owner, agent, principal] = await ethers.getSigners();
      const MockManager = await ethers.getContractFactory("MockERC7710DelegationManager");
      const mockManager = await MockManager.deploy();
      const LEASH = await ethers.getContractFactory("LEASH");
      const leash = await LEASH.deploy(owner.address, 1);

      const latest = await time.latest();
      const expiresAt = BigInt(latest + 3600);
      await leash
        .connect(principal)
        .registerAgent(
          agent.address,
          "mandate",
          ethers.id("m"),
          ethers.parseEther("1"),
          expiresAt,
          0,
          ethers.id("d"),
          await mockManager.getAddress()
        );

      const stored = await leash.getAgent(1);
      expect(stored.deadline).to.equal(expiresAt);
    });

    it("rejects a deadline that is already in the past", async function () {
      const { leash, principal, mockManager } = await deployFixture();
      const latest = await time.latest();
      const expiresAt = BigInt(latest + 3600);
      await expect(
        leash
          .connect(principal)
          .registerAgent(
            ethers.Wallet.createRandom().address,
            "mandate",
            ethers.id("m2"),
            ethers.parseEther("1"),
            expiresAt,
            BigInt(latest - 1),
            ethers.id("d2"),
            await mockManager.getAddress()
          )
      ).to.be.revertedWithCustomError(leash, "InvalidDeadline");
    });

    it("auto-fires the kill switch and rejects an action submitted after the deadline", async function () {
      const { leash, mockManager, agent, deadline, delegationHash } = await deployFixture({
        deadlineOffset: 3600,
      });

      await time.increaseTo(deadline);

      await expect(
        leash.connect(agent).submitAction(1, "mandate", "logs", "receipts", 1n, ethers.ZeroAddress)
      )
        .to.emit(leash, "KillSwitchFired")
        .and.to.emit(leash, "DeadlineKillSwitchFired")
        .and.to.emit(mockManager, "DelegationDisabled")
        .withArgs(delegationHash, await leash.getAddress());

      const stored = await leash.getAgent(1);
      expect(stored.paused).to.equal(true);
      expect(stored.spendCap).to.equal(0n);
      expect(await leash.submissionCount()).to.equal(0n);
      expect(await mockManager.disabled(delegationHash)).to.equal(true);

      const gate = await leash.canProceed(1, 1n);
      expect(gate.authorized).to.equal(false);
      expect(gate.reason).to.equal("revoked");

      await expect(
        leash.connect(agent).submitAction(1, "mandate", "logs", "receipts", 1n, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(leash, "AgentPaused");
    });

    it("lets a keeper enforceDeadline once the mandate window has closed", async function () {
      const { leash, stranger, deadline } = await deployFixture({ deadlineOffset: 3600 });
      await expect(leash.connect(stranger).enforceDeadline(1)).to.be.revertedWithCustomError(
        leash,
        "InvalidDeadline"
      );

      await time.increaseTo(deadline);
      await expect(leash.connect(stranger).enforceDeadline(1))
        .to.emit(leash, "KillSwitchFired")
        .and.to.emit(leash, "DeadlineKillSwitchFired");

      const stored = await leash.getAgent(1);
      expect(stored.paused).to.equal(true);
      expect(stored.spendCap).to.equal(0n);
    });

    it("turns a late jury verdict into a kill switch instead of Continue", async function () {
      const { leash, agent, validator, deadline } = await deployFixture({ deadlineOffset: 3600 });
      await submitSample(leash, agent);

      await time.increaseTo(deadline);
      await expect(leash.connect(validator).castVerdict(1, Verdict.Continue, 0, "too late"))
        .to.emit(leash, "KillSwitchFired")
        .and.to.emit(leash, "DeadlineKillSwitchFired");

      const stored = await leash.getAgent(1);
      expect(stored.paused).to.equal(true);
      expect(stored.spendCap).to.equal(0n);
      expect(stored.lastVerdict).to.equal(Verdict.Revoke);

      const sub = await leash.getSubmission(1);
      expect(sub.adjudicated).to.equal(true);
      expect(sub.finalVerdict).to.equal(Verdict.Revoke);
    });

    it("blocks reportSpendExecuted after the deadline", async function () {
      const { leash, agent, validator, deadline } = await deployFixture({ deadlineOffset: 3600 });
      const amount = await submitSample(leash, agent);
      await leash.connect(validator).castVerdict(1, Verdict.Continue, 0, "ok");

      await time.increaseTo(deadline);
      await expect(leash.connect(agent).reportSpendExecuted(1, amount)).to.be.revertedWithCustomError(
        leash,
        "MandateDeadlineExceeded"
      );
    });

    it("appealAndUnfreeze after a deadline kill switch restores a usable window", async function () {
      const { leash, owner, agent, deadline } = await deployFixture({ deadlineOffset: 3600 });
      await time.increaseTo(deadline);
      await leash.connect(agent).submitAction(1, "late", "logs", "receipts", 1n, ethers.ZeroAddress);

      const newCap = ethers.parseEther("2");
      await leash.connect(owner).appealAndUnfreeze(1, newCap);

      const stored = await leash.getAgent(1);
      expect(stored.paused).to.equal(false);
      expect(stored.spendCap).to.equal(newCap);
      expect(stored.deadline).to.be.greaterThan(deadline);

      await expect(
        leash.connect(agent).submitAction(1, "mandate", "logs", "receipts", 1n, ethers.ZeroAddress)
      ).to.emit(leash, "ActionSubmitted");
    });
  });

  describe("destination extraction & whitelist", function () {
    it("extracts a tagged 20-byte destination and ignores 64-nibble hashes", async function () {
      const { leash } = await deployFixture();
      const tagged = await leash.extractDestination("", `settled to:${DEAD} amount:12`);
      expect(tagged.found).to.equal(true);
      expect(tagged.dest.toLowerCase()).to.equal(DEAD.toLowerCase());

      const hashOnly = await leash.extractDestination(`tx:0x${"ab".repeat(32)}`, "ok");
      expect(hashOnly.found).to.equal(false);
    });

    it("reverts when logs and receipts name different destinations", async function () {
      const { leash } = await deployFixture();
      const other = "0x0000000000000000000000000000000000000001";
      await expect(
        leash.extractDestination(`to:${DEAD}`, `to:${other}`)
      ).to.be.revertedWithCustomError(leash, "DestinationMismatch");
    });

    it("lets only the principal or owner manage the destination allowlist", async function () {
      const { leash, principal, stranger } = await deployFixture();
      await expect(
        leash.connect(stranger).addAllowedDestination(1, DEAD)
      ).to.be.revertedWithCustomError(leash, "NotAuthorized");

      await expect(leash.connect(principal).addAllowedDestination(1, DEAD))
        .to.emit(leash, "DestinationAllowlistUpdated")
        .withArgs(1, DEAD, true);
      expect(await leash.isAllowedDestination(1, DEAD)).to.equal(true);
      expect(await leash.allowedDestinationCount(1)).to.equal(1n);
    });

    it("rejects submits whose target is missing or not allowlisted", async function () {
      const { leash, principal, agent } = await deployFixture();
      await leash.connect(principal).addAllowedDestination(1, DEAD);

      await expect(
        leash.connect(agent).submitAction(1, "mandate", "logs", "receipts", 1n, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(leash, "DestinationRequired");

      const other = "0x0000000000000000000000000000000000000001";
      await expect(
        leash.connect(agent).submitAction(1, "mandate", "logs", `to:${other}`, 1n, other)
      ).to.be.revertedWithCustomError(leash, "DestinationNotAllowed");
    });

    it("binds the jury-approved destination and blocks spends to anywhere else", async function () {
      const { leash, principal, agent, validator } = await deployFixture();
      await leash.connect(principal).addAllowedDestination(1, DEAD);

      const amount = ethers.parseEther("1");
      await leash
        .connect(agent)
        .submitAction(1, "mandate", "called vendor", `paid to:${DEAD}`, amount, DEAD);
      await leash.connect(validator).castVerdict(1, Verdict.Continue, 0, "on mandate");

      const stored = await leash.getAgent(1);
      expect(stored.approvedDestination.toLowerCase()).to.equal(DEAD.toLowerCase());

      const ok = await leash.canProceedTo(1, amount, DEAD);
      expect(ok.authorized).to.equal(true);

      const other = "0x0000000000000000000000000000000000000001";
      const blocked = await leash.canProceedTo(1, amount, other);
      expect(blocked.authorized).to.equal(false);
      expect(blocked.reason).to.equal("destination not whitelisted");

      await expect(
        leash.connect(agent)["reportSpendExecuted(uint256,uint256,address)"](1, amount, other)
      ).to.be.revertedWithCustomError(leash, "SpendNotAuthorized");

      await expect(
        leash.connect(agent)["reportSpendExecuted(uint256,uint256,address)"](1, amount, DEAD)
      ).to.emit(leash, "SpendExecuted");
    });

    it("reverts when the packet destination does not match nextTarget", async function () {
      const { leash, principal, agent } = await deployFixture();
      await leash.connect(principal).addAllowedDestination(1, DEAD);
      const other = "0x0000000000000000000000000000000000000001";
      await expect(
        leash.connect(agent).submitAction(1, "mandate", "logs", `to:${other}`, 1n, DEAD)
      ).to.be.revertedWithCustomError(leash, "DestinationMismatch");
    });
  });

  describe("milestone cap unlocking", function () {
    it("lets the jury increase spendCap when a registered milestone is verified", async function () {
      const { leash, principal, agent, validator, spendCap } = await deployFixture();
      const bump = ethers.parseEther("5");

      await expect(leash.connect(principal).addMilestone(1, "dataset delivered to vault", bump))
        .to.emit(leash, "MilestoneRegistered")
        .withArgs(1, 1, bump, "dataset delivered to vault");

      await submitSample(leash, agent, ethers.parseEther("1"));
      await expect(
        leash.connect(validator).castVerdict(1, Verdict.UnlockMilestone, 1, "milestone proven")
      )
        .to.emit(leash, "MilestoneUnlocked")
        .withArgs(1, 1, 1, bump, spendCap + bump);

      const stored = await leash.getAgent(1);
      expect(stored.spendCap).to.equal(spendCap + bump);
      expect(stored.approvedNextSpend).to.equal(ethers.parseEther("1"));
      expect(stored.lastVerdict).to.equal(Verdict.UnlockMilestone);

      const ms = await leash.getMilestone(1, 1);
      expect(ms.completed).to.equal(true);
      expect(ms.completedSubmissionId).to.equal(1n);
    });

    it("rejects unknown, empty, or already-completed milestones", async function () {
      const { leash, principal, agent, validator, stranger } = await deployFixture();

      await expect(
        leash.connect(stranger).addMilestone(1, "nope", 1n)
      ).to.be.revertedWithCustomError(leash, "NotAuthorized");
      await expect(
        leash.connect(principal).addMilestone(1, "", 1n)
      ).to.be.revertedWithCustomError(leash, "EmptyDescription");
      await expect(
        leash.connect(principal).addMilestone(1, "ok", 0n)
      ).to.be.revertedWithCustomError(leash, "ZeroCapIncrease");

      await leash.connect(principal).addMilestone(1, "first delivery", ethers.parseEther("1"));
      await submitSample(leash, agent);
      await expect(
        leash.connect(validator).castVerdict(1, Verdict.UnlockMilestone, 9, "ghost")
      ).to.be.revertedWithCustomError(leash, "UnknownMilestone");

      await leash.connect(validator).castVerdict(1, Verdict.UnlockMilestone, 1, "done");
      await submitSample(leash, agent);
      await expect(
        leash.connect(validator).castVerdict(2, Verdict.UnlockMilestone, 1, "again")
      ).to.be.revertedWithCustomError(leash, "MilestoneAlreadyCompleted");
    });
  });

  describe("dynamic threat scoring", function () {
    it("accrues default 1-point Warns without firing the kill switch", async function () {
      const { leash, agent, owner } = await deployFixture();
      await submitSample(leash, agent);
      await leash.connect(owner).submitConsensusVerdict(1, Verdict.Warn, 0, "watch this agent");

      const stored = await leash.getAgent(1);
      expect(stored.warningCount).to.equal(1n);
      expect(stored.threatScore).to.equal(1n);
      expect(stored.paused).to.equal(false);
      expect(stored.lastVerdict).to.equal(Verdict.Warn);
      expect(await leash.threatThreshold()).to.equal(10n);
    });

    it("adds severity-weighted points and kills at the threshold", async function () {
      const { leash, owner, agent, validator, mockManager, delegationHash } = await deployFixture();
      await leash.connect(owner).setThreatThreshold(5);

      await submitSample(leash, agent);
      await leash.connect(validator).castVerdict(1, Verdict.Warn, 3, "moderate drift");
      let stored = await leash.getAgent(1);
      expect(stored.threatScore).to.equal(3n);
      expect(stored.paused).to.equal(false);

      await submitSample(leash, agent);
      await expect(leash.connect(validator).castVerdict(2, Verdict.Warn, 3, "again"))
        .to.emit(leash, "ThreatKillSwitchFired")
        .withArgs(1, 2, 6, 5)
        .and.to.emit(leash, "KillSwitchFired")
        .and.to.emit(mockManager, "DelegationDisabled")
        .withArgs(delegationHash, await leash.getAddress());

      stored = await leash.getAgent(1);
      expect(stored.paused).to.equal(true);
      expect(stored.spendCap).to.equal(0n);
      expect(stored.threatScore).to.equal(6n);
      expect(stored.lastVerdict).to.equal(Verdict.Revoke);
    });

    it("resets threat score on appealAndUnfreeze", async function () {
      const { leash, owner, agent, validator } = await deployFixture();
      await leash.connect(owner).setThreatThreshold(1);
      await submitSample(leash, agent);
      await leash.connect(validator).castVerdict(1, Verdict.Warn, 1, "trip");

      expect((await leash.getAgent(1)).paused).to.equal(true);

      await leash.connect(owner).appealAndUnfreeze(1, ethers.parseEther("3"));
      const stored = await leash.getAgent(1);
      expect(stored.paused).to.equal(false);
      expect(stored.threatScore).to.equal(0n);
      expect(stored.warningCount).to.equal(0n);
    });

    it("rejects a zero threat threshold", async function () {
      const { leash, owner } = await deployFixture();
      await expect(leash.connect(owner).setThreatThreshold(0)).to.be.revertedWithCustomError(
        leash,
        "InvalidThreatThreshold"
      );
    });
  });
});
