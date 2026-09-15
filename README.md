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
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   HUMAN MANDATE              ON-CHAIN STATE             COMMAND CENTER   │
│   "≤ $200, lands             mandate                    Next.js reads    │
│    before 6pm."              spend_cap                  live via         │
│         │                    deadline                   genlayer-js      │
│         └────────────── LEASH PROTOCOL ─────────────────┘                │
│                     studio_next · chain 61997                            │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Project Overview

Autonomous agents are about to spend other people's money. That is the Agent Tank thesis: agents that book, trade, pay, and settle without a human in the loop. The moment those agents hold live keys, static spend caps and post-hoc logs are not enough.

**LEASH** is an AI Agent Security Command Center. A principal writes a natural-language job — *spend at most $200 on a flight that lands before 6pm* — and that job is stored on GenLayer as the agent's binding terms. The Command Center reads those terms live from the Intelligent Contract. There is no mock feed and no reconstructed ABI.

This is not a vault. This is not an escrow. The key is already in the agent's wallet. LEASH is the on-chain record of **what the agent is allowed to do**, so a decentralized jury can later answer the only question that matters between transaction N and transaction N+1:

> **“Is this still the job I was allowed to do?”**

**Hackathon network (required):** GenLayer **Studio Next** (`studio_next`) · RPC `https://studio-next.genlayer.com/api` · Chain ID **61997**.

---

## GenLayer Studio Deployed Code

Judges: the Intelligent Contract running on `studio_next` is the Python file in this dedicated folder:

**[`genlayer-studio/leash.py`](./genlayer-studio/leash.py)**

That file is the exact source deployed to Studio Next. Same bytecode family, same constructor, same storage layout. Identical copies also live at the repo root (`leash.py`, used by `scripts/deploy.js`) and at `contracts/leash.py`.

| | |
| --- | --- |
| **Network** | `studio_next` |
| **Chain ID** | `61997` |
| **RPC** | `https://studio-next.genlayer.com/api` |
| **Contract** | [`genlayer-studio/leash.py`](./genlayer-studio/leash.py) |
| **Address** | [`0xF1eAC68be6E0fC866CcCb75c3656C96Cc42c859F`](https://studio-next.genlayer.com) |
| **Deploy tx** | `0xbb9aab16ecfb85d38b50d0c59cfdafa46912b56bc4048f547d907f9e592bff9f` |
| **Status** | `FINALIZED` |
| **Constructor** | `mandate = "spend at most $200 on a flight that lands before 6pm."` · `spend_cap = 200` · `deadline = 0` |

```python
class Contract(gl.contract.Contract):
    mandate: str
    spend_cap: u256
    deadline: u256

    def __init__(self, mandate: str, spend_cap: int, deadline: int):
        self.mandate = mandate
        self.spend_cap = spend_cap
        self.deadline = deadline
```

The Next.js Command Center connects with official **genlayer-js**, talks to `https://studio-next.genlayer.com/api`, and reads those three storage variables from this address. What the dashboard shows is what the chain stores.

---

## Addressing the Judging Criteria

### Does the app call a real GenLayer contract?

**Yes.** The Command Center does not use a mock, a fixture, or a reconstructed EVM ABI for Studio Next.

- Frontend route: `frontend/src/app/api/agent/route.ts`
- SDK client: `frontend/src/lib/genlayer.ts` (`createClient` from `genlayer-js`, chain id `61997`, endpoint `https://studio-next.genlayer.com/api`)
- Snapshot: `frontend/src/lib/leash.ts` reads the live contract at `0xF1eAC68be6E0fC866CcCb75c3656C96Cc42c859F`
- Schema is fetched with `client.getContractSchema` (`ctor` params `mandate`, `spend_cap`, `deadline`; public methods: none)
- State is read through genlayer-js `readContract` / `gen_call` and decoded from the contract's `contract_state`

Verified live values on Studio Next:

| State variable | On-chain value |
| --- | --- |
| `mandate` | `spend at most $200 on a flight that lands before 6pm.` |
| `spend_cap` | `200` |
| `deadline` | `0` (open-ended) |

### Why does decentralized judgment matter to this problem?

An AI agent with spending keys does not fail in a way a price oracle can price.

- **Hack** looks like a valid transfer to a fresh address.
- **Hallucination** looks like a first-class ticket when the mandate said economy before 6pm.
- **Soft drift** looks cheap until it is not — a later arrival, a hotel, then an off-mandate transfer.

Those are **subjective** questions about a **natural-language mandate**. A single LLM is a single bias. A backend flag is a single operator. A static cap does not know *why* the agent is spending.

GenLayer is the adjudication layer for that class of dispute. Independent validators reach consensus on whether the agent is still doing the job it was allowed to do. LEASH puts the job itself — mandate, spend cap, deadline — on that network so the terms a jury would judge are not trapped in an app server. Without consensus-backed terms, there is nothing honest to judge. Without a jury, there is nothing that can judge language. Both are required before autonomous agents can be funded.

### Does the contract maintain meaningful state?

**Yes.** The deployed Intelligent Contract persists the three fields that define the leash:

| Variable | Type | Meaning |
| --- | --- | --- |
| `mandate` | `str` | Natural-language job the agent is bound to |
| `spend_cap` | `u256` | Maximum the agent may spend (`200` on the live deploy) |
| `deadline` | `u256` | Mandate window; `0` means open-ended |

That state is not decorative. It is the on-chain source of truth the Command Center renders: the mandate quote, the `$200.00` spend cap, and the open deadline. If those fields were missing, there would be no leash — only a UI.

---

## Technical Highlights (no mock data)

The Studio Next integration is a real Intelligent Contract read path, not a leftover Hardhat demo.

1. **Migrated from legacy EVM calls to genlayer-js.** The dashboard no longer talks to `leash.py` as if it were Solidity.
2. **Removed obsolete `getAgent` logic.** The Python contract has no `getAgent` method. The old ethers/ABI decode path was the red `Failed to read Agent ID 1 from LEASH` banner. It is gone.
3. **Stopped terminal RPC spam.** `eth_blockNumber` is an EVM method. Calling it on `studio_next` produced `GenLayer RPC error (eth_blockNumber): fetch failed` and `/api/agent` 503s that could blank the UI. That call is removed. Polling waits **15 seconds after each finished request**.
4. **100% authentic on-chain reading.** Mandate, spend cap, and deadline on the Command Center come from the finalized Studio Next contract at `0xF1eAC68be6E0fC866CcCb75c3656C96Cc42c859F`. Constructor args are not substituted for live state.

The repo also contains a Hardhat / Solidity protocol prototype (`contracts/LEASH.sol`) with **33 / 33** tests for a local jury, ERC-7710 kill switch, and owner freeze path. That suite is for local development. **The hackathon deployment on `studio_next` is [`genlayer-studio/leash.py`](./genlayer-studio/leash.py).**

---

## Local Setup & Testing

Requires **Node.js 18+**.

### Install

```bash
git clone https://github.com/jubayir-hub-69/LEASH-Protocol.git
cd LEASH-Protocol
npm install
```

### Run the Command Center (reads live Studio Next)

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The dashboard connects to `https://studio-next.genlayer.com/api` (chain ID `61997`) and displays the live `mandate`, `spend_cap`, and `deadline` from `0xF1eAC68be6E0fC866CcCb75c3656C96Cc42c859F`.

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
| **Intelligent Contract (submission)** | [`genlayer-studio/leash.py`](./genlayer-studio/leash.py) on **studio_next** (chain ID `61997`) |
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
├── scripts/deploy.js            # studio_next deploy of leash.py
├── test/LEASH.test.js           # 33 / 33 Hardhat tests
└── deployed_addresses.json      # live studio_next address + tx
```

<!-- DEPLOYED_ADDRESSES_START -->
## Deployed Addresses

| Network | Chain ID | Contract | Address | Timestamp |
| --- | ---: | --- | --- | --- |
| hardhat | 31337 | LEASH | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` | 2026-09-06T05:24:23.481Z |
| localhost | 31337 | LEASH | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` | 2026-09-08T14:52:06.795Z |
| studio_next | 61997 | LEASH | `0xF1eAC68be6E0fC866CcCb75c3656C96Cc42c859F` | 2026-09-15T11:20:08.007Z |
<!-- DEPLOYED_ADDRESSES_END -->

| Network | Chain ID | Contract | Address | Deploy tx |
| --- | ---: | --- | --- | --- |
| **studio_next** | **61997** | **leash.py** | **`0xF1eAC68be6E0fC866CcCb75c3656C96Cc42c859F`** | `0xbb9aab16ecfb85d38b50d0c59cfdafa46912b56bc4048f547d907f9e592bff9f` |
| genlayer_studio (legacy) | 61999 | leash.py | `0x3bba2d2d84a95006084aFabc0F02a6dE472D57A4` | `0x91e06782a1662b7b26b5119a2740a147a1795b3568f25754c7866551ec06d997` |

---

Built for the **GenLayer Agent Tank Hackathon**. Submission network: **studio_next**.

**LEASH — because the agent already has the keys.**
