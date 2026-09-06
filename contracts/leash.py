# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""
LEASH — native GenLayer Intelligent Contract.

Live mandate jury and kill switch for autonomous AI agents that already hold
spending keys. After every action the agent posts logs, receipts, and the next
intended spend. Validators answer one question:

    "Is this action still strictly within the mandate?"

Verdicts: Continue / Warn / ConstrainCap / UnlockMilestone / Revoke.

Production controls (mirrors contracts/LEASH.sol):
  1. emergency_freeze / appeal_and_unfreeze  — owner bypass of the jury
  2. deadline                                 — late submit fires the kill switch
  3. add_milestone + UnlockMilestone          — spend_cap rises only when proven
  4. destination allowlist                    — extracted from logs/receipts
  5. threat_score                             — Warn points; threshold fires kill
"""

from genlayer import *
from datetime import datetime, timezone
import json
import time
import typing

VERDICTS = ("Continue", "Warn", "ConstrainCap", "UnlockMilestone", "Revoke")

_VERDICT_ALIASES = {
    "continue": "Continue",
    "warn": "Warn",
    "warning": "Warn",
    "constraincap": "ConstrainCap",
    "constrain": "ConstrainCap",
    "unlockmilestone": "UnlockMilestone",
    "milestone": "UnlockMilestone",
    "unlock": "UnlockMilestone",
    "revoke": "Revoke",
    "killswitch": "Revoke",
}

DEFAULT_MANDATE = "spend at most $200 on a flight that lands before 6pm."
APPEAL_WINDOW_SECONDS = 7 * 24 * 60 * 60
DEFAULT_THREAT_THRESHOLD = 10


def _now_ts() -> int:
    try:
        return int(datetime.now(timezone.utc).timestamp())
    except Exception:
        return int(time.time())


def _normalize_verdict(raw: typing.Any) -> str:
    text = str(raw or "").strip()
    key = text.replace(" ", "").replace("_", "").replace("-", "").lower()
    return _VERDICT_ALIASES.get(key, text)


def _as_float(value: typing.Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _as_int(value: typing.Any, fallback: int = 0) -> int:
    try:
        return int(float(value))
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


def _is_hex_char(ch: str) -> bool:
    o = ord(ch)
    return (48 <= o <= 57) or (65 <= o <= 70) or (97 <= o <= 102)


def _normalize_addr(addr: str) -> str:
    text = str(addr or "").strip()
    if text.startswith("0x") or text.startswith("0X"):
        hexpart = text[2:]
    else:
        hexpart = text
    if len(hexpart) != 40:
        return ""
    for ch in hexpart:
        if not _is_hex_char(ch):
            return ""
    return "0x" + hexpart.lower()


def _extract_addresses(text: str) -> list:
    s = str(text or "")
    found = []
    i = 0
    n = len(s)
    while i + 42 <= n:
        if s[i] == "0" and i + 1 < n and s[i + 1] in ("x", "X"):
            j = i + 2
            while j < n and _is_hex_char(s[j]):
                j += 1
            hexlen = j - (i + 2)
            if hexlen == 40:
                found.append(("0x" + s[i + 2 : i + 42].lower(), i))
            i = j
        else:
            i += 1
    return found


def _window_has_tag(blob: str, idx: int) -> bool:
    start = idx - 24 if idx > 24 else 0
    window = blob[start:idx].lower()
    tags = (
        "to:",
        "to=",
        "destination:",
        "destination=",
        "recipient:",
        "recipient=",
        "to_address:",
    )
    for tag in tags:
        if tag in window:
            return True
    return False


def extract_destination(log: str, receipt: str) -> str:
    """Pull the unique 20-byte destination from logs/receipts.

    Tagged fields (to: / destination: / recipient:) win. 64-nibble tx hashes
    are ignored because they are not addresses. Multiple distinct untagged
    addresses raise DestinationAmbiguous.
    """
    blob = str(log or "") + "\n" + str(receipt or "")
    pairs = _extract_addresses(blob)
    if not pairs:
        return ""
    tagged = []
    untagged = []
    for addr, idx in pairs:
        if _window_has_tag(blob, idx):
            tagged.append(addr)
        else:
            untagged.append(addr)
    if tagged:
        unique = []
        for addr in tagged:
            if addr not in unique:
                unique.append(addr)
        if len(unique) != 1:
            raise Exception("DestinationAmbiguous")
        return unique[0]
    unique = []
    for addr in untagged:
        if addr not in unique:
            unique.append(addr)
    if len(unique) == 1:
        return unique[0]
    if len(unique) > 1:
        raise Exception("DestinationAmbiguous")
    return ""


class LEASH(gl.Contract):
    mandate: str
    spend_cap: float
    current_spend: float
    warning_count: u32
    threat_score: u32
    threat_threshold: u32
    is_paused: bool
    last_verdict: str
    last_reason: str
    deadline: u256
    owner: str
    allowed_destinations: str
    approved_destination: str
    milestones_json: str

    def __init__(self, mandate: str, spend_cap: float, deadline: int = 0):
        if not str(mandate).strip():
            mandate = DEFAULT_MANDATE
        cap = _as_float(spend_cap, 0.0)
        if cap <= 0:
            raise Exception("InvalidCap: spend_cap must be > 0")
        dl = int(deadline) if deadline else 0
        if dl < 0:
            raise Exception("InvalidDeadline")
        self.mandate = str(mandate)
        self.spend_cap = cap
        self.current_spend = 0.0
        self.warning_count = u32(0)
        self.threat_score = u32(0)
        self.threat_threshold = u32(DEFAULT_THREAT_THRESHOLD)
        self.is_paused = False
        self.last_verdict = ""
        self.last_reason = ""
        self.deadline = u256(dl)
        self.owner = str(gl.message.sender_address)
        self.allowed_destinations = ""
        self.approved_destination = ""
        self.milestones_json = "[]"

    def _remaining(self) -> float:
        leftover = float(self.spend_cap) - float(self.current_spend)
        return leftover if leftover > 0.0 else 0.0

    def _apply_spend(self, amount: float) -> None:
        if amount < 0.0:
            amount = 0.0
        remaining = self._remaining()
        applied = amount if amount <= remaining else remaining
        self.current_spend = float(self.current_spend) + applied

    def _deadline_passed(self) -> bool:
        deadline = int(self.deadline)
        return deadline > 0 and _now_ts() >= deadline

    def _activate_kill_switch(self, reason: str) -> None:
        self.is_paused = True
        self.spend_cap = 0.0
        self.last_verdict = "Revoke"
        self.last_reason = reason

    def _require_owner(self) -> None:
        if str(gl.message.sender_address) != str(self.owner):
            raise Exception("NotAuthorized: owner only")

    def _dest_list(self) -> list:
        raw = str(self.allowed_destinations or "")
        out = []
        for part in raw.replace("\n", ",").split(","):
            addr = _normalize_addr(part)
            if addr and addr not in out:
                out.append(addr)
        return out

    def _whitelist_active(self) -> bool:
        return len(self._dest_list()) > 0

    def _is_allowed(self, addr: str) -> bool:
        normalized = _normalize_addr(addr)
        if not normalized:
            return False
        return normalized in self._dest_list()

    def _save_dest_list(self, addrs: list) -> None:
        self.allowed_destinations = ",".join(addrs)

    def _load_milestones(self) -> list:
        raw = str(self.milestones_json or "").strip()
        if not raw:
            return []
        try:
            data = json.loads(raw)
        except Exception:
            return []
        return data if isinstance(data, list) else []

    def _save_milestones(self, items: list) -> None:
        self.milestones_json = json.dumps(items)

    def _snapshot(self) -> dict:
        remaining = self._remaining()
        deadline_i = 0
        try:
            deadline_i = int(self.deadline)
        except Exception:
            deadline_i = 0
        milestones = self._load_milestones()
        completed = 0
        for ms in milestones:
            if ms.get("completed"):
                completed += 1
        return {
            "mandate": str(self.mandate),
            "spend_cap": str(float(self.spend_cap)),
            "current_spend": str(float(self.current_spend)),
            "warning_count": int(self.warning_count),
            "threat_score": int(self.threat_score),
            "threat_threshold": int(self.threat_threshold),
            "is_paused": bool(self.is_paused),
            "last_verdict": str(self.last_verdict),
            "last_reason": str(self.last_reason),
            "remaining": str(remaining),
            "deadline": str(deadline_i),
            "owner": str(self.owner),
            "approved_destination": str(self.approved_destination),
            "allowed_destinations": str(self.allowed_destinations),
            "milestone_count": str(len(milestones)),
            "milestones_completed": str(completed),
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
    def get_milestones(self) -> str:
        return str(self.milestones_json or "[]")

    @gl.public.view
    def can_proceed(self, amount: float) -> dict:
        if self.is_paused or self.last_verdict == "Revoke":
            return {"authorized": False, "reason": "revoked"}
        if self._deadline_passed():
            return {"authorized": False, "reason": "deadline exceeded"}
        if _as_float(amount, 0.0) > self._remaining():
            return {"authorized": False, "reason": "over cap"}
        if self._whitelist_active() and not str(self.approved_destination).strip():
            return {"authorized": False, "reason": "no approved destination"}
        return {"authorized": True, "reason": ""}

    @gl.public.view
    def can_proceed_to(self, amount: float, destination: str) -> dict:
        gate = self.can_proceed(amount)
        if not gate.get("authorized"):
            return gate
        if not self._whitelist_active():
            return {"authorized": True, "reason": ""}
        dest = _normalize_addr(destination)
        if not dest:
            return {"authorized": False, "reason": "destination required"}
        if not self._is_allowed(dest):
            return {"authorized": False, "reason": "destination not whitelisted"}
        approved = _normalize_addr(self.approved_destination)
        if approved and dest != approved:
            return {"authorized": False, "reason": "destination not approved"}
        return {"authorized": True, "reason": ""}

    @gl.public.write
    def emergency_freeze(self) -> dict:
        """Owner bypasses the AI jury: instantly pause the agent and zero the cap."""
        self._require_owner()
        if self.is_paused:
            raise Exception("AgentPaused")
        self._activate_kill_switch("EmergencyFrozen: owner bypassed the AI jury")
        return self._snapshot()

    @gl.public.write
    def appeal_and_unfreeze(self, new_cap: float) -> dict:
        """Owner appeal path: restore operations with a new spend cap."""
        self._require_owner()
        if not self.is_paused:
            raise Exception("AgentNotPaused")
        cap = _as_float(new_cap, 0.0)
        if cap <= 0:
            raise Exception("InvalidCap")
        self.is_paused = False
        self.spend_cap = cap
        self.current_spend = 0.0
        self.threat_score = u32(0)
        self.warning_count = u32(0)
        self.approved_destination = ""
        self.last_verdict = "Continue"
        self.last_reason = "AgentAppealed: operations restored by owner"
        if self._deadline_passed():
            self.deadline = u256(_now_ts() + APPEAL_WINDOW_SECONDS)
        return self._snapshot()

    @gl.public.write
    def enforce_deadline(self) -> dict:
        """Permissionless keeper: persist the kill switch once the deadline has passed."""
        if not self._deadline_passed():
            raise Exception("InvalidDeadline")
        if self.is_paused:
            raise Exception("AgentPaused")
        self._activate_kill_switch(
            "MandateDeadlineExceeded: time-bound mandate expired; kill switch fired"
        )
        return self._snapshot()

    @gl.public.write
    def set_threat_threshold(self, threshold: int) -> dict:
        """Owner sets the cumulative Warn-point ceiling that fires the kill switch."""
        self._require_owner()
        value = _as_int(threshold, 0)
        if value <= 0:
            raise Exception("InvalidThreatThreshold")
        self.threat_threshold = u32(value)
        return self._snapshot()

    @gl.public.write
    def add_allowed_destination(self, destination: str) -> dict:
        """Owner allowlists a 20-byte spend destination. First entry activates the gate."""
        self._require_owner()
        addr = _normalize_addr(destination)
        if not addr:
            raise Exception("ZeroAddress")
        addrs = self._dest_list()
        if addr not in addrs:
            addrs.append(addr)
            self._save_dest_list(addrs)
        return self._snapshot()

    @gl.public.write
    def remove_allowed_destination(self, destination: str) -> dict:
        """Owner removes a destination from the allowlist."""
        self._require_owner()
        addr = _normalize_addr(destination)
        addrs = [item for item in self._dest_list() if item != addr]
        self._save_dest_list(addrs)
        if _normalize_addr(self.approved_destination) == addr:
            self.approved_destination = ""
        return self._snapshot()

    @gl.public.write
    def add_milestone(self, description: str, cap_increase: float) -> dict:
        """Owner registers a milestone. UnlockMilestone may later add cap_increase to spend_cap."""
        self._require_owner()
        desc = str(description or "").strip()
        if not desc:
            raise Exception("EmptyDescription")
        increase = _as_float(cap_increase, 0.0)
        if increase <= 0:
            raise Exception("ZeroCapIncrease")
        items = self._load_milestones()
        items.append(
            {
                "id": len(items) + 1,
                "description": desc,
                "cap_increase": str(increase),
                "completed": False,
            }
        )
        self._save_milestones(items)
        return self._snapshot()

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

        Destination is extracted from logs/receipts and enforced against the
        whitelist before the jury speaks. Warn verdicts accrue a numeric threat
        score; crossing the threshold fires the kill switch. UnlockMilestone
        increases spend_cap only for a registered, incomplete milestone.
        """
        if self.is_paused:
            raise Exception("AgentPaused: ERC-7710 kill switch is engaged")

        if self._deadline_passed():
            # Persist the kill switch in this write. Raising would roll it back.
            self._activate_kill_switch(
                "MandateDeadlineExceeded: action submitted after mandate deadline"
            )
            return self._snapshot()

        log_s = str(log)
        receipt_s = str(receipt)
        extracted = extract_destination(log_s, receipt_s)
        if self._whitelist_active():
            if not extracted:
                raise Exception("DestinationRequired")
            if not self._is_allowed(extracted):
                raise Exception("DestinationNotAllowed")

        mandate = str(self.mandate)
        spend_cap = float(self.spend_cap)
        current_spend = float(self.current_spend)
        warning_count = int(self.warning_count)
        threat_score = int(self.threat_score)
        threat_threshold = int(self.threat_threshold)
        remaining = spend_cap - current_spend
        if remaining < 0.0:
            remaining = 0.0
        next_spend_f = _as_float(next_spend, 0.0)
        milestones = self._load_milestones()
        open_milestones = [ms for ms in milestones if not ms.get("completed")]
        allowed = ",".join(self._dest_list())

        def leader_fn() -> dict:
            prompt = f"""You are a GenLayer validator sitting on a live mandate jury.
The agent already holds spending keys. You are not scoring a contest.
You are answering one question:

Is this action still strictly within the mandate? Evaluate whether to Continue, Warn, ConstrainCap, UnlockMilestone, or Revoke.

MANDATE:
{mandate}

SPEND STATE:
- spend_cap: {spend_cap}
- current_spend: {current_spend}
- remaining: {remaining}
- warning_count: {warning_count}
- threat_score: {threat_score}
- threat_threshold: {threat_threshold}
- next_spend: {next_spend_f}
- extracted_destination: {extracted or "(none)"}
- allowed_destinations: {allowed or "(open — no whitelist)"}

OPEN MILESTONES (id, description, cap_increase):
{json.dumps(open_milestones)}

AGENT LOG:
{log_s}

RECEIPT:
{receipt_s}

Verdict rules, ordered by increasing severity:
1. Continue — still strictly the job. Under remaining cap, in scope, on time, no extras.
2. UnlockMilestone — a registered open milestone is clearly completed in the log/receipt.
   Set milestone_id to that milestone's id. spend_cap will increase by its cap_increase.
3. Warn — still under remaining cap, but soft drift. Set threat_points to 1 (minor),
   3 (moderate), or 5 (serious). Cumulative threat_score >= {threat_threshold} fires the kill switch.
4. ConstrainCap — budget or scope must be tightened. Propose a strictly smaller new_cap.
5. Revoke — kill switch. Overspend, unapproved destination, or a clear mandate break.

Return ONLY a JSON object:
{{
  "verdict": "Continue" | "Warn" | "ConstrainCap" | "UnlockMilestone" | "Revoke",
  "new_cap": <number; required when verdict is ConstrainCap, otherwise {spend_cap}>,
  "threat_points": <integer; required when verdict is Warn, otherwise 0>,
  "milestone_id": <integer; required when verdict is UnlockMilestone, otherwise 0>,
  "destination": "<0x-address extracted from the packet, or empty>",
  "reason": "<one or two sentences citing the log/receipt>"
}}
"""
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            data = _parse_jury_json(raw)
            verdict = _normalize_verdict(data.get("verdict"))
            if verdict not in VERDICTS:
                raise Exception(f"Invalid verdict: {verdict}")
            new_cap = _as_float(data.get("new_cap", spend_cap), spend_cap)
            threat_points = _as_int(data.get("threat_points", 0), 0)
            milestone_id = _as_int(data.get("milestone_id", 0), 0)
            destination = _normalize_addr(str(data.get("destination", "")))
            reason = str(data.get("reason", "")).strip()
            if verdict == "Warn" and threat_points <= 0:
                threat_points = 1
            return {
                "verdict": verdict,
                "new_cap": new_cap,
                "threat_points": threat_points,
                "milestone_id": milestone_id,
                "destination": destination,
                "reason": reason,
            }

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            leader_data = leader_result.calldata
            if not isinstance(leader_data, dict):
                return False
            if leader_data.get("verdict") not in VERDICTS:
                return False
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
            if leader_data["verdict"] == "UnlockMilestone":
                return _as_int(leader_data.get("milestone_id", 0), 0) == _as_int(
                    validator_data.get("milestone_id", 0), 0
                )
            if leader_data["verdict"] == "Warn":
                return abs(
                    _as_int(leader_data.get("threat_points", 1), 1)
                    - _as_int(validator_data.get("threat_points", 1), 1)
                ) <= 1
            return True

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        verdict = str(result["verdict"])
        reason = str(result.get("reason", ""))
        new_cap = _as_float(result.get("new_cap", spend_cap), spend_cap)
        threat_points = _as_int(result.get("threat_points", 0), 0)
        milestone_id = _as_int(result.get("milestone_id", 0), 0)
        jury_dest = _normalize_addr(str(result.get("destination", "")))

        dest = extracted or jury_dest
        if dest and self._whitelist_active() and not self._is_allowed(dest):
            self._activate_kill_switch(
                "DestinationNotAllowed: jury/packet destination is not on the whitelist"
            )
            return self._snapshot()

        self.last_verdict = verdict
        self.last_reason = reason

        if verdict == "Continue":
            if dest:
                self.approved_destination = dest
            self._apply_spend(next_spend_f)
        elif verdict == "Warn":
            if threat_points <= 0:
                threat_points = 1
            self.warning_count = u32(int(self.warning_count) + 1)
            self.threat_score = u32(int(self.threat_score) + threat_points)
            if int(self.threat_score) >= int(self.threat_threshold):
                self._activate_kill_switch(
                    "ThreatKillSwitchFired: cumulative threat score exceeded threshold"
                )
            else:
                if dest:
                    self.approved_destination = dest
                self._apply_spend(next_spend_f)
        elif verdict == "ConstrainCap":
            if new_cap < 0.0:
                new_cap = 0.0
            if new_cap < float(self.spend_cap):
                self.spend_cap = new_cap
            if dest:
                self.approved_destination = dest
            self._apply_spend(next_spend_f)
        elif verdict == "UnlockMilestone":
            items = self._load_milestones()
            matched = None
            for ms in items:
                if int(ms.get("id", 0)) == milestone_id:
                    matched = ms
                    break
            if matched is None or matched.get("completed"):
                raise Exception("UnknownMilestone" if matched is None else "MilestoneAlreadyCompleted")
            increase = _as_float(matched.get("cap_increase", 0), 0.0)
            if increase <= 0:
                raise Exception("ZeroCapIncrease")
            matched["completed"] = True
            self._save_milestones(items)
            self.spend_cap = float(self.spend_cap) + increase
            if dest:
                self.approved_destination = dest
            self._apply_spend(next_spend_f)
        elif verdict == "Revoke":
            self.is_paused = True
            self.spend_cap = 0.0

        return self._snapshot()
