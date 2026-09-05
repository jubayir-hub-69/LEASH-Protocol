# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
LEASH — native GenLayer Intelligent Contract.

Live mandate jury and kill switch for autonomous AI agents that already hold
spending keys. After every action the agent posts logs, receipts, and the next
intended spend. GenLayer validators jury:

    "Is this action still strictly within the mandate?"

Verdicts: Continue / Warn / ConstrainCap / Revoke.
Revoke zeros the cap and pauses the agent (ERC-7710 / agent kill switch).
"""

from genlayer import *
import json
import typing

VERDICTS = ("Continue", "Warn", "ConstrainCap", "Revoke")

_VERDICT_ALIASES = {
    "continue": "Continue",
    "warn": "Warn",
    "warning": "Warn",
    "constraincap": "ConstrainCap",
    "constrain": "ConstrainCap",
    "revoke": "Revoke",
    "killswitch": "Revoke",
}

DEFAULT_MANDATE = "spend at most $200 on a flight that lands before 6pm."


def _normalize_verdict(raw: typing.Any) -> str:
    text = str(raw or "").strip()
    key = text.replace(" ", "").replace("_", "").replace("-", "").lower()
    return _VERDICT_ALIASES.get(key, text)


def _as_float(value: typing.Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _parse_jury_json(raw: typing.Any) -> dict:
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str):
        raise Exception("LLM returned a non-JSON verdict")
    text = raw.replace("```json", "").replace("```", "").strip()
    first = text.find("{")
    last = text.rfind("}")
    if first == -1 or last == -1:
        raise Exception("LLM returned no JSON object")
    return json.loads(text[first : last + 1])


class LEASH(gl.Contract):
    mandate: str
    spend_cap: float
    current_spend: float
    warning_count: u32
    is_paused: bool
    last_verdict: str
    last_reason: str

    def __init__(self, mandate: str, spend_cap: float):
        if not str(mandate).strip():
            mandate = DEFAULT_MANDATE
        cap = _as_float(spend_cap, 0.0)
        if cap <= 0:
            raise Exception("InvalidCap: spend_cap must be > 0")
        self.mandate = str(mandate)
        self.spend_cap = cap
        self.current_spend = 0.0
        self.warning_count = u32(0)
        self.is_paused = False
        self.last_verdict = ""
        self.last_reason = ""

    def _remaining(self) -> float:
        leftover = float(self.spend_cap) - float(self.current_spend)
        return leftover if leftover > 0.0 else 0.0

    def _apply_spend(self, amount: float) -> None:
        if amount < 0.0:
            amount = 0.0
        remaining = self._remaining()
        applied = amount if amount <= remaining else remaining
        self.current_spend = float(self.current_spend) + applied

    def _snapshot(self) -> dict:
        remaining = self._remaining()
        return {
            "mandate": str(self.mandate),
            "spend_cap": float(self.spend_cap),
            "current_spend": float(self.current_spend),
            "warning_count": int(self.warning_count),
            "is_paused": bool(self.is_paused),
            "last_verdict": str(self.last_verdict),
            "last_reason": str(self.last_reason),
            "remaining": remaining,
        }

    @gl.public.view
    def get_state(self) -> dict:
        return self._snapshot()

    @gl.public.view
    def get_mandate(self) -> str:
        return self.mandate

    @gl.public.view
    def get_last_verdict(self) -> str:
        return self.last_verdict

    @gl.public.view
    def can_proceed(self, amount: float) -> dict:
        if self.is_paused or self.last_verdict == "Revoke":
            return {"authorized": False, "reason": "revoked"}
        if _as_float(amount, 0.0) > self._remaining():
            return {"authorized": False, "reason": "over cap"}
        return {"authorized": True, "reason": ""}

    @gl.public.write
    def set_mandate(self, mandate: str, spend_cap: float) -> None:
        if self.is_paused:
            raise Exception("AgentPaused")
        if not str(mandate).strip():
            raise Exception("EmptyMandate")
        cap = _as_float(spend_cap, 0.0)
        if cap <= 0:
            raise Exception("InvalidCap")
        self.mandate = str(mandate)
        self.spend_cap = cap

    @gl.public.write
    def submit_agent_action(self, log: str, receipt: str, next_spend: float) -> dict:
        """Post the latest agent packet and run the GenLayer mandate jury.

        Validators independently answer:
        "Is this action still strictly within the mandate?
         Evaluate whether to Continue, Warn, ConstrainCap, or Revoke."
        """
        if self.is_paused:
            raise Exception("AgentPaused: ERC-7710 kill switch is engaged")

        # Snapshot storage before the nondet block (GenVM cannot read
        # persistent fields from inside leader/validator functions).
        mandate = str(self.mandate)
        spend_cap = float(self.spend_cap)
        current_spend = float(self.current_spend)
        warning_count = int(self.warning_count)
        remaining = spend_cap - current_spend
        if remaining < 0.0:
            remaining = 0.0
        next_spend_f = _as_float(next_spend, 0.0)
        log_s = str(log)
        receipt_s = str(receipt)

        def leader_fn() -> dict:
            prompt = f"""You are a GenLayer validator sitting on a live mandate jury.
The agent already holds spending keys. You are not scoring a contest.
You are answering one question:

Is this action still strictly within the mandate? Evaluate whether to Continue, Warn, ConstrainCap, or Revoke.

MANDATE:
{mandate}

SPEND STATE:
- spend_cap: {spend_cap}
- current_spend: {current_spend}
- remaining: {remaining}
- warning_count: {warning_count}
- next_spend: {next_spend_f}

AGENT LOG:
{log_s}

RECEIPT:
{receipt_s}

Verdict rules, ordered by increasing severity:
1. Continue — still strictly the job. Under remaining cap, in scope, on time, no extras.
   Example: $186 economy flight landing 5:40 PM under a "$200 / lands before 6pm" mandate.
2. Warn — still under remaining cap, but soft drift (late arrival, extra hotel, out-of-scope add-on).
   Spend may proceed; record the drift.
   Example: 7:10 PM arrival plus a layover hotel, still under $200.
3. ConstrainCap — budget or scope must be tightened. Propose a strictly smaller new_cap.
4. Revoke — kill switch. Overspend, luxury/first-class far above cap, unapproved transfer,
   or a clear mandate break. Example: $4,800 first class plus a $1,200 unknown-wallet transfer.

Return ONLY a JSON object:
{{
  "verdict": "Continue" | "Warn" | "ConstrainCap" | "Revoke",
  "new_cap": <number; required when verdict is ConstrainCap, otherwise {spend_cap}>,
  "reason": "<one or two sentences citing the log/receipt>"
}}
"""
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            data = _parse_jury_json(raw)
            verdict = _normalize_verdict(data.get("verdict"))
            if verdict not in VERDICTS:
                raise Exception(f"Invalid verdict: {verdict}")
            new_cap = _as_float(data.get("new_cap", spend_cap), spend_cap)
            reason = str(data.get("reason", "")).strip()
            return {"verdict": verdict, "new_cap": new_cap, "reason": reason}

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            leader_data = leader_result.calldata
            if not isinstance(leader_data, dict):
                return False
            if leader_data.get("verdict") not in VERDICTS:
                return False
            # Independent re-derivation: each validator runs the same jury prompt
            # and must agree on the decision field (verdict), not the prose.
            validator_data = leader_fn()
            if validator_data["verdict"] != leader_data["verdict"]:
                return False
            if leader_data["verdict"] == "ConstrainCap":
                leader_cap = _as_float(leader_data.get("new_cap", 0.0), 0.0)
                validator_cap = _as_float(validator_data.get("new_cap", 0.0), 0.0)
                if leader_cap <= 0.0 or validator_cap <= 0.0:
                    return False
                if leader_cap >= spend_cap and validator_cap >= spend_cap:
                    return False
                denom = abs(leader_cap) if abs(leader_cap) > 0.0 else 1.0
                return (
                    abs(leader_cap - validator_cap) / denom <= 0.05
                    or abs(leader_cap - validator_cap) <= 1.0
                )
            return True

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        verdict = str(result["verdict"])
        reason = str(result.get("reason", ""))
        new_cap = _as_float(result.get("new_cap", spend_cap), spend_cap)

        self.last_verdict = verdict
        self.last_reason = reason

        if verdict == "Continue":
            self._apply_spend(next_spend_f)
        elif verdict == "Warn":
            self.warning_count = u32(int(self.warning_count) + 1)
            self._apply_spend(next_spend_f)
        elif verdict == "ConstrainCap":
            if new_cap < 0.0:
                new_cap = 0.0
            if new_cap < float(self.spend_cap):
                self.spend_cap = new_cap
            self._apply_spend(next_spend_f)
        elif verdict == "Revoke":
            # ERC-7710 / agent kill switch: pause and zero the cap so the
            # second transaction never leaves the wallet.
            self.is_paused = True
            self.spend_cap = 0.0

        return self._snapshot()
