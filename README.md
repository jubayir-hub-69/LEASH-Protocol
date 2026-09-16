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

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│   HUMAN MANDATE          GENLAYER JURY            COMMAND CENTER             │
│   "≤ $200, lands         adjudicate()             get_state()                │
│    before 6pm."          validators agree         last_verdict               │
│         │                on CONTINUE/REVOKE       spend_cap                  │
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

**Live address:** [`0x9d18d260f048873B119EB2E5a3b56f493CF8398a`](https://studio-next.genlayer.com) · deploy tx `0x4ab4ef9926ea37a54395d65fcb04d8c06d98779c1855e6f8da07bfe2526a6e5e`. Schema includes `adjudicate` and `get_state`. The previous constructor-only addresses are retired.

```python
@gl.public.write
def adjudicate(self, proposed_action: str, spend_amount: int, receipts: str) -> None:
    raw = gl.eq_principle.prompt_comparative(
        get_jury_answer, "The value of verdict has to match"
    )
    # validator-agreed verdict mutates last_verdict, spend_cap, kill_switch

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
- Schema: `client.getContractSchema` must list `adjudicate`, `get_state`, `emergency_freeze`, `appeal_and_unfreeze`

| Method | Kind | What the dashboard does with it |
| --- | --- | --- |
| `get_state` | view | Polls mandate, cap, last verdict, kill switch |
| `adjudicate` | write | Submits a proposed spend to the validator jury |
| `emergency_freeze` | write | Owner kill switch |
| `appeal_and_unfreeze` | write | Owner restore |

Live contract after a validator-finalized in-mandate case (`0x73fa9b46baac3b8cf0a1c7a74dc1780d85cc4a61052bf97de16dee7936de9842`):

| State | After jury |
| --- | --- |
| `last_verdict` | `CONTINUE` |
| `spend_cap` | `14` (was `200`) |
| `approved_next_spend` | `186` |
| `kill_switch` | `false` |
| `last_reason` | Economy SFO-JFK flight LE-441 lands 17:40 before 6pm and costs $186 under the $200 cap. |

### Why does decentralized judgment matter to this problem?

An AI agent with spending keys does not fail in a way a price oracle can price.

- **Hack** looks like a valid transfer to a fresh address.
- **Hallucination** looks like a first-class ticket when the mandate said economy before 6pm.
- **Soft drift** looks cheap until it is not — a later arrival, a hotel, then an off-mandate transfer.

Those are **subjective** questions about a **natural-language mandate**. A single LLM is a single bias. A backend flag is a single operator. A static cap does not know *why* the agent is spending.

GenLayer is the adjudication layer for that class of dispute. Independent validators reach consensus on whether the agent is still doing the job it was allowed to do. LEASH puts the job itself — mandate, spend cap, deadline — on that network so the terms a jury would judge are not trapped in an app server. Without consensus-backed terms, there is nothing honest to judge. Without a jury, there is nothing that can judge language. Both are required before autonomous agents can be funded.

### Does the contract maintain meaningful state?

**Yes.** Constructor terms are only the starting leash. A validator-decided verdict mutates live fields the dashboard reads back:

| Variable | Type | Meaning |
| --- | --- | --- |
| `mandate` | `str` | Natural-language job the agent is bound to |
| `spend_cap` | `u256` | Remaining spend allowance; jury can reduce it to 0 |
| `deadline` | `u256` | Mandate window; `0` means open-ended |
| `last_verdict` | `str` | `CONTINUE` / `WARN` / `CONSTRAIN` / `REVOKE` from the jury |
| `last_reason` | `str` | One-sentence validator rationale |
| `kill_switch` | `bool` | Set by `REVOKE`, threat threshold, or owner freeze |
| `threat_score` | `u256` | Accumulates on `WARN` / `CONSTRAIN` |
| `submission_count` | `u256` | Number of jury decisions applied |

That is the proof the steward asked for: a validator-decided mandate result changes contract state, and the app reads it back.

---

## Technical Highlights (no mock data)

1. **Working GenLayer mandate jury.** `adjudicate()` runs `gl.nondet.exec_prompt` inside `gl.eq_principle.prompt_comparative` so validators must agree on `verdict` before state changes.
2. **Dashboard calls the actual Python API.** `get_state`, `adjudicate`, `emergency_freeze`, `appeal_and_unfreeze`. No Solidity method names.
3. **Write → finality → read-back.** `/api/jury` waits until `FINALIZED`, then calls `get_state` and returns the new `last_verdict` / `spend_cap` / `kill_switch` to the UI.
4. **Preset cases.** In-mandate flight (`CONTINUE`), hotel drift (`REVOKE`), overspend + late arrival (`REVOKE`).

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

Open [http://localhost:3000](http://localhost:3000). Click a mandate-jury case. The UI submits `adjudicate`, waits for Studio Next finality, then re-renders `last_verdict`, `spend_cap`, and the kill switch from `get_state`.

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
| studio_next | 61997 | LEASH | `0x9d18d260f048873B119EB2E5a3b56f493CF8398a` | 2026-09-16T05:19:12.710Z |
<!-- DEPLOYED_ADDRESSES_END -->

| Network | Chain ID | Contract | Address | Deploy tx |
| --- | ---: | --- | --- | --- |
| **studio_next** | **61997** | **leash.py** | **`0x9d18d260f048873B119EB2E5a3b56f493CF8398a`** | `0x4ab4ef9926ea37a54395d65fcb04d8c06d98779c1855e6f8da07bfe2526a6e5e` |
| genlayer_studio (legacy) | 61999 | leash.py | `0x3bba2d2d84a95006084aFabc0F02a6dE472D57A4` | `0x91e06782a1662b7b26b5119a2740a147a1795b3568f25754c7866551ec06d997` |

---

Built for the **GenLayer Agent Tank Hackathon**. Submission network: **studio_next**.

**LEASH — because the agent already has the keys.**
