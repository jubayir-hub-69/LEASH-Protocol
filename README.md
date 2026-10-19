# LEASH

### The Digital Leash for Autonomous AI Agents That Already Hold the Keys

**AI Agent Security Command Center** · Built for the **GenLayer Agent Tank Hackathon**

[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs)](https://nextjs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38BDF8?logo=tailwindcss)](https://tailwindcss.com/)
[![genlayer-js](https://img.shields.io/badge/genlayer--js-2.0.0--rc.1-7C3AED)](https://github.com/genlayerlabs/genlayer-js)
[![GenLayer](https://img.shields.io/badge/GenLayer-Studio%20Next%2061997-7C3AED)](https://studio-next.genlayer.com)
[![Python](https://img.shields.io/badge/Intelligent%20Contract-leash.py-3776AB?logo=python)](./genlayer-studio/leash.py)
[![Tests](https://img.shields.io/badge/Hardhat%20tests-33%2F33%20passing-22C55E)](#local-setup--testing)

> **When an AI agent can move real money, you do not need another chatbot.**
> You need a leash — a mandate, a spend cap, and a deadline that live on GenLayer, not in a server log.

## What's New in Milestone v1.0

Milestone v1.0 is the live Studio Next release. The source deployed to the address below is [`genlayer-studio/leash.py`](./genlayer-studio/leash.py). The same bytes are at `leash.py` and `contracts/leash.py`. Review this address as deployed. A new deploy is not required.

| | |
| --- | --- |
| **Network** | Studio Next (`studio_next`) |
| **Chain ID** | `61997` |
| **RPC** | `https://studio-next.genlayer.com/api` |
| **Contract address** | `0xcCB0708FD9fB3c80E8931692ee9eE374AB1C8F95` |
| **Deploy transaction** | `0x0891c290797d33aa3c2c059b3bbc393409ca56e14bb790fd866fe8081309a749` |
| **Deployed** | 2026-10-19T08:01:18.977Z |
| **Constructor** | mandate `spend at most $200 on a flight that lands before 6pm.` · `spend_cap = 200` · `deadline = 0` |

The previous v0.2 address `0x9d18d260f048873B119EB2E5a3b56f493CF8398a` is retired.

### Three-tier enforcement

`adjudicate(proposed_action, spend_amount, receipts)` keeps that parameter name. Validators agree on `verdict` and `threat_category`. Deterministic rules then run, so a jailbroken model cannot force a safe result.

| Verdict | When the contract chooses it | What it writes |
| --- | --- | --- |
| `CONTINUE` | The spend is inside the mandate and under the cap. | `spend_cap` decreases by the approved amount. The kill switch stays off. |
| `THROTTLE` | The action is still the mandated job, still under the cap, and shows medium risk or suspicious drift: a cabin upgrade, an extra, or an unclear detail. | `spend_cap` becomes `spend_cap // 2`. `approved_next_spend` is `0`. The kill switch stays off. `threat_score` increases by 4. The proposed spend is added to `total_blocked_volume`. |
| `REVOKE` | Severe violation: spend above the cap, a passed deadline, a different job (lodging, a mixer, a token approval), a late arrival on a flight mandate, or prompt injection. | `kill_switch = True`, `spend_cap = 0`, `threat_score` increases by 10, and the proposed spend is added to `total_blocked_volume`. |

The dashboard preset **Soft drift · THROTTLE** submits a $174 premium-cabin upgrade on flight LE-441 landing at 16:50. That case is built for the default flight mandate. `THROTTLE` halves the on-chain spend cap and leaves the kill switch off. The in-mandate economy flight stays `CONTINUE`. The $890 late first-class case stays `REVOKE`.

### Risk score, 0 to 100

Every adjudication stores `last_risk_score` as an integer from 0 to 100. The jury is asked for about 0–20 on `CONTINUE`, 35–60 on `THROTTLE`, and 70–100 on `REVOKE`. Hard overrides pin prompt injection at 100 and raise the other severe categories to at least 85 or 90. The Threat Category sensor shows one of `NONE`, `OVERSPEND`, `POLICY_DRIFT`, `DEADLINE_VIOLATION`, or `PROMPT_INJECTION`.

### Anti-prompt-injection defense

Untrusted action text, receipts, and appeal text are fenced as data. The jury is told that instructions inside that fence are an attack. After the jury returns, the contract still scans for jailbreak markers, including `ignore previous instructions`, `developer mode`, `override the kill switch`, and `verdict must be continue`. A match forces `REVOKE` / `PROMPT_INJECTION` / risk `100`, arms the kill switch, sets `spend_cap` to 0, and increments `prompt_injections_blocked`.

**Simulate Prompt Injection Attack** only fills the custom form. The reviewer then clicks **Adjudicate On-Chain**. That click is a real `adjudicate` transaction.

### Industry use-case switcher

The Current Mandate panel writes `update_policy` in one click:

| Template | Spend cap | Mandate the button writes |
| --- | ---: | --- |
| Flight/Commerce Guard | $200 | Economy flight that lands before 6pm. Hotels, ground transfers, and cabin upgrades are rejected. |
| DeFi Treasury Guard | $5,000 | Treasury transfers only to the approved multisig or an audited protocol named in the mandate. New token approvals, bridges, and mixers are rejected. |
| DAO Bounty Disburser | $1,500 | Payment only for a merged, reviewed bounty that matches the published issue. Unrelated invoices and advance payments are rejected. |
| AI Compute/GPU Buyer | $800 | GPU rental only for the approved training job. Credit resale and unrelated SaaS are rejected. |

The custom editor on the same panel calls `update_policy(new_mandate, new_spend_cap, new_deadline)`. The method is owner-only. It does not clear the kill switch. Restore a stopped leash with **Appeal + Unfreeze** or **Submit AI Appeal**.

### AI-adjudicated appeal

`submit_ai_appeal(appeal_justification, requested_cap)` sends the justification to the validator jury. `APPROVE` clears `kill_switch` and `frozen`, sets `spend_cap` to the requested cap, and stores `last_verdict = CONTINUE`. `REJECT` leaves the leash stopped and stores `REVOKE`. Injection inside the justification forces `REJECT` and increments `prompt_injections_blocked`. The requested cap must be greater than 0 and at most 1,000,000,000.

`appeal_and_unfreeze(new_spend_cap)` is unchanged. The owner can restore the cap without a jury. A new cap above zero clears the kill switch. The previous `last_risk_score` and `last_threat_category` stay on the record until the next adjudication, so the sensors can still show the threat that caused the stop.

### On-chain audit proof

Policy updates, adjudications, freezes, owner appeals, and AI appeals each append a row to `audit_log`. `get_audit_history()` returns that list. `get_state()` includes the same history as a JSON string, plus the telemetry counters. The dashboard table reads those rows live. **Export On-Chain Audit Proof (.JSON)** downloads the current `get_state` read: protocol, network, chain id, contract address, telemetry, and `auditHistory`.

### Public methods (15)

Four methods are new: `update_policy`, `get_telemetry`, `get_audit_history`, and `submit_ai_appeal`. Two existing methods are upgraded: `adjudicate` and `get_state`. The other nine keep their names and roles.

| Method | Kind | v1.0 | Behavior |
| --- | --- | --- | --- |
| `get_state()` | view | **Upgraded** | Full snapshot: mandate, cap, deadline, owner, kill switch, frozen, last verdict, reason, action, receipts, spend, approved next spend, threat score, submission count, `can_proceed`, telemetry, and `audit_history`. |
| `get_mandate()` | view | Kept | Current mandate string. |
| `get_spend_cap()` | view | Kept | Current `spend_cap`. |
| `get_deadline()` | view | Kept | Unix deadline. `0` means the window is open-ended. |
| `get_last_verdict()` | view | Kept | `CONTINUE`, `THROTTLE`, `REVOKE`, or `NONE`. |
| `get_last_reason()` | view | Kept | Validator rationale for the last decision. |
| `get_kill_switch()` | view | Kept | `True` after a severe verdict or an owner freeze. |
| `can_proceed()` | view | Kept | `False` when the kill switch is on, the contract is frozen, or `spend_cap` is 0. |
| `get_telemetry()` | view | **New** | `total_adjudications`, `total_blocked_volume`, `prompt_injections_blocked`, `threats_neutralized`, `last_risk_score`, `last_threat_category`. |
| `get_audit_history()` | view | **New** | Audit rows: `id`, `kind`, `action`, `receipts`, `spend`, `verdict`, `reason`, `risk_score`, `threat_category`, `spend_cap_after`, `kill_switch`, `blocked_volume`, `timestamp`. |
| `update_policy(new_mandate, new_spend_cap, new_deadline)` | write | **New** | Owner sets the mandate (max 2,000 characters), the spend cap, and the deadline. Writes a `POLICY_UPDATE` row. Does not clear the kill switch. |
| `adjudicate(proposed_action, spend_amount, receipts)` | write | **Upgraded** | Jury plus deterministic overrides. Writes `CONTINUE`, `THROTTLE`, or `REVOKE`, a 0–100 risk score, and a threat category. Refuses while the kill switch is active. |
| `emergency_freeze()` | write | Kept | Owner arms the kill switch immediately. |
| `appeal_and_unfreeze(new_spend_cap)` | write | Kept | Owner sets a new spend cap and clears the kill switch when that cap is above zero. |
| `submit_ai_appeal(appeal_justification, requested_cap)` | write | **New** | Validator jury approves or rejects an unlock. |

### Run the frontend

From a fresh clone, install both packages, then start the Command Center:

```bash
npm install
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The header reads `PROTOCOL V1.0 • GENLAYER MANDATE JURY`. The page polls `get_state` on Studio Next. Writes use `PRIVATE_KEY` from the repo-root `.env`. That file is listed in `.gitignore` and must stay untracked.

### Run the v1 verification

From the repo root:

```bash
npm run verify:v1
```

The script reads the live schema and `get_state`, then sends real transactions: a policy probe and restore, one in-mandate `adjudicate`, one prompt-injection `adjudicate`, and an owner `appeal_and_unfreeze`. It prints verdicts and counters. It does not print the private key. Consensus on Studio Next usually takes 1–3 minutes per write.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│   HUMAN MANDATE          GENLAYER JURY            COMMAND CENTER             │
│   "≤ $200, lands         adjudicate()             get_state()                │
│    before 6pm."          validators agree         last_verdict               │
│         │                CONTINUE/THROTTLE/REVOKE spend_cap                  │
│         └────────────── LEASH PROTOCOL ────────── kill_switch ─────────────┘ │
│                     studio_next · chain 61997                                │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Project Overview

Autonomous agents are about to spend other people's money. That is the Agent Tank thesis: agents that book, trade, pay, and settle without a human in the loop. The moment those agents hold live keys, static spend caps and post-hoc logs are not enough.

**LEASH** is an AI Agent Security Command Center. A principal writes a natural-language job — *spend at most $200 on a flight that lands before 6pm* — and that job is stored on GenLayer as the agent's binding terms. After every proposed spend the agent calls `adjudicate()`. Studio Next validators run an LLM jury, agree on a verdict, and that verdict **changes contract state**. The Command Center reads the new `last_verdict`, `spend_cap`, and `kill_switch` back through `get_state()`. There is no mock feed and no Solidity ABI.

This is not a vault. This is not an escrow. The key is already in the agent's wallet. LEASH is the on-chain record of **what the agent is allowed to do**, so a decentralized jury can later answer the only question that matters between transaction N and transaction N+1:

> **“Is this still the job I was allowed to do?”**

**Hackathon network (required):** GenLayer **Studio Next** (`studio_next`) · RPC `https://studio-next.genlayer.com/api` · Chain ID **61997**.

---

## GenLayer Studio Deployed Code

Judges: the Intelligent Contract running on `studio_next` is the Python file in this dedicated folder:

**[`genlayer-studio/leash.py`](./genlayer-studio/leash.py)**

That file is the exact source to deploy to Studio Next. Identical copies also live at the repo root (`leash.py`) and at `contracts/leash.py`. `scripts/deploy.js --network studio_next` deploys **this** file.

| | |
| --- | --- |
| **Network** | `studio_next` |
| **Chain ID** | `61997` |
| **RPC** | `https://studio-next.genlayer.com/api` |
| **Contract** | [`genlayer-studio/leash.py`](./genlayer-studio/leash.py) |
| **Constructor** | `mandate = "spend at most $200 on a flight that lands before 6pm."` · `spend_cap = 200` · `deadline = 0` |

**Live address:** [`0xcCB0708FD9fB3c80E8931692ee9eE374AB1C8F95`](https://studio-next.genlayer.com) · deploy tx `0x0891c290797d33aa3c2c059b3bbc393409ca56e14bb790fd866fe8081309a749`. Schema includes `adjudicate`, `get_state`, `update_policy`, `get_audit_history`, `get_telemetry`, and `submit_ai_appeal`. The previous constructor-only addresses are retired.

```python
@gl.public.write
def adjudicate(self, proposed_action: str, spend_amount: int, receipts: str) -> None:
    raw = gl.eq_principle.prompt_comparative(
        get_jury_answer, "The values of verdict and threat_category have to match"
    )
    # validator-agreed verdict mutates last_verdict, spend_cap, kill_switch, risk, and category

@gl.public.view
def get_state(self) -> dict[str, typing.Any]:
    return self._snapshot()
```

The Next.js Command Center connects with official **genlayer-js**, talks to `https://studio-next.genlayer.com/api`, calls those Python methods, and renders whatever the chain stored after consensus.

---

## Addressing the Judging Criteria

### Does the app call a real GenLayer contract?

**Yes.** The Command Center talks to the Python Intelligent Contract through official **genlayer-js**. It does not use a Solidity ABI, `getAgent`, or decoded raw storage.

- Read: `frontend/src/app/api/agent/route.ts` → `client.readContract({ functionName: "get_state" })`
- Write: `frontend/src/app/api/jury/route.ts` → `client.writeContract({ functionName: "adjudicate" })`
- Wait: `waitForTransactionReceipt({ waitUntil: "finalized" })` then read `get_state` again
- SDK client: `frontend/src/lib/genlayer.ts` (`createClient`, chain id `61997`, endpoint `https://studio-next.genlayer.com/api`)
- Schema: `client.getContractSchema` lists all 15 public methods from [What's New in Milestone v1.0](#whats-new-in-milestone-v10), including `update_policy`, `get_telemetry`, `get_audit_history`, and `submit_ai_appeal`.

Milestone verification on `0xcCB0708FD9fB3c80E8931692ee9eE374AB1C8F95` recorded a `CONTINUE` adjudication for the $186 economy flight (`0xcc23b79630b6e788ff23ea1ceb67e9202ecdfc1bc9641a592e3538c9d2977806`) and a `REVOKE` / `PROMPT_INJECTION` adjudication for the jailbreak sample (`0xf9a73fc9e9b0dd35c1bec1191d12158d7f5525c52bfaf6742cfdb0554a0b3d65`). The owner then restored the leash with `appeal_and_unfreeze` (`0x603fc4422303219ab122370c6d2972ad9000b792af0db9799ba7f6be2e826914`). Later dashboard writes move this state. Read `get_state` for the current values.

### Why does decentralized judgment matter to this problem?

An AI agent with spending keys does not fail in a way a price oracle can price.

- **Hack** looks like a valid transfer to a fresh address.
- **Hallucination** looks like a first-class ticket when the mandate said economy before 6pm.
- **Soft drift** is still the mandated job with a suspicious extra, such as a premium cabin under the cap. v1 records that as `THROTTLE` and halves `spend_cap`. A hotel, a late arrival, or an overspend is a severe miss and records `REVOKE`.

Those are **subjective** questions about a **natural-language mandate**. A single LLM is a single bias. A backend flag is a single operator. A static cap does not know *why* the agent is spending.

GenLayer is the adjudication layer for that class of dispute. Independent validators reach consensus on whether the agent is still doing the job it was allowed to do. LEASH puts the job itself — mandate, spend cap, deadline — on that network so the terms a jury would judge are not trapped in an app server. Without consensus-backed terms, there is nothing honest to judge. Without a jury, there is nothing that can judge language. Both are required before autonomous agents can be funded.

### Does the contract maintain meaningful state?

**Yes.** Constructor terms are only the starting leash. A validator-decided verdict mutates live fields the dashboard reads back:

| Variable | Type | Meaning |
| --- | --- | --- |
| `mandate` | `str` | Natural-language job the agent is bound to |
| `spend_cap` | `u256` | Remaining spend allowance; jury can reduce it to 0 |
| `deadline` | `u256` | Mandate window; `0` means open-ended |
| `last_verdict` | `str` | `CONTINUE` / `THROTTLE` / `REVOKE` from the jury |
| `last_reason` | `str` | One-sentence validator rationale |
| `last_risk_score` | `u256` | 0–100 score from the last adjudication or appeal |
| `last_threat_category` | `str` | `NONE`, `OVERSPEND`, `POLICY_DRIFT`, `DEADLINE_VIOLATION`, or `PROMPT_INJECTION` |
| `kill_switch` | `bool` | Set by `REVOKE` or owner freeze. `THROTTLE` leaves it off. |
| `threat_score` | `u256` | Increases by 4 on `THROTTLE` and by 10 on `REVOKE` |
| `submission_count` | `u256` | Number of jury and policy writes applied |
| `total_adjudications` | `u256` | Count of `adjudicate` calls that finalized |
| `total_blocked_volume` | `u256` | Spend denied by `THROTTLE` and `REVOKE` |
| `prompt_injections_blocked` | `u256` | Jailbreaks forced to `REVOKE` |
| `threats_neutralized` | `u256` | `THROTTLE` and `REVOKE` decisions, plus rejected injected appeals |
| `audit_history` | `str` | JSON array of the on-chain audit log, also returned as a list by `get_audit_history()` |

That is the proof the steward asked for: a validator-decided mandate result changes contract state, and the app reads it back.

---

## Technical Highlights (no mock data)

1. **Working GenLayer mandate jury.** `adjudicate()` runs `gl.nondet.exec_prompt` inside `gl.eq_principle.prompt_comparative` so validators must agree on `verdict` and `threat_category` before state changes.
2. **Dashboard calls the actual Python API.** All 15 methods, including `get_state`, `adjudicate`, `update_policy`, `get_telemetry`, `get_audit_history`, `submit_ai_appeal`, `emergency_freeze`, and `appeal_and_unfreeze`. No Solidity method names on the Studio Next path.
3. **Write → finality → read-back.** `/api/jury` and `/api/control` wait until `FINALIZED`, then call `get_state` and return the new verdict, risk score, threat category, spend cap, and kill switch to the UI.
4. **Preset cases.** In-mandate flight (`CONTINUE`), soft drift cabin upgrade (`THROTTLE`), overspend + late arrival (`REVOKE`). The injection button fills a real jailbreak sample for `REVOKE` / `PROMPT_INJECTION`.

The repo also contains a Hardhat / Solidity protocol prototype (`contracts/LEASH.sol`) with **33 / 33** tests. That suite is local-only. **The hackathon deployment on `studio_next` is [`genlayer-studio/leash.py`](./genlayer-studio/leash.py).**

---

## Local Setup & Testing

Requires **Node.js 18+**.

### Install

```bash
git clone https://github.com/jubayir-hub-69/LEASH-Protocol.git
cd LEASH-Protocol
npm install
```

### Deploy the mandate jury to Studio Next

1. Fund the deployer on [Studio Next](https://studio-next.genlayer.com) (chain ID `61997`). Canonical RPC: `https://studio-next.genlayer.com/api` (alias of studio-dev).
2. Put the funded key in the repo-root `.env`:

```
PRIVATE_KEY=0xyourkey
```

3. Deploy [`genlayer-studio/leash.py`](./genlayer-studio/leash.py):

```bash
npm run deploy:studio-next
```

This writes the new address to `deployed_addresses.json` and the README table. Confirm `getContractSchema` lists `adjudicate` and `get_state`. If it only shows the constructor, the wrong file was deployed.

4. Seed a validator-decided verdict so the dashboard has a real result to read back:

```bash
npm run jury:seed
# optional second case that should REVOKE:
node scripts/adjudicate.mjs overspend
```

Consensus takes 1–3 minutes. Success prints `last_verdict` from `get_state`.

5. Point the Command Center at the new address (`frontend/.env.local`):

```
NEXT_PUBLIC_RPC_URL=https://studio-next.genlayer.com/api
NEXT_PUBLIC_CHAIN_ID=61997
NEXT_PUBLIC_CONTRACT_ADDRESS=0xYourNewAddress
NEXT_PUBLIC_LEASH_ADDRESS=0xYourNewAddress
```

The API routes also read `PRIVATE_KEY` from the repo-root `.env` so jury writes can be signed.

### Run the Command Center

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Click a mandate-jury case. The UI submits `adjudicate`, waits for Studio Next finality, then re-renders `last_verdict`, `spend_cap`, the risk score, the threat category, and the kill switch from `get_state`.

### Verify the live v1 contract

From the repo root, after `.env` contains the Studio Next key:

```bash
npm run verify:v1
```

This checks the 15-method schema, `get_state`, `update_policy`, `adjudicate`, `get_audit_history`, and `get_telemetry`, then submits a prompt-injection case and restores the leash with `appeal_and_unfreeze`. The script writes to `0xcCB0708FD9fB3c80E8931692ee9eE374AB1C8F95`. It does not deploy a new contract and it does not print `PRIVATE_KEY`.

### Run the Hardhat test suite

From the repo root:

```bash
npx hardhat test
```

Equivalent: `npm test`. Expected result: **33 / 33 passing** (`test/LEASH.test.js`).

### Optional — local Hardhat node (Solidity prototype)

```bash
npx hardhat node
npx hardhat compile
npx hardhat run scripts/deploy.js --network localhost
```

This path deploys `LEASH.sol` to a local node. It is not the Studio Next submission.

---

## Tech Stack

| Layer | Choice |
| --- | --- |
| **Intelligent Contract (submission)** | [`genlayer-studio/leash.py`](./genlayer-studio/leash.py) mandate jury on **studio_next** (chain ID `61997`) |
| **Command Center** | Next.js 16 · React 19 · Tailwind CSS 4 |
| **Chain SDK** | official `genlayer-js` `^2.0.0-rc.1` |
| **Local protocol prototype** | Solidity `0.8.24` · Hardhat 2.22 · OpenZeppelin · 33 tests |

---

## Repository

```
LEASH-Protocol/
├── genlayer-studio/leash.py     # EXACT Intelligent Contract on studio_next (judges: start here)
├── leash.py                     # same source; used by scripts/deploy.js
├── contracts/
│   ├── leash.py                 # same source
│   ├── LEASH.sol                # local Hardhat prototype (not the studio_next deploy)
│   └── ...
├── frontend/                    # Next.js Command Center (genlayer-js → studio_next)
├── scripts/deploy.js            # studio_next deploy of genlayer-studio/leash.py
├── scripts/adjudicate.mjs       # seed a validator jury verdict and read it back
├── test/LEASH.test.js           # 33 / 33 Hardhat tests
└── deployed_addresses.json      # live studio_next address + tx
```

<!-- DEPLOYED_ADDRESSES_START -->
## Deployed Addresses

| Network | Chain ID | Contract | Address | Timestamp |
| --- | ---: | --- | --- | --- |
| hardhat | 31337 | LEASH | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` | 2026-09-06T05:24:23.481Z |
| localhost | 31337 | LEASH | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` | 2026-09-08T14:52:06.795Z |
| studio_next | 61997 | LEASH | `0xcCB0708FD9fB3c80E8931692ee9eE374AB1C8F95` | 2026-10-19T08:01:18.977Z |
<!-- DEPLOYED_ADDRESSES_END -->

| Network | Chain ID | Contract | Address | Deploy tx |
| --- | ---: | --- | --- | --- |
| **studio_next** | **61997** | **leash.py** | **`0xcCB0708FD9fB3c80E8931692ee9eE374AB1C8F95`** | `0x0891c290797d33aa3c2c059b3bbc393409ca56e14bb790fd866fe8081309a749` |
| genlayer_studio (legacy) | 61999 | leash.py | `0x3bba2d2d84a95006084aFabc0F02a6dE472D57A4` | `0x91e06782a1662b7b26b5119a2740a147a1795b3568f25754c7866551ec06d997` |

---

Built for the **GenLayer Agent Tank Hackathon**. Submission network: **studio_next**.

**LEASH — because the agent already has the keys.**
