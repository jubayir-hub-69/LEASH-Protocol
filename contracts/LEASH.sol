// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC7710DelegationManager} from "./interfaces/IERC7710DelegationManager.sol";

/// @title LEASH
/// @notice Live mandate jury and ERC-7710 kill switch for AI agents that already hold spending keys.
/// @dev Not an escrow. After every action the agent posts mandate, logs, receipts, and the next
///      intended spend. GenLayer validators answer: "Is this still the job I was allowed to do?"
///      Production controls:
///        1. Owner emergencyFreeze / appealAndUnfreeze (bypass the jury)
///        2. Time-bound mandate deadline (late submit fires the kill switch)
///        3. Milestone unlocks (jury may raise spendCap only for a registered milestone)
///        4. Strict destination allowlist (on-chain extraction from logs/receipts)
///        5. Threat score (Warn points; crossing threatThreshold fires the kill switch)
contract LEASH is Ownable, ReentrancyGuard {
    // -------------------------------------------------------------------------
    // Enums
    // -------------------------------------------------------------------------

    /// @notice Jury outcomes. Negative verdicts stay at their original values so
    ///         existing clients keep working. UnlockMilestone is additive (value 4).
    enum Verdict {
        Continue,         // still on-mandate; next spend may proceed
        Warn,             // deviation noted; threat points accrue; spend may still proceed
        ConstrainCap,     // remaining spend cap is reduced
        Revoke,           // kill switch: pause agent + revoke ERC-7710 delegation
        UnlockMilestone   // jury verified a registered milestone; spend cap increases
    }

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    /// @notice Registered AI agent that already holds a spending key / delegation.
    struct Agent {
        address wallet;                  // authorized key that posts submissions
        address principal;               // human who granted the delegation
        string mandate;                  // current job description
        bytes32 mandateHash;             // hash / CID of the full mandate document
        uint256 spendCap;                // remaining spend allowance (wei)
        uint256 expiresAt;               // mandate expiry (unix seconds)
        uint256 deadline;                // time-bound mandate; action after this fires the kill switch
        bytes32 erc7710DelegationHash;   // ERC-7710 delegation identifier
        address delegationManager;       // ERC-7710 manager; address(0) = no on-chain disable target
        bool paused;                     // true after Revoke (kill switch)
        bool registered;
        bool awaitingVerdict;            // true between submit and jury decision
        uint256 nonce;                   // number of submissions posted
        uint256 warningCount;            // number of Warn verdicts applied
        uint256 threatScore;             // cumulative severity-weighted Warn points
        uint256 approvedNextSpend;       // jury-approved amount for the next spend
        uint256 lastSubmissionId;
        address approvedDestination;     // last jury-approved spend destination
        Verdict lastVerdict;
    }

    /// @notice Principal-registered milestone whose completion unlocks additional cap.
    struct Milestone {
        uint256 id;
        string description;
        uint256 capIncrease;
        bool completed;
        uint256 completedAt;
        uint256 completedSubmissionId;
    }

    /// @notice Post-action packet the agent must publish before the next spend.
    struct Submission {
        uint256 agentId;
        uint256 nonce;
        string mandate;
        string logs;
        string receipts;
        uint256 nextSpendAmount;
        address nextTarget;
        bytes32 evidenceHash;
        uint256 submittedAt;
        bool adjudicated;
        Verdict finalVerdict;
        string finalReason;
    }

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error InvalidThreshold();
    error InvalidCap();
    error InvalidExpiry();
    error InvalidDeadline();
    error MandateDeadlineExceeded();
    error UnknownAgent();
    error UnknownSubmission();
    error NotAgent();
    error NotJury();
    error NotRelayer();
    error NotAuthorized();
    error AgentPaused();
    error AgentNotPaused();
    error AlreadyRegistered();
    error AlreadyAdjudicated();
    error AlreadyVoted();
    error AwaitingVerdict();
    error MandateExpired();
    error SpendNotAuthorized();
    error EmptyMandate();
    error ConsensusPathDisabled();
    error DestinationRequired();
    error DestinationNotAllowed();
    error DestinationMismatch();
    error DestinationAmbiguous();
    error UnknownMilestone();
    error MilestoneAlreadyCompleted();
    error InvalidThreatThreshold();
    error EmptyDescription();
    error ZeroCapIncrease();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event AgentRegistered(
        uint256 indexed agentId,
        address indexed wallet,
        address indexed principal,
        uint256 spendCap,
        uint256 expiresAt,
        uint256 deadline,
        bytes32 erc7710DelegationHash
    );
    event ActionSubmitted(
        uint256 indexed submissionId,
        uint256 indexed agentId,
        uint256 nonce,
        uint256 nextSpendAmount,
        address nextTarget,
        bytes32 evidenceHash
    );
    event ValidatorVoteCast(
        uint256 indexed submissionId,
        address indexed validator,
        Verdict verdict,
        uint256 newCap,
        string reason
    );
    event VerdictApplied(
        uint256 indexed submissionId,
        uint256 indexed agentId,
        Verdict verdict,
        uint256 spendCap,
        uint256 approvedNextSpend,
        address decidedBy,
        string reason
    );
    event KillSwitchFired(
        uint256 indexed agentId,
        uint256 indexed submissionId,
        bytes32 erc7710DelegationHash,
        address delegationManager
    );
    event DelegationDisableSucceeded(uint256 indexed agentId, bytes32 indexed delegationHash);
    event DelegationDisableFailed(uint256 indexed agentId, bytes32 indexed delegationHash, bytes reason);
    event SpendExecuted(uint256 indexed agentId, uint256 amount, uint256 remainingCap);
    event ValidatorUpdated(address indexed validator, bool allowed);
    event GenLayerRelayerUpdated(address indexed relayer);
    event VerdictThresholdUpdated(uint256 threshold);
    event AgentReinstated(uint256 indexed agentId, uint256 newCap, bytes32 newDelegationHash);
    event EmergencyFrozen(uint256 indexed agentId, address indexed caller, bytes32 erc7710DelegationHash);
    event AgentAppealed(uint256 indexed agentId, address indexed caller, uint256 newCap, uint256 deadline);
    event DeadlineKillSwitchFired(uint256 indexed agentId, uint256 deadline, uint256 timestamp);
    event MilestoneRegistered(
        uint256 indexed agentId,
        uint256 indexed milestoneId,
        uint256 capIncrease,
        string description
    );
    event MilestoneUnlocked(
        uint256 indexed agentId,
        uint256 indexed milestoneId,
        uint256 indexed submissionId,
        uint256 capIncrease,
        uint256 newSpendCap
    );
    event DestinationAllowlistUpdated(uint256 indexed agentId, address indexed destination, bool allowed);
    event ThreatScoreUpdated(
        uint256 indexed agentId,
        uint256 indexed submissionId,
        uint256 pointsAdded,
        uint256 threatScore,
        uint256 threatThreshold
    );
    event ThreatKillSwitchFired(
        uint256 indexed agentId,
        uint256 indexed submissionId,
        uint256 threatScore,
        uint256 threatThreshold
    );
    event ThreatThresholdUpdated(uint256 threshold);

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    uint256 public constant DEFAULT_THREAT_THRESHOLD = 10;

    uint256 public agentCount;
    uint256 public submissionCount;
    uint256 public validatorCount;
    uint256 public verdictThreshold;
    uint256 public threatThreshold;
    address public genLayerRelayer;

    mapping(uint256 => Agent) public agents;
    mapping(uint256 => Submission) public submissions;
    mapping(address => bool) public isValidator;
    mapping(address => uint256) public agentIdOf;

    /// @dev submissionId => verdict => vote count
    mapping(uint256 => mapping(Verdict => uint256)) public voteCounts;
    /// @dev submissionId => validator => already voted
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    /// @dev lowest ConstrainCap value proposed so far (0 = none)
    mapping(uint256 => uint256) public minProposedCap;
    /// @dev first UnlockMilestone id proposed for a submission (0 = none)
    mapping(uint256 => uint256) public proposedMilestoneId;
    /// @dev highest Warn severity proposed for a submission (0 = none)
    mapping(uint256 => uint256) public maxThreatPoints;

    /// @dev agentId => destination => allowed
    mapping(uint256 => mapping(address => bool)) public allowedDestinations;
    /// @dev agentId => number of currently allowed destinations
    mapping(uint256 => uint256) public allowedDestinationCount;

    /// @dev agentId => 1-based milestoneId => Milestone
    mapping(uint256 => mapping(uint256 => Milestone)) public milestones;
    /// @dev agentId => number of registered milestones
    mapping(uint256 => uint256) public milestoneCount;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param initialOwner Protocol owner (freeze / appeal / roster admin).
    /// @param verdictThreshold_ Votes required to auto-finalize a jury decision. Must be >= 1.
    constructor(address initialOwner, uint256 verdictThreshold_) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        if (verdictThreshold_ == 0) revert InvalidThreshold();
        verdictThreshold = verdictThreshold_;
        threatThreshold = DEFAULT_THREAT_THRESHOLD;
    }

    // -------------------------------------------------------------------------
    // Admin / jury roster
    // -------------------------------------------------------------------------

    function setGenLayerRelayer(address relayer) external onlyOwner {
        genLayerRelayer = relayer;
        emit GenLayerRelayerUpdated(relayer);
    }

    function setVerdictThreshold(uint256 threshold) external onlyOwner {
        if (threshold == 0) revert InvalidThreshold();
        verdictThreshold = threshold;
        emit VerdictThresholdUpdated(threshold);
    }

    function setThreatThreshold(uint256 threshold) external onlyOwner {
        if (threshold == 0) revert InvalidThreatThreshold();
        threatThreshold = threshold;
        emit ThreatThresholdUpdated(threshold);
    }

    function addValidator(address validator) external onlyOwner {
        if (validator == address(0)) revert ZeroAddress();
        if (isValidator[validator]) return;
        isValidator[validator] = true;
        validatorCount += 1;
        emit ValidatorUpdated(validator, true);
    }

    function removeValidator(address validator) external onlyOwner {
        if (!isValidator[validator]) return;
        isValidator[validator] = false;
        validatorCount -= 1;
        emit ValidatorUpdated(validator, false);
    }

    // -------------------------------------------------------------------------
    // Agent lifecycle
    // -------------------------------------------------------------------------

    /// @notice Principal (or owner) enrolls an AI agent that already holds spending keys.
    /// @param deadline Unix timestamp after which any submitAction auto-fires the kill switch.
    ///                 Pass 0 to bind the deadline to `expiresAt`.
    function registerAgent(
        address wallet,
        string calldata mandate,
        bytes32 mandateHash,
        uint256 spendCap,
        uint256 expiresAt,
        uint256 deadline,
        bytes32 erc7710DelegationHash,
        address delegationManager
    ) external returns (uint256 agentId) {
        if (wallet == address(0)) revert ZeroAddress();
        if (bytes(mandate).length == 0) revert EmptyMandate();
        if (spendCap == 0) revert InvalidCap();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        if (deadline == 0) {
            deadline = expiresAt;
        }
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (deadline > expiresAt) {
            deadline = expiresAt;
        }
        if (agentIdOf[wallet] != 0) revert AlreadyRegistered();

        agentId = ++agentCount;
        Agent storage agent = agents[agentId];
        agent.wallet = wallet;
        agent.principal = msg.sender;
        agent.mandate = mandate;
        agent.mandateHash = mandateHash;
        agent.spendCap = spendCap;
        agent.expiresAt = expiresAt;
        agent.deadline = deadline;
        agent.erc7710DelegationHash = erc7710DelegationHash;
        agent.delegationManager = delegationManager;
        agent.registered = true;
        agentIdOf[wallet] = agentId;

        emit AgentRegistered(agentId, wallet, msg.sender, spendCap, expiresAt, deadline, erc7710DelegationHash);
    }

    /// @notice Re-issue a mandate after a Revoke. Does not resurrect the old delegation.
    function reinstateAgent(
        uint256 agentId,
        uint256 newCap,
        uint256 newExpiresAt,
        string calldata newMandate,
        bytes32 newMandateHash,
        bytes32 newDelegationHash,
        address newDelegationManager
    ) external {
        Agent storage agent = _agent(agentId);
        if (msg.sender != owner() && msg.sender != agent.principal) revert NotAuthorized();
        if (!agent.paused) revert AgentNotPaused();
        if (newCap == 0) revert InvalidCap();
        if (newExpiresAt <= block.timestamp) revert InvalidExpiry();
        if (bytes(newMandate).length == 0) revert EmptyMandate();

        agent.paused = false;
        agent.awaitingVerdict = false;
        agent.spendCap = newCap;
        agent.expiresAt = newExpiresAt;
        agent.deadline = newExpiresAt;
        agent.mandate = newMandate;
        agent.mandateHash = newMandateHash;
        agent.erc7710DelegationHash = newDelegationHash;
        agent.delegationManager = newDelegationManager;
        agent.approvedNextSpend = 0;
        agent.approvedDestination = address(0);
        agent.threatScore = 0;
        agent.warningCount = 0;
        agent.lastVerdict = Verdict.Continue;

        emit AgentReinstated(agentId, newCap, newDelegationHash);
    }

    /// @notice Owner bypasses the AI jury: instantly pause the agent, zero the cap, and
    ///         disable the ERC-7710 delegation. Works even while a verdict is pending.
    function emergencyFreeze(uint256 agentId) external onlyOwner nonReentrant {
        Agent storage agent = _agent(agentId);
        if (agent.paused) revert AgentPaused();
        _activateKillSwitch(agentId, agent, agent.lastSubmissionId);
        emit EmergencyFrozen(agentId, msg.sender, agent.erc7710DelegationHash);
    }

    /// @notice Owner appeal path: unfreeze a paused agent and restore a spend cap.
    /// @dev If the mandate window has already closed, a 7-day operating window is granted
    ///      so restored operations are actually usable. A disabled ERC-7710 delegation is
    ///      not resurrected; use `reinstateAgent` to attach a fresh delegation hash.
    function appealAndUnfreeze(uint256 agentId, uint256 newCap) external onlyOwner {
        Agent storage agent = _agent(agentId);
        if (!agent.paused) revert AgentNotPaused();
        if (newCap == 0) revert InvalidCap();

        agent.paused = false;
        agent.spendCap = newCap;
        agent.awaitingVerdict = false;
        agent.approvedNextSpend = 0;
        agent.approvedDestination = address(0);
        agent.threatScore = 0;
        agent.warningCount = 0;
        agent.lastVerdict = Verdict.Continue;

        if (agent.deadline <= block.timestamp || agent.expiresAt <= block.timestamp) {
            uint256 window = 7 days;
            agent.deadline = block.timestamp + window;
            agent.expiresAt = block.timestamp + window;
        }

        emit AgentAppealed(agentId, msg.sender, newCap, agent.deadline);
    }

    /// @notice Permissionless keeper: persist the kill switch once the mandate deadline has passed.
    function enforceDeadline(uint256 agentId) external nonReentrant {
        Agent storage agent = _agent(agentId);
        if (block.timestamp < agent.deadline) revert InvalidDeadline();
        if (agent.paused) revert AgentPaused();
        _activateKillSwitch(agentId, agent, agent.lastSubmissionId);
        emit DeadlineKillSwitchFired(agentId, agent.deadline, block.timestamp);
    }

    // -------------------------------------------------------------------------
    // Destination whitelist
    // -------------------------------------------------------------------------

    /// @notice Principal (or owner) allowlists a destination the agent may spend to.
    /// @dev Once at least one destination is listed, every submit and spend is gated against it.
    function addAllowedDestination(uint256 agentId, address destination) external {
        Agent storage agent = _agent(agentId);
        if (msg.sender != owner() && msg.sender != agent.principal) revert NotAuthorized();
        if (destination == address(0)) revert ZeroAddress();
        if (allowedDestinations[agentId][destination]) return;
        allowedDestinations[agentId][destination] = true;
        allowedDestinationCount[agentId] += 1;
        emit DestinationAllowlistUpdated(agentId, destination, true);
    }

    function removeAllowedDestination(uint256 agentId, address destination) external {
        Agent storage agent = _agent(agentId);
        if (msg.sender != owner() && msg.sender != agent.principal) revert NotAuthorized();
        if (!allowedDestinations[agentId][destination]) return;
        allowedDestinations[agentId][destination] = false;
        allowedDestinationCount[agentId] -= 1;
        if (agent.approvedDestination == destination) {
            agent.approvedDestination = address(0);
        }
        emit DestinationAllowlistUpdated(agentId, destination, false);
    }

    function isAllowedDestination(uint256 agentId, address destination) public view returns (bool) {
        return allowedDestinations[agentId][destination];
    }

    // -------------------------------------------------------------------------
    // Milestones
    // -------------------------------------------------------------------------

    /// @notice Principal (or owner) registers a milestone. Completing it via an
    ///         UnlockMilestone verdict increases the agent's remaining spend cap.
    function addMilestone(uint256 agentId, string calldata description, uint256 capIncrease)
        external
        returns (uint256 milestoneId)
    {
        Agent storage agent = _agent(agentId);
        if (msg.sender != owner() && msg.sender != agent.principal) revert NotAuthorized();
        if (bytes(description).length == 0) revert EmptyDescription();
        if (capIncrease == 0) revert ZeroCapIncrease();

        milestoneId = ++milestoneCount[agentId];
        Milestone storage ms = milestones[agentId][milestoneId];
        ms.id = milestoneId;
        ms.description = description;
        ms.capIncrease = capIncrease;

        emit MilestoneRegistered(agentId, milestoneId, capIncrease, description);
    }

    function getMilestone(uint256 agentId, uint256 milestoneId) external view returns (Milestone memory) {
        if (milestoneId == 0 || milestoneId > milestoneCount[agentId]) revert UnknownMilestone();
        return milestones[agentId][milestoneId];
    }

    // -------------------------------------------------------------------------
    // Agent submissions
    // -------------------------------------------------------------------------

    /// @notice Authorized AI agent posts mandate, logs, receipts, and the next intended spend.
    /// @dev Blocks a further spend (`canProceed` returns false) until the jury adjudicates.
    function submitAction(
        uint256 agentId,
        string calldata mandate,
        string calldata logs,
        string calldata receipts,
        uint256 nextSpendAmount,
        address nextTarget
    ) external returns (uint256 submissionId) {
        Agent storage agent = _agent(agentId);
        if (msg.sender != agent.wallet) revert NotAgent();
        if (agent.paused) revert AgentPaused();
        if (block.timestamp >= agent.deadline) {
            // Persist the kill switch in this successful tx. A revert would roll
            // the pause / zero-cap / ERC-7710 disable back. Follow-up submits
            // revert AgentPaused. No spendable submission is recorded.
            _activateKillSwitch(agentId, agent, agent.lastSubmissionId);
            emit DeadlineKillSwitchFired(agentId, agent.deadline, block.timestamp);
            return 0;
        }
        if (agent.awaitingVerdict) revert AwaitingVerdict();
        if (block.timestamp >= agent.expiresAt) revert MandateExpired();
        if (bytes(mandate).length == 0) revert EmptyMandate();

        nextTarget = _enforceDestination(agentId, logs, receipts, nextTarget);
        agent.mandate = mandate;

        uint256 nonce = ++agent.nonce;
        bytes32 evidenceHash = keccak256(
            abi.encode(agentId, nonce, mandate, logs, receipts, nextSpendAmount, nextTarget, block.timestamp)
        );

        submissionId = ++submissionCount;
        Submission storage sub = submissions[submissionId];
        sub.agentId = agentId;
        sub.nonce = nonce;
        sub.mandate = mandate;
        sub.logs = logs;
        sub.receipts = receipts;
        sub.nextSpendAmount = nextSpendAmount;
        sub.nextTarget = nextTarget;
        sub.evidenceHash = evidenceHash;
        sub.submittedAt = block.timestamp;

        agent.awaitingVerdict = true;
        agent.approvedNextSpend = 0;
        agent.lastSubmissionId = submissionId;

        emit ActionSubmitted(submissionId, agentId, nonce, nextSpendAmount, nextTarget, evidenceHash);
    }

    // -------------------------------------------------------------------------
    // Jury
    // -------------------------------------------------------------------------

    /// @notice GenLayer relayer posts the already-agreed consensus verdict in a single tx.
    /// @dev Primary path: validators decide on GenLayer, one relayer writes the result here.
    function submitConsensusVerdict(
        uint256 submissionId,
        Verdict verdict,
        uint256 newCap,
        string calldata reason
    ) external nonReentrant {
        if (msg.sender != genLayerRelayer && msg.sender != owner()) revert NotRelayer();
        if (genLayerRelayer == address(0) && msg.sender != owner()) revert ConsensusPathDisabled();
        _applyVerdict(submissionId, verdict, newCap, reason, msg.sender);
    }

    /// @notice A registered GenLayer validator casts a vote. Auto-finalizes at `verdictThreshold`.
    /// @dev Safety-first: Revoke beats ConstrainCap beats Warn beats Continue on ties.
    function castVerdict(
        uint256 submissionId,
        Verdict verdict,
        uint256 newCap,
        string calldata reason
    ) external nonReentrant {
        if (!isValidator[msg.sender]) revert NotJury();

        Submission storage sub = _submission(submissionId);
        if (sub.adjudicated) revert AlreadyAdjudicated();
        if (hasVoted[submissionId][msg.sender]) revert AlreadyVoted();

        if (verdict == Verdict.ConstrainCap) {
            if (newCap == 0) revert InvalidCap();
            uint256 currentMin = minProposedCap[submissionId];
            minProposedCap[submissionId] = currentMin == 0 || newCap < currentMin ? newCap : currentMin;
        } else if (verdict == Verdict.UnlockMilestone) {
            if (newCap == 0) revert UnknownMilestone();
            if (proposedMilestoneId[submissionId] == 0) {
                proposedMilestoneId[submissionId] = newCap;
            }
        } else if (verdict == Verdict.Warn) {
            uint256 points = newCap == 0 ? 1 : newCap;
            if (points > maxThreatPoints[submissionId]) {
                maxThreatPoints[submissionId] = points;
            }
        }

        hasVoted[submissionId][msg.sender] = true;
        voteCounts[submissionId][verdict] += 1;

        emit ValidatorVoteCast(submissionId, msg.sender, verdict, newCap, reason);

        uint256 totalVotes = voteCounts[submissionId][Verdict.Continue]
            + voteCounts[submissionId][Verdict.Warn]
            + voteCounts[submissionId][Verdict.ConstrainCap]
            + voteCounts[submissionId][Verdict.Revoke]
            + voteCounts[submissionId][Verdict.UnlockMilestone];

        if (totalVotes >= verdictThreshold) {
            Verdict winner = _winningVerdict(submissionId);
            uint256 cap = newCap;
            if (winner == Verdict.ConstrainCap) {
                cap = minProposedCap[submissionId];
            } else if (winner == Verdict.UnlockMilestone) {
                cap = proposedMilestoneId[submissionId] == 0 ? newCap : proposedMilestoneId[submissionId];
            } else if (winner == Verdict.Warn) {
                cap = maxThreatPoints[submissionId] == 0 ? (newCap == 0 ? 1 : newCap) : maxThreatPoints[submissionId];
            }
            _applyVerdict(submissionId, winner, cap, reason, msg.sender);
        }
    }

    // -------------------------------------------------------------------------
    // Spend gate (wallet / ERC-7710 caveat enforcer)
    // -------------------------------------------------------------------------

    /// @notice Called by wallets or ERC-7710 caveat enforcers before the next spend leaves.
    function canProceed(uint256 agentId, uint256 amount)
        public
        view
        returns (bool authorized, string memory reason)
    {
        Agent storage agent = agents[agentId];
        if (!agent.registered) return (false, "unknown agent");
        if (agent.paused) return (false, "revoked");
        if (block.timestamp >= agent.deadline) return (false, "deadline exceeded");
        if (block.timestamp >= agent.expiresAt) return (false, "mandate expired");
        if (agent.awaitingVerdict) return (false, "awaiting jury");
        if (agent.lastSubmissionId == 0) return (false, "no submission");
        if (amount > agent.spendCap) return (false, "over cap");
        if (amount > agent.approvedNextSpend) return (false, "not approved");
        if (allowedDestinationCount[agentId] > 0 && agent.approvedDestination == address(0)) {
            return (false, "no approved destination");
        }
        return (true, "");
    }

    /// @notice Destination-aware gate for wallets / ERC-7710 caveat enforcers.
    function canProceedTo(uint256 agentId, uint256 amount, address destination)
        public
        view
        returns (bool authorized, string memory reason)
    {
        (authorized, reason) = canProceed(agentId, amount);
        if (!authorized) return (authorized, reason);

        Agent storage agent = agents[agentId];
        if (allowedDestinationCount[agentId] > 0) {
            if (destination == address(0)) return (false, "destination required");
            if (!allowedDestinations[agentId][destination]) return (false, "destination not whitelisted");
            if (agent.approvedDestination != address(0) && destination != agent.approvedDestination) {
                return (false, "destination not approved");
            }
        }
        return (true, "");
    }

    /// @notice Record that an approved spend actually left the wallet. Clears the green light
    ///         so the agent must submit again before the following transaction.
    function reportSpendExecuted(uint256 agentId, uint256 amount) external {
        _reportSpendExecuted(agentId, amount, agents[agentId].approvedDestination);
    }

    /// @notice Same as the two-arg form, but the destination must pass `canProceedTo`.
    function reportSpendExecuted(uint256 agentId, uint256 amount, address destination) external {
        _reportSpendExecuted(agentId, amount, destination);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return _agent(agentId);
    }

    function getSubmission(uint256 submissionId) external view returns (Submission memory) {
        return _submission(submissionId);
    }

    function getVoteCounts(uint256 submissionId)
        external
        view
        returns (
            uint256 continueVotes,
            uint256 warnVotes,
            uint256 constrainVotes,
            uint256 revokeVotes,
            uint256 unlockVotes
        )
    {
        continueVotes = voteCounts[submissionId][Verdict.Continue];
        warnVotes = voteCounts[submissionId][Verdict.Warn];
        constrainVotes = voteCounts[submissionId][Verdict.ConstrainCap];
        revokeVotes = voteCounts[submissionId][Verdict.Revoke];
        unlockVotes = voteCounts[submissionId][Verdict.UnlockMilestone];
    }

    /// @notice Scan logs + receipts for a 20-byte destination. Tagged `to:` / `destination:` /
    ///         `recipient:` fields win. 64-nibble tx hashes are ignored.
    function extractDestination(string memory logs, string memory receipts)
        public
        pure
        returns (address dest, bool found)
    {
        (address fromReceipts, bool receiptsFound, bool receiptsAmbiguous) = _extractPreferredAddress(receipts);
        (address fromLogs, bool logsFound, bool logsAmbiguous) = _extractPreferredAddress(logs);

        if (receiptsAmbiguous || logsAmbiguous) revert DestinationAmbiguous();
        if (receiptsFound && logsFound && fromReceipts != fromLogs) revert DestinationMismatch();
        if (receiptsFound) return (fromReceipts, true);
        if (logsFound) return (fromLogs, true);
        return (address(0), false);
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _applyVerdict(
        uint256 submissionId,
        Verdict verdict,
        uint256 newCap,
        string memory reason,
        address decidedBy
    ) internal {
        Submission storage sub = _submission(submissionId);
        if (sub.adjudicated) revert AlreadyAdjudicated();

        Agent storage agent = _agent(sub.agentId);
        if (agent.paused) revert AgentPaused();

        if (block.timestamp >= agent.deadline) {
            sub.adjudicated = true;
            sub.finalVerdict = Verdict.Revoke;
            sub.finalReason = "mandate deadline exceeded";
            agent.lastVerdict = Verdict.Revoke;
            _activateKillSwitch(sub.agentId, agent, submissionId);
            emit DeadlineKillSwitchFired(sub.agentId, agent.deadline, block.timestamp);
            emit VerdictApplied(
                submissionId,
                sub.agentId,
                Verdict.Revoke,
                0,
                0,
                decidedBy,
                "mandate deadline exceeded"
            );
            return;
        }

        if (block.timestamp >= agent.expiresAt) revert MandateExpired();

        sub.adjudicated = true;
        sub.finalVerdict = verdict;
        sub.finalReason = reason;

        agent.awaitingVerdict = false;
        agent.lastVerdict = verdict;

        if (verdict == Verdict.Continue) {
            agent.approvedNextSpend = _clampToCap(sub.nextSpendAmount, agent.spendCap);
            agent.approvedDestination = sub.nextTarget;
        } else if (verdict == Verdict.Warn) {
            uint256 points = newCap == 0 ? 1 : newCap;
            agent.warningCount += 1;
            agent.threatScore += points;
            emit ThreatScoreUpdated(sub.agentId, submissionId, points, agent.threatScore, threatThreshold);
            if (agent.threatScore >= threatThreshold) {
                agent.lastVerdict = Verdict.Revoke;
                sub.finalVerdict = Verdict.Revoke;
                sub.finalReason = "threat score exceeded threshold";
                emit ThreatKillSwitchFired(sub.agentId, submissionId, agent.threatScore, threatThreshold);
                _activateKillSwitch(sub.agentId, agent, submissionId);
            } else {
                agent.approvedNextSpend = _clampToCap(sub.nextSpendAmount, agent.spendCap);
                agent.approvedDestination = sub.nextTarget;
            }
        } else if (verdict == Verdict.ConstrainCap) {
            if (newCap == 0) revert InvalidCap();
            if (newCap < agent.spendCap) {
                agent.spendCap = newCap;
            }
            agent.approvedNextSpend = _clampToCap(sub.nextSpendAmount, agent.spendCap);
            agent.approvedDestination = sub.nextTarget;
        } else if (verdict == Verdict.UnlockMilestone) {
            uint256 milestoneId = newCap;
            if (milestoneId == 0 || milestoneId > milestoneCount[sub.agentId]) revert UnknownMilestone();
            Milestone storage ms = milestones[sub.agentId][milestoneId];
            if (ms.completed) revert MilestoneAlreadyCompleted();
            ms.completed = true;
            ms.completedAt = block.timestamp;
            ms.completedSubmissionId = submissionId;
            agent.spendCap += ms.capIncrease;
            agent.approvedNextSpend = _clampToCap(sub.nextSpendAmount, agent.spendCap);
            agent.approvedDestination = sub.nextTarget;
            emit MilestoneUnlocked(sub.agentId, milestoneId, submissionId, ms.capIncrease, agent.spendCap);
        } else {
            // Verdict.Revoke — kill switch
            _activateKillSwitch(sub.agentId, agent, submissionId);
        }

        emit VerdictApplied(
            submissionId,
            sub.agentId,
            sub.finalVerdict,
            agent.spendCap,
            agent.approvedNextSpend,
            decidedBy,
            sub.finalReason
        );
    }

    function _reportSpendExecuted(uint256 agentId, uint256 amount, address destination) internal {
        Agent storage agent = _agent(agentId);
        if (msg.sender != agent.wallet && msg.sender != agent.principal && msg.sender != owner()) {
            revert NotAuthorized();
        }
        if (block.timestamp >= agent.deadline) revert MandateDeadlineExceeded();
        (bool ok, ) = canProceedTo(agentId, amount, destination);
        if (!ok) revert SpendNotAuthorized();

        agent.spendCap -= amount;
        agent.approvedNextSpend = 0;
        emit SpendExecuted(agentId, amount, agent.spendCap);
    }

    function _enforceDestination(
        uint256 agentId,
        string calldata logs,
        string calldata receipts,
        address nextTarget
    ) internal view returns (address resolved) {
        (address extracted, bool found) = extractDestination(logs, receipts);
        resolved = nextTarget;

        if (found) {
            if (resolved == address(0)) {
                resolved = extracted;
            } else if (resolved != extracted) {
                revert DestinationMismatch();
            }
        }

        if (allowedDestinationCount[agentId] > 0) {
            if (resolved == address(0)) revert DestinationRequired();
            if (!allowedDestinations[agentId][resolved]) revert DestinationNotAllowed();
        }
    }

    /// @dev Pause, zero the remaining cap, clear the spend gate, and disable ERC-7710.
    function _activateKillSwitch(uint256 agentId, Agent storage agent, uint256 submissionId) internal {
        agent.paused = true;
        agent.approvedNextSpend = 0;
        agent.spendCap = 0;
        agent.awaitingVerdict = false;
        emit KillSwitchFired(agentId, submissionId, agent.erc7710DelegationHash, agent.delegationManager);
        _revokeDelegation(agentId, agent);
    }

    /// @dev Best-effort ERC-7710 disable. address(0) manager skips the external call.
    function _revokeDelegation(uint256 agentId, Agent storage agent) internal {
        address manager = agent.delegationManager;
        bytes32 delegationHash = agent.erc7710DelegationHash;
        if (manager == address(0) || delegationHash == bytes32(0)) {
            return;
        }

        try IERC7710DelegationManager(manager).disableDelegation(delegationHash) {
            emit DelegationDisableSucceeded(agentId, delegationHash);
        } catch (bytes memory err) {
            emit DelegationDisableFailed(agentId, delegationHash, err);
        }
    }

    function _winningVerdict(uint256 submissionId) internal view returns (Verdict winner) {
        uint256 cContinue = voteCounts[submissionId][Verdict.Continue];
        uint256 cUnlock = voteCounts[submissionId][Verdict.UnlockMilestone];
        uint256 cWarn = voteCounts[submissionId][Verdict.Warn];
        uint256 cConstrain = voteCounts[submissionId][Verdict.ConstrainCap];
        uint256 cRevoke = voteCounts[submissionId][Verdict.Revoke];

        winner = Verdict.Continue;
        uint256 best = cContinue;

        // Equal counts resolve toward the more severe verdict. UnlockMilestone is
        // treated as Continue-adjacent (cap increase) and loses ties to Warn+.
        if (cUnlock > best) {
            best = cUnlock;
            winner = Verdict.UnlockMilestone;
        }
        if (cWarn >= best) {
            best = cWarn;
            winner = Verdict.Warn;
        }
        if (cConstrain >= best) {
            best = cConstrain;
            winner = Verdict.ConstrainCap;
        }
        if (cRevoke >= best) {
            winner = Verdict.Revoke;
        }
    }

    function _extractPreferredAddress(string memory text)
        internal
        pure
        returns (address dest, bool found, bool ambiguous)
    {
        bytes memory data = bytes(text);
        address tagged;
        bool taggedFound;
        address untagged;
        uint256 untaggedUnique;

        uint256 i = 0;
        while (i + 42 <= data.length) {
            if (data[i] == "0" && (data[i + 1] == "x" || data[i + 1] == "X")) {
                (address parsed, bool ok, uint256 consumed) = _parseAddressAt(data, i);
                if (ok) {
                    if (_isTagged(data, i)) {
                        if (taggedFound && tagged != parsed) {
                            return (address(0), false, true);
                        }
                        tagged = parsed;
                        taggedFound = true;
                    } else {
                        if (untaggedUnique == 0) {
                            untagged = parsed;
                            untaggedUnique = 1;
                        } else if (parsed != untagged) {
                            untaggedUnique = 2;
                        }
                    }
                    i += consumed;
                    continue;
                }
            }
            unchecked {
                i += 1;
            }
        }

        if (taggedFound) return (tagged, true, false);
        if (untaggedUnique == 1) return (untagged, true, false);
        if (untaggedUnique >= 2) return (address(0), false, true);
        return (address(0), false, false);
    }

    /// @dev True if the 24 bytes before `idx` contain a destination tag.
    function _isTagged(bytes memory data, uint256 idx) internal pure returns (bool) {
        uint256 start = idx > 24 ? idx - 24 : 0;
        bytes memory window = new bytes(idx - start);
        for (uint256 k = 0; k < window.length; k++) {
            bytes1 c = data[start + k];
            if (c >= "A" && c <= "Z") {
                window[k] = bytes1(uint8(c) + 32);
            } else {
                window[k] = c;
            }
        }
        return _containsTag(window, "to:")
            || _containsTag(window, "to=")
            || _containsTag(window, "destination:")
            || _containsTag(window, "destination=")
            || _containsTag(window, "recipient:")
            || _containsTag(window, "recipient=")
            || _containsTag(window, "to_address:");
    }

    function _containsTag(bytes memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > haystack.length) return false;
        uint256 limit = haystack.length - n.length + 1;
        for (uint256 i = 0; i < limit; i++) {
            bool match_ = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (haystack[i + j] != n[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
    }

    function _parseAddressAt(bytes memory data, uint256 idx)
        internal
        pure
        returns (address parsed, bool ok, uint256 consumed)
    {
        // idx points at '0' of '0x'. Require exactly 40 hex nibbles, not a longer hash.
        if (idx + 42 > data.length) return (address(0), false, 1);
        uint256 hexStart = idx + 2;
        uint256 hexLen = 0;
        uint256 cursor = hexStart;
        while (cursor < data.length && _isHex(data[cursor])) {
            unchecked {
                hexLen += 1;
                cursor += 1;
            }
        }
        if (hexLen != 40) return (address(0), false, cursor > idx ? cursor - idx : 1);

        uint256 value;
        for (uint256 k = 0; k < 40; k++) {
            uint8 nibble = _hexNibble(data[hexStart + k]);
            value = (value << 4) | nibble;
        }
        parsed = address(uint160(value));
        if (parsed == address(0)) return (address(0), false, 42);
        return (parsed, true, 42);
    }

    function _isHex(bytes1 c) internal pure returns (bool) {
        uint8 b = uint8(c);
        return (b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102);
    }

    function _hexNibble(bytes1 c) internal pure returns (uint8) {
        uint8 b = uint8(c);
        if (b >= 48 && b <= 57) return b - 48;
        if (b >= 97 && b <= 102) return b - 87;
        return b - 55;
    }

    function _clampToCap(uint256 amount, uint256 cap) internal pure returns (uint256) {
        return amount > cap ? cap : amount;
    }

    function _agent(uint256 agentId) internal view returns (Agent storage agent) {
        agent = agents[agentId];
        if (!agent.registered) revert UnknownAgent();
    }

    function _submission(uint256 submissionId) internal view returns (Submission storage sub) {
        sub = submissions[submissionId];
        if (sub.submittedAt == 0) revert UnknownSubmission();
    }
}
