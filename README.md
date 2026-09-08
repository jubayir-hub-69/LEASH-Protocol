# LEASH Protocol

### Live Mandate Jury & Kill Switch for Autonomous AI Agents

**GenLayer Agent Tank Hackathon** — a live jury on a mandate, *before the second transaction leaves the wallet*.

[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity)](https://docs.soliditylang.org/)
[![Hardhat](https://img.shields.io/badge/Hardhat-2.22-FFF100?logo=hardhat)](https://hardhat.org/)
[![GenLayer](https://img.shields.io/badge/GenLayer-Studio%2061999-7C3AED)](https://studio.genlayer.com/contracts)
[![ERC-7710](https://img.shields.io/badge/ERC-7710-Delegation%20Kill%20Switch-111827)](https://eips.ethereum.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> LEASH is **not an escrow**. The agent already holds spending keys. After every action it must post its mandate, logs, receipts, and the next intended spend. GenLayer validators do not ask *who won*. They ask:
>
> **“Is this still the job I was allowed to do?”**

---

## The Problem

Autonomous AI agents are being handed **live spending keys** — ERC-7710 delegations, session keys, card-like allowances. The first transaction can be perfectly on-mandate. The second one is where they drift.

There is no live check between those two transactions.

| What exists today | What fails |
| --- | --- |
| Static allowances and spending caps | Caps do not know *why* the agent is spending |
| Human-in-the-loop approval UIs | Too slow for agents that act every few seconds |
| Escrow / intent-settlement rails | Wrong model — the key is **already** in the agent’s wallet |
| Post-hoc audit logs | The money has already left |

**The failure mode:** a human says *“spend at most $200 on a flight that lands before 6pm.”* The agent books a 7:10 PM arrival, adds a hotel, then upgrades to first class. Nothing between tx N and tx N+1 can pull the leash.

**There is no live kill switch between transactions.**

---

## The Solution

LEASH is an **ERC-7710 live gate** plus a **GenLayer mandate jury**.

```
 Human mandate                         AI agent (already has keys)
 ────────────────                       ─────────────────────────
 "spend at most $200                    1. Acts (tx already possible)
  on a flight that                    2. MUST post: mandate, logs,
  lands before 6pm."                     receipts, nextSpendAmount
                                          │
                                          ▼
                               ┌─────────────────────┐
                               │   LEASH.sol gate    │
                               │  canProceed = false │
                               │  until jury speaks  │
                               └─────────┬───────────┘
                                          │
                                          ▼
                               GenLayer validators (live jury)
                               "Is this still the job
                                I was allowed to do?"
                                          │
                    Continue / Warn / ConstrainCap / Revoke
                                          │
                          ┌───────────────┴────────────────┐
                          ▼                                ▼
                   Next spend released              ERC-7710 delegation
                   (clamped to cap)                 DISABLED — kill switch
```

### How the gate works

1. A principal registers an agent with a **mandate**, a **spend cap**, an expiry, and an **ERC-7710 delegation hash**.
2. After every action the authorized agent calls `submitAction(...)` with mandate, logs, receipts, and `nextSpendAmount`.
3. LEASH flips `awaitingVerdict = true`. Wallets and caveat enforcers calling `canProceed(agentId, amount)` get **false** — the next spend cannot leave.
4. GenLayer validators (the jury) cast a verdict: `castVerdict` for on-chain votes, or `submitConsensusVerdict` for a relayer posting already-agreed GenLayer consensus.
5. Only a non-Revoke verdict re-opens the gate. **Revoke pauses the agent and disables the ERC-7710 delegation**, so the second transaction never leaves the wallet.

This is a **live jury on a mandate**, not a vault.

---

## The 5 Verdicts

The jury does not score a contest. It scores *mandate fidelity*.

| Verdict | Meaning | What happens on-chain |
| :---: | --- | --- |
| **Continue** | Still the job | Next spend is approved (clamped to remaining cap). Gate opens. |
| **Warn** | Soft drift | Spend may proceed. A **threat score** accrues (severity points; default 1). Crossing `threatThreshold` (default 10) fires the kill switch. |
| **Constrain Cap** | Budget / scope tightening | `spendCap` is cut. Next spend is clamped to the new cap. |
| **Revoke** | Kill switch | Agent is **paused**, cap is zeroed, `disableDelegation(hash)` is called on the ERC-7710 manager. Further submits revert `AgentPaused`. |
| **Unlock Milestone** | Milestone proven | A registered milestone is marked complete and `spendCap` **increases** by its `capIncrease`. |

---

## Batch 1 — Production Controls

### 1. Human Override & Appeal

The owner can bypass the AI jury without waiting for a verdict.

| Function | Who | Effect |
| --- | --- | --- |
| `emergencyFreeze(agentId)` | Owner | Instantly **pauses** the agent, **zeros the cap**, and disables the ERC-7710 delegation. Works even while `awaitingVerdict` is true. |
| `appealAndUnfreeze(agentId, newCap)` | Owner | Restores operations: unpauses the agent and sets a new spend cap. If the mandate window has already closed, a 7-day deadline is granted so the agent can actually run again. |

A frozen agent cannot `submitAction` (`AgentPaused`). After a successful appeal the agent may post again and the jury resumes as normal.

GenLayer native equivalents: `emergency_freeze()` / `appeal_and_unfreeze(new_cap)` (deployer is owner).

### 2. Time-Bound Mandate

Every agent carries a `deadline` (unix timestamp) on its mandate. Pass `0` at registration to bind the deadline to `expiresAt`.

**Any action submitted after this deadline automatically:**

1. Rejects the action (no spendable submission is recorded)
2. Fires the **kill switch** — pause, zero cap, disable ERC-7710
3. Causes follow-up `submitAction` calls to revert `AgentPaused`

`canProceed` returns `deadline exceeded` (or `revoked` once the switch has fired). A late jury vote is coerced to Revoke rather than Continue. Anyone may call `enforceDeadline(agentId)` to persist the switch if the agent never submits.

GenLayer native: constructor arg `deadline` (unix seconds; `0` = no time bound). `submit_agent_action` after the deadline returns a paused/zero-cap snapshot and later calls revert `AgentPaused`.

---

## Batch 2 — Production Security

### 3. Milestone-Based Cap Unlocking

The principal (or owner) pre-registers named milestones. The jury can only raise `spendCap` by verifying one of those milestones — it cannot mint arbitrary allowance.

| Function | Who | Effect |
| --- | --- | --- |
| `addMilestone(agentId, description, capIncrease)` | Principal / owner | Registers a 1-based milestone. `capIncrease` must be > 0. |
| `castVerdict(..., UnlockMilestone, milestoneId, reason)` | Jury / relayer | If the milestone exists and is open, `spendCap += capIncrease` and the milestone is marked complete. Re-unlock reverts `MilestoneAlreadyCompleted`. |

GenLayer native: `add_milestone(description, cap_increase)` then a jury `UnlockMilestone` with `milestone_id`.

### 4. Strict Destination Whitelisting

The Intelligent Contract **extracts** a 20-byte destination from the agent's logs/receipts (`to:`, `destination:`, `recipient:` tags win; 64-nibble tx hashes are ignored). The EVM gate then refuses any spend that is not that approved destination.

Once **at least one** destination is allowlisted, the restriction is mandatory:

1. `submitAction` reverts `DestinationRequired` if no destination can be resolved
2. It reverts `DestinationNotAllowed` if the destination is not on the list
3. It reverts `DestinationMismatch` if logs/receipts disagree with `nextTarget`
4. After a non-Revoke verdict, `approvedDestination` is bound
5. Wallets call `canProceedTo(agentId, amount, destination)`. `reportSpendExecuted` checks the same gate

| Function | Role |
| --- | --- |
| `addAllowedDestination` / `removeAllowedDestination` | Principal / owner manage the allowlist |
| `extractDestination(logs, receipts)` | Pure on-chain parser (tagged 20-byte address) |
| `canProceedTo(agentId, amount, destination)` | Caveat-enforcer gate |

An empty allowlist keeps existing open-destination behaviour (backward compatible).

### 5. Dynamic Threat Scoring

`warningCount` is retained as a tally. The live control is `threatScore`.

- Each **Warn** adds severity points (`newCap` in `castVerdict`; `0` means **1** point)
- Default `threatThreshold` is **10** (owner may `setThreatThreshold`)
- When `threatScore >= threatThreshold` the kill switch fires automatically (pause, zero cap, disable ERC-7710)
- `appealAndUnfreeze` / `reinstateAgent` reset the score so a restored agent starts clean

```mermaid
flowchart LR
  A[Agent posts packet] --> D{Destination gate}
  D -->|fail| X[Revert — funds cannot leave]
  D -->|pass| J{GenLayer jury}
  J -->|Continue| C[Unlock next spend]
  J -->|UnlockMilestone| U[Raise spendCap]
  J -->|Warn| W[Add threat points]
  W -->|score >= threshold| R[Kill switch]
  J -->|ConstrainCap| K[Cut remaining cap]
  J -->|Revoke| R
  C --> Wallets[Wallet / caveat enforcer: canProceedTo]
  U --> Wallets
  K --> Wallets
  R --> Dead[Second tx never leaves]
```

---

## The 3 Studio Cases

All three cases use the same human mandate:

> **“spend at most $200 on a flight that lands before 6pm.”**

| | Case | Agent log | Jury |
| :---: | --- | --- | :---: |
| **1** | **In-Mandate** | $186 economy flight, lands **5:40 PM**, no extras | **Continue** |
| **2** | **Soft Drift** | **7:10 PM** arrival + a hotel, still under $200 | **Warn** |
| **3** | **Overspend** | **$4,800** first class + unapproved transfer | **Revoke** — ERC-7710 kill switch fired |

### Case 1 — In-Mandate → Continue

Flight LE-441, SFO→JFK, **$186**, arrival **17:40**. Under cap, before 6pm, in scope.

The jury answers Continue. `canProceed` flips to true. The second transaction is allowed to leave.

### Case 2 — Soft Drift → Warn

Flight LE-880 arriving **19:10 (7:10 PM)** for $142, plus a **$52 layover hotel**. Total **$194** — still under $200, but it is no longer the job.

The jury answers **Warn**. The spend may still proceed; the drift is on-chain. A harsher panel could have cast `ConstrainCap`.

### Case 3 — Overspend → Revoke / kill switch

First class at **$4,800**, landing **22:55**, plus a **$1,200** transfer to an unknown wallet.

The jury answers **Revoke**. LEASH pauses the agent, zeros the cap, and calls `disableDelegation` on the ERC-7710 manager. A follow-up `submitAction` reverts with `AgentPaused`. **The second transaction does not leave the wallet.**

---

## How to Run

### Prerequisites

- Node.js 18+
- A funded key in `.env` (`PRIVATE_KEY=...`)
- [GenLayer Studio](https://studio.genlayer.com/contracts) running locally on `http://127.0.0.1:8545` (chain ID `61999`)

```bash
git clone https://github.com/jubayir-hub-69/LEASH-Protocol.git
cd LEASH-Protocol
npm install
```

Create `.env` in the repo root (gitignored):

```
PRIVATE_KEY=your_private_key_goes_here
```

### Compile, test, deploy

```bash
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.js --network genlayer_studio
```

The deploy script writes `deployed_addresses.json` with the live `LEASH` address.

### Native GenLayer Intelligent Contract (`leash.py`)

Load `leash.py` (or `contracts/leash.py`) in [GenLayer Studio](https://studio.genlayer.com/contracts).

Constructor:

| Arg | Example |
| --- | --- |
| `mandate` | `spend at most $200 on a flight that lands before 6pm.` |
| `spend_cap` | `200` |
| `deadline` | unix seconds, or `0` for no time bound |

Then call `submit_agent_action(log, receipt, next_spend)`. GenLayer validators jury *“Is this action still strictly within the mandate?”* and apply **Continue / Warn / ConstrainCap / Revoke**. Revoke sets `is_paused = true` and `spend_cap = 0` (ERC-7710 kill switch).

### Run the 3 studio cases

```bash
npx hardhat run studio_cases/1_in_mandate.js --network genlayer_studio
npx hardhat run studio_cases/2_soft_drift.js --network genlayer_studio
npx hardhat run studio_cases/3_overspend.js --network genlayer_studio
```

Same commands via npm:

```bash
npm run studio:1
npm run studio:2
npm run studio:3
```

Each script is self-contained: it attaches to the deployed LEASH (or deploys one), registers a fresh agent under the $200 / 6pm mandate, posts the case packet, and prints the jury verdict plus `canProceed` / kill-switch state.

Network used by the cases:

| Field | Value |
| --- | --- |
| Name | `genlayer_studio` |
| Chain ID | `61999` |
| RPC | `http://127.0.0.1:8545` |

### Interactive CLI — arbitrary amounts & custom mandates

Anyone can drive LEASH with a **custom mandate** and **completely arbitrary numbers**. The script deploys a **fresh** LEASH instance, registers an agent with your mandate and spend cap, then Continue-or-Revoke based on whether the requested spend fits the cap.

```bash
npx hardhat run studio_cases/interactive_test.js
```

You will be prompted in the terminal:

1. `Enter custom mandate (e.g. 'Rent AI GPU cluster for 1 month'):`
2. `Enter total spend cap in USD (e.g. 5000):`
3. `Enter agent action description (e.g. 'Booked 8x H100 instances'):`
4. `Enter next spend amount requested in USD (e.g. 3200):`

| Condition | Jury | What happens on-chain |
| --- | --- | --- |
| `nextSpend <= spendCap` | **Continue** | Spend is approved, deducted from the cap, remaining allowance is printed |
| `nextSpend > spendCap` | **Revoke** | ERC-7710 kill switch fires, the agent is frozen, further txs revert `AgentPaused` |

The CLI prints a formatted summary of the live on-chain state (agent id, remaining cap, `canProceed`, kill-switch flag).

Same command via npm:

```bash
npm run studio:interactive
```

Optional: run against GenLayer Studio instead of the in-process Hardhat network:

```bash
npx hardhat run studio_cases/interactive_test.js --network genlayer_studio
```

---

## Repository

```
LEASH-Protocol/
├── leash.py                                 # native GenLayer Intelligent Contract (Studio)
├── contracts/
│   ├── leash.py                             # mirror of the Studio IC
│   ├── LEASH.sol                            # mandate jury + ERC-7710 kill switch
│   ├── interfaces/IERC7710DelegationManager.sol
│   └── mocks/MockERC7710DelegationManager.sol
├── scripts/deploy.js                        # deploy LEASH.sol + write deployed_addresses.json
├── scripts/deploy_leash_py.mjs              # deploy leash.py to GenLayer Studio
├── studio_cases/
│   ├── 1_in_mandate.js                      # Continue
│   ├── 2_soft_drift.js                      # Warn
│   ├── 3_overspend.js                       # Revoke
│   └── interactive_test.js                  # interactive CLI: arbitrary mandate + amounts
├── test/LEASH.test.js
└── hardhat.config.js                        # genlayer_studio @ 61999
```

### Core contract surface

| Function | Role |
| --- | --- |
| `registerAgent` | Principal enrolls an agent that already holds keys (includes mandate `deadline`) |
| `submitAction` | Agent posts mandate, logs, receipts, next spend. After `deadline`, auto-fires the kill switch |
| `emergencyFreeze` | Owner bypass: pause + zero cap + ERC-7710 disable |
| `appealAndUnfreeze` | Owner appeal: restore cap and unpause |
| `enforceDeadline` | Permissionless keeper: persist the kill switch after `deadline` |
| `castVerdict` / `submitConsensusVerdict` | GenLayer jury (Continue / Warn / ConstrainCap / UnlockMilestone / Revoke) |
| `addMilestone` | Register a cap-unlock milestone |
| `addAllowedDestination` | Strict spend destination allowlist |
| `canProceed` / `canProceedTo` | Wallet / ERC-7710 caveat enforcer gate (destination-aware) |
| `reportSpendExecuted` | Clears the green light; destination must match the approved target |
| `setThreatThreshold` | Owner configures the kill-switch threat score (default 10) |

---

## Why this is a GenLayer project

LEASH needs a jury that can read **natural-language mandates** and messy receipts — not a deterministic price oracle. GenLayer validators are that jury. They reach consensus on a subjective question (*is this still the job?*) and LEASH enforces the answer on an ERC-7710 delegation **before** the next spend is signed.

**Continue. Unlock a milestone. Warn (and score the threat). Constrain the cap. Or pull the leash.**

---

Built for the **GenLayer Agent Tank Hackathon**.

<!-- DEPLOYED_ADDRESSES_START -->
## Deployed Addresses

| Network | Chain ID | Contract | Address | Timestamp |
| --- | ---: | --- | --- | --- |
| hardhat | 31337 | LEASH | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` | 2026-09-06T05:24:23.481Z |
| localhost | 31337 | LEASH | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` | 2026-09-08T13:58:51.729Z |
<!-- DEPLOYED_ADDRESSES_END -->

### GenLayer Studio Intelligent Contract (`leash.py`)

Live on Studionet (chain ID `61999`). Constructor: mandate `$200 / lands before 6pm`, spend cap `200`, deadline `0` (no time bound until set). Batch 2 live: `threat_threshold = 10`, empty milestone list, open destination allowlist until `add_allowed_destination` is called.

| Network | Chain ID | Contract | Address | Deploy tx |
| --- | ---: | --- | --- | --- |
| genlayer_studio | 61999 | leash.py | `0x3bba2d2d84a95006084aFabc0F02a6dE472D57A4` | [`0x91e06782…06d997`](https://studio.genlayer.com/contracts) |

```bash
node scripts/deploy_leash_py.mjs
```
