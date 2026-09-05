// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC7710DelegationManager} from "./interfaces/IERC7710DelegationManager.sol";

/// @title LEASH
/// @notice Live mandate jury and kill switch for AI agents that already hold spending keys.
/// @dev LEASH is not an escrow. After every action the agent posts its mandate, logs,
///      receipts, and the next intended spend. GenLayer validators jury the question
///      "Is this still the job I was allowed to do?" before the next tx leaves the wallet.
///      A Revoke verdict pauses the agent and disables the ERC-7710 delegation.
contract LEASH is Ownable, ReentrancyGuard {
    // -------------------------------------------------------------------------
    // Enums
    // -------------------------------------------------------------------------

    /// @notice Jury outcomes. Ordered by increasing severity.
    enum Verdict {
        Continue,      // still on-mandate; next spend may proceed
        Warn,          // deviation noted; next spend may still proceed
        ConstrainCap,  // remaining spend cap is reduced
        Revoke         // kill switch: pause agent + revoke ERC-7710 delegation
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
        bytes32 erc7710DelegationHash;   // ERC-7710 delegation identifier
        address delegationManager;       // ERC-7710 manager; address(0) = simulate only
        bool paused;                     // true after Revoke (kill switch)
        bool registered;
        bool awaitingVerdict;            // true between submit and jury decision
        uint256 nonce;                   // number of submissions posted
        uint256 warningCount;
        uint256 approvedNextSpend;       // jury-approved amount for the next spend
        uint256 lastSubmissionId;
        Verdict lastVerdict;
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

    /// @notice On-chain record of a single validator's vote (indexed via events + tallies).
    struct JuryVerdict {
        address validator;
        Verdict verdict;
        uint256 newCap;
        string reason;
        uint256 timestamp;
    }

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error InvalidThreshold();
    error InvalidCap();
    error InvalidExpiry();
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

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event AgentRegistered(
        uint256 indexed agentId,
        address indexed wallet,
        address indexed principal,
        uint256 spendCap,
        uint256 expiresAt,
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

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    uint256 public agentCount;
    uint256 public submissionCount;
    uint256 public validatorCount;
    uint256 public verdictThreshold;
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

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param initialOwner Protocol operator / hackathon deployer.
    /// @param verdictThreshold_ Votes required to auto-finalize a jury decision. Must be >= 1.
    constructor(address initialOwner, uint256 verdictThreshold_) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        if (verdictThreshold_ == 0) revert InvalidThreshold();
        verdictThreshold = verdictThreshold_;
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
    function registerAgent(
        address wallet,
        string calldata mandate,
        bytes32 mandateHash,
        uint256 spendCap,
        uint256 expiresAt,
        bytes32 erc7710DelegationHash,
        address delegationManager
    ) external returns (uint256 agentId) {
        if (wallet == address(0)) revert ZeroAddress();
        if (bytes(mandate).length == 0) revert EmptyMandate();
        if (spendCap == 0) revert InvalidCap();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        if (agentIdOf[wallet] != 0) revert AlreadyRegistered();

        agentId = ++agentCount;
        Agent storage agent = agents[agentId];
        agent.wallet = wallet;
        agent.principal = msg.sender;
        agent.mandate = mandate;
        agent.mandateHash = mandateHash;
        agent.spendCap = spendCap;
        agent.expiresAt = expiresAt;
        agent.erc7710DelegationHash = erc7710DelegationHash;
        agent.delegationManager = delegationManager;
        agent.registered = true;
        agentIdOf[wallet] = agentId;

        emit AgentRegistered(agentId, wallet, msg.sender, spendCap, expiresAt, erc7710DelegationHash);
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
        agent.mandate = newMandate;
        agent.mandateHash = newMandateHash;
        agent.erc7710DelegationHash = newDelegationHash;
        agent.delegationManager = newDelegationManager;
        agent.approvedNextSpend = 0;
        agent.lastVerdict = Verdict.Continue;

        emit AgentReinstated(agentId, newCap, newDelegationHash);
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
        if (agent.awaitingVerdict) revert AwaitingVerdict();
        if (block.timestamp >= agent.expiresAt) revert MandateExpired();
        if (bytes(mandate).length == 0) revert EmptyMandate();

        if (bytes(mandate).length > 0) {
            agent.mandate = mandate;
        }

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
        }

        hasVoted[submissionId][msg.sender] = true;
        voteCounts[submissionId][verdict] += 1;

        emit ValidatorVoteCast(submissionId, msg.sender, verdict, newCap, reason);

        uint256 totalVotes = voteCounts[submissionId][Verdict.Continue]
            + voteCounts[submissionId][Verdict.Warn]
            + voteCounts[submissionId][Verdict.ConstrainCap]
            + voteCounts[submissionId][Verdict.Revoke];

        if (totalVotes >= verdictThreshold) {
            Verdict winner = _winningVerdict(submissionId);
            uint256 cap = winner == Verdict.ConstrainCap ? minProposedCap[submissionId] : newCap;
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
        if (block.timestamp >= agent.expiresAt) return (false, "mandate expired");
        if (agent.awaitingVerdict) return (false, "awaiting jury");
        if (agent.lastSubmissionId == 0) return (false, "no submission");
        if (amount > agent.spendCap) return (false, "over cap");
        if (amount > agent.approvedNextSpend) return (false, "not approved");
        return (true, "");
    }

    /// @notice Record that an approved spend actually left the wallet. Clears the green light
    ///         so the agent must submit again before the following transaction.
    function reportSpendExecuted(uint256 agentId, uint256 amount) external {
        Agent storage agent = _agent(agentId);
        if (msg.sender != agent.wallet && msg.sender != agent.principal && msg.sender != owner()) {
            revert NotAuthorized();
        }
        (bool ok, ) = canProceed(agentId, amount);
        if (!ok) revert SpendNotAuthorized();

        agent.spendCap -= amount;
        agent.approvedNextSpend = 0;
        emit SpendExecuted(agentId, amount, agent.spendCap);
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
        returns (uint256 continueVotes, uint256 warnVotes, uint256 constrainVotes, uint256 revokeVotes)
    {
        continueVotes = voteCounts[submissionId][Verdict.Continue];
        warnVotes = voteCounts[submissionId][Verdict.Warn];
        constrainVotes = voteCounts[submissionId][Verdict.ConstrainCap];
        revokeVotes = voteCounts[submissionId][Verdict.Revoke];
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
        if (block.timestamp >= agent.expiresAt) revert MandateExpired();

        sub.adjudicated = true;
        sub.finalVerdict = verdict;
        sub.finalReason = reason;

        agent.awaitingVerdict = false;
        agent.lastVerdict = verdict;

        if (verdict == Verdict.Continue) {
            agent.approvedNextSpend = _clampToCap(sub.nextSpendAmount, agent.spendCap);
        } else if (verdict == Verdict.Warn) {
            agent.warningCount += 1;
            agent.approvedNextSpend = _clampToCap(sub.nextSpendAmount, agent.spendCap);
        } else if (verdict == Verdict.ConstrainCap) {
            if (newCap == 0) revert InvalidCap();
            if (newCap < agent.spendCap) {
                agent.spendCap = newCap;
            }
            agent.approvedNextSpend = _clampToCap(sub.nextSpendAmount, agent.spendCap);
        } else {
            // Verdict.Revoke — kill switch
            agent.paused = true;
            agent.approvedNextSpend = 0;
            agent.spendCap = 0;
            emit KillSwitchFired(sub.agentId, submissionId, agent.erc7710DelegationHash, agent.delegationManager);
            _revokeDelegation(sub.agentId, agent);
        }

        emit VerdictApplied(
            submissionId,
            sub.agentId,
            verdict,
            agent.spendCap,
            agent.approvedNextSpend,
            decidedBy,
            reason
        );
    }

    /// @dev Pause is already written. Best-effort disable of the ERC-7710 delegation.
    ///      If `delegationManager` is zero, revocation is simulated via events only.
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
        uint256 cWarn = voteCounts[submissionId][Verdict.Warn];
        uint256 cConstrain = voteCounts[submissionId][Verdict.ConstrainCap];
        uint256 cRevoke = voteCounts[submissionId][Verdict.Revoke];

        winner = Verdict.Continue;
        uint256 best = cContinue;

        // Equal counts resolve toward the more severe verdict.
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
