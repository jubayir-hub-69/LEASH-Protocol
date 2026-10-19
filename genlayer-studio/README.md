# GenLayer Studio Next — deployed Intelligent Contract

This folder holds the **exact** Python Intelligent Contract to deploy on **studio_next**.

| | |
| --- | --- |
| File | [`leash.py`](./leash.py) |
| Network | `studio_next` |
| Chain ID | `61997` |
| RPC | `https://studio-next.genlayer.com/api` |
| Address | `0xcCB0708FD9fB3c80E8931692ee9eE374AB1C8F95` |
| Deploy tx | `0x0891c290797d33aa3c2c059b3bbc393409ca56e14bb790fd866fe8081309a749` |

## What this contract is

A live **mandate jury**. The constructor stores the agent's job. `adjudicate()` asks GenLayer validators to decide whether a proposed spend is still that job. The agreed `verdict` mutates `last_verdict`, `spend_cap`, and `kill_switch`. The dashboard reads that state back with `get_state`.

## Public API

| Method | Kind | Purpose |
| --- | --- | --- |
| `get_state()` | view | Mandate, cap, deadline, last verdict, kill switch |
| `get_mandate()` / `get_spend_cap()` / `get_deadline()` | view | Individual fields |
| `get_last_verdict()` / `get_last_reason()` / `get_kill_switch()` / `can_proceed()` | view | Jury result |
| `adjudicate(proposed_action, spend_amount, receipts)` | write | LLM jury via `gl.eq_principle.prompt_comparative` |
| `update_policy(new_mandate, new_spend_cap, new_deadline)` | write | Owner policy update |
| `get_audit_history()` / `get_telemetry()` | view | Audit log and security counters |
| `emergency_freeze()` | write | Owner kill switch |
| `appeal_and_unfreeze(new_spend_cap)` | write | Owner restore |
| `submit_ai_appeal(appeal_justification, requested_cap)` | write | Validator appeal jury |

After you deploy, copy the new address into `deployed_addresses.json` and `frontend/.env.local`, then run `npm run jury:seed` so a validator-decided verdict already exists on-chain.
