# v0.3.0
# { "Depends": "py-genlayer:9b8kjyda2ycxyq4ea6g4yfpnydxhd52gqba5rb8dw7krkh5mn9p0" }

import genlayer as gl
from genlayer.types import *
import json

DEFAULT_MANDATE = "spend at most $200 on a flight that lands before 6pm."
DEFAULT_THREAT_THRESHOLD = 10


class Contract(gl.contract.Contract):
    mandate: str
    spend_cap: u256
    current_spend: u256
    warning_count: u32
    threat_score: u32
    threat_threshold: u32
    is_paused: bool
    last_verdict: str
    last_reason: str
    deadline: u256
    owner: Address
    allowed_destinations: str
    approved_destination: str
    milestones_json: str

    def __init__(self, mandate: str, spend_cap: int, deadline: int):
        self.mandate = mandate if mandate else DEFAULT_MANDATE
        self.spend_cap = spend_cap
        self.current_spend = 0
        self.warning_count = 0
        self.threat_score = 0
        self.threat_threshold = DEFAULT_THREAT_THRESHOLD
        self.is_paused = False
        self.last_verdict = ""
        self.last_reason = ""
        self.deadline = deadline
        self.owner = gl.message.sender_address
        self.allowed_destinations = ""
        self.approved_destination = ""
        self.milestones_json = "[]"

    def _as_int(self, value):
        if value is None:
            return 0
        if isinstance(value, str):
            text = value.strip()
            return 0 if text == "" else int(text)
        return int(value)

    def _dump(self):
        remaining = self._as_int(self.spend_cap) - self._as_int(self.current_spend)
        if remaining < 0:
            remaining = 0
        return json.dumps(
            {
                "mandate": self.mandate,
                "spend_cap": str(self._as_int(self.spend_cap)),
                "current_spend": str(self._as_int(self.current_spend)),
                "warning_count": self._as_int(self.warning_count),
                "threat_score": self._as_int(self.threat_score),
                "threat_threshold": self._as_int(self.threat_threshold),
                "is_paused": bool(self.is_paused),
                "last_verdict": self.last_verdict,
                "last_reason": self.last_reason,
                "remaining": str(remaining),
                "deadline": str(self._as_int(self.deadline)),
                "owner": self.owner.as_hex,
                "approved_destination": self.approved_destination,
                "allowed_destinations": self.allowed_destinations,
                "milestones": self.milestones_json,
            }
        )

    def _remaining(self):
        leftover = self._as_int(self.spend_cap) - self._as_int(self.current_spend)
        return leftover if leftover > 0 else 0

    def _apply_spend(self, amount):
        amount_i = self._as_int(amount)
        if amount_i < 0:
            amount_i = 0
        remaining = self._remaining()
        applied = amount_i if amount_i <= remaining else remaining
        self.current_spend = self._as_int(self.current_spend) + applied

    def _kill(self, reason):
        self.is_paused = True
        self.spend_cap = 0
        self.last_verdict = "Revoke"
        self.last_reason = reason

    def _require_owner(self):
        if gl.message.sender_address != self.owner:
            raise Exception("NotAuthorized: owner only")

    def _normalize_addr(self, addr):
        text = str(addr or "").strip()
        if text.startswith("0x") or text.startswith("0X"):
            hexpart = text[2:]
        else:
            hexpart = text
        if len(hexpart) != 40:
            return ""
        for ch in hexpart:
            o = ord(ch)
            if not ((48 <= o <= 57) or (65 <= o <= 70) or (97 <= o <= 102)):
                return ""
        return "0x" + hexpart.lower()

    def _dest_list(self):
        out = []
        raw = str(self.allowed_destinations or "")
        for part in raw.replace("\n", ",").split(","):
            addr = self._normalize_addr(part)
            if addr and addr not in out:
                out.append(addr)
        return out

    def _extract_destination(self, log, receipt):
        blob = str(log or "") + "\n" + str(receipt or "")
        found = []
        i = 0
        n = len(blob)
        while i + 42 <= n:
            if blob[i] == "0" and i + 1 < n and blob[i + 1] in ("x", "X"):
                j = i + 2
                while j < n:
                    o = ord(blob[j])
                    if not ((48 <= o <= 57) or (65 <= o <= 70) or (97 <= o <= 102)):
                        break
                    j += 1
                if j - (i + 2) == 40:
                    found.append("0x" + blob[i + 2 : i + 42].lower())
                i = j
            else:
                i += 1
        unique = []
        for addr in found:
            if addr not in unique:
                unique.append(addr)
        if len(unique) == 1:
            return unique[0]
        return ""

    def _load_milestones(self):
        raw = str(self.milestones_json or "").strip()
        if not raw:
            return []
        try:
            data = json.loads(raw)
        except Exception:
            return []
        return data if isinstance(data, list) else []

    def _parse_verdict(self, raw, spend_cap):
        text = str(raw or "").replace("```json", "").replace("```", "").strip()
        first = text.find("{")
        last = text.rfind("}")
        if first == -1 or last == -1:
            raise Exception("LLM returned no JSON object")
        data = json.loads(text[first : last + 1])
        verdict = str(data.get("verdict") or "").strip()
        key = verdict.replace(" ", "").replace("_", "").replace("-", "").lower()
        aliases = {
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
        verdict = aliases.get(key, verdict)
        if verdict not in (
            "Continue",
            "Warn",
            "ConstrainCap",
            "UnlockMilestone",
            "Revoke",
        ):
            raise Exception("Invalid verdict: " + verdict)
        threat_points = self._as_int(data.get("threat_points", 0))
        if verdict == "Warn" and threat_points <= 0:
            threat_points = 1
        return {
            "verdict": verdict,
            "new_cap": self._as_int(data.get("new_cap", spend_cap)),
            "threat_points": threat_points,
            "milestone_id": self._as_int(data.get("milestone_id", 0)),
            "destination": self._normalize_addr(str(data.get("destination", ""))),
            "reason": str(data.get("reason", "")).strip(),
        }

    @gl.public.view
    def get_state(self) -> str:
        return self._dump()

    @gl.public.view
    def get_mandate(self) -> str:
        return self.mandate

    @gl.public.view
    def get_last_verdict(self) -> str:
        return self.last_verdict

    @gl.public.view
    def get_milestones(self) -> str:
        return self.milestones_json

    @gl.public.view
    def can_proceed(self, amount: int) -> str:
        if self.is_paused or self.last_verdict == "Revoke":
            return json.dumps({"authorized": False, "reason": "revoked"})
        if self._as_int(amount) > self._remaining():
            return json.dumps({"authorized": False, "reason": "over cap"})
        return json.dumps({"authorized": True, "reason": ""})

    @gl.public.write
    def emergency_freeze(self) -> str:
        self._require_owner()
        if self.is_paused:
            raise Exception("AgentPaused")
        self._kill("EmergencyFrozen: owner bypassed the AI jury")
        return self._dump()

    @gl.public.write
    def appeal_and_unfreeze(self, new_cap: int) -> str:
        self._require_owner()
        if not self.is_paused:
            raise Exception("AgentNotPaused")
        cap = self._as_int(new_cap)
        if cap <= 0:
            raise Exception("InvalidCap")
        self.is_paused = False
        self.spend_cap = cap
        self.current_spend = 0
        self.threat_score = 0
        self.warning_count = 0
        self.approved_destination = ""
        self.last_verdict = "Continue"
        self.last_reason = "AgentAppealed: operations restored by owner"
        return self._dump()

    @gl.public.write
    def set_threat_threshold(self, threshold: int) -> str:
        self._require_owner()
        value = self._as_int(threshold)
        if value <= 0:
            raise Exception("InvalidThreatThreshold")
        self.threat_threshold = value
        return self._dump()

    @gl.public.write
    def add_allowed_destination(self, destination: str) -> str:
        self._require_owner()
        addr = self._normalize_addr(destination)
        if not addr:
            raise Exception("ZeroAddress")
        addrs = self._dest_list()
        if addr not in addrs:
            addrs.append(addr)
            self.allowed_destinations = ",".join(addrs)
        return self._dump()

    @gl.public.write
    def add_milestone(self, description: str, cap_increase: int) -> str:
        self._require_owner()
        desc = str(description or "").strip()
        if not desc:
            raise Exception("EmptyDescription")
        increase = self._as_int(cap_increase)
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
        self.milestones_json = json.dumps(items)
        return self._dump()

    @gl.public.write
    def set_mandate(self, mandate: str, spend_cap: int) -> None:
        if self.is_paused:
            raise Exception("AgentPaused")
        if not str(mandate).strip():
            raise Exception("EmptyMandate")
        cap = self._as_int(spend_cap)
        if cap <= 0:
            raise Exception("InvalidCap")
        self.mandate = str(mandate)
        self.spend_cap = cap

    @gl.public.write
    def submit_agent_action(self, log: str, receipt: str, next_spend: int) -> str:
        if self.is_paused:
            raise Exception("AgentPaused: ERC-7710 kill switch is engaged")

        log_s = str(log)
        receipt_s = str(receipt)
        extracted = self._extract_destination(log_s, receipt_s)
        allowed = self._dest_list()
        if len(allowed) > 0:
            if extracted == "":
                raise Exception("DestinationRequired")
            if extracted not in allowed:
                raise Exception("DestinationNotAllowed")

        mandate = self.mandate
        spend_cap = self._as_int(self.spend_cap)
        current_spend = self._as_int(self.current_spend)
        remaining = spend_cap - current_spend
        if remaining < 0:
            remaining = 0
        next_spend_i = self._as_int(next_spend)
        threat_threshold = self._as_int(self.threat_threshold)
        open_milestones = [ms for ms in self._load_milestones() if not ms.get("completed")]

        prompt = f"""You are a GenLayer validator sitting on a live mandate jury.
Is this action still strictly within the mandate?

MANDATE:
{mandate}

SPEND STATE:
- spend_cap: {spend_cap}
- current_spend: {current_spend}
- remaining: {remaining}
- threat_threshold: {threat_threshold}
- next_spend: {next_spend_i}
- extracted_destination: {extracted or "(none)"}
- allowed_destinations: {",".join(allowed) or "(open)"}

OPEN MILESTONES:
{json.dumps(open_milestones)}

AGENT LOG:
{log_s}

RECEIPT:
{receipt_s}

Return ONLY JSON:
{{
  "verdict": "Continue" | "Warn" | "ConstrainCap" | "UnlockMilestone" | "Revoke",
  "new_cap": <number>,
  "threat_points": <integer>,
  "milestone_id": <integer>,
  "destination": "<0x-address or empty>",
  "reason": "<short reason>"
}}
"""

        def get_verdict():
            raw = gl.nondet.exec_prompt(prompt)
            parsed = self._parse_verdict(raw, spend_cap)
            return json.dumps(parsed)

        raw_result = gl.eq_principle.prompt_comparative(
            get_verdict, "The verdict field must match"
        )
        result = self._parse_verdict(raw_result, spend_cap)
        verdict = result["verdict"]
        dest = extracted or result["destination"]
        if dest and len(allowed) > 0 and dest not in allowed:
            self._kill("DestinationNotAllowed: destination is not on the whitelist")
            return self._dump()

        self.last_verdict = verdict
        self.last_reason = result["reason"]

        if verdict == "Continue":
            if dest:
                self.approved_destination = dest
            self._apply_spend(next_spend_i)
        elif verdict == "Warn":
            threat_points = result["threat_points"]
            if threat_points <= 0:
                threat_points = 1
            self.warning_count = self._as_int(self.warning_count) + 1
            self.threat_score = self._as_int(self.threat_score) + threat_points
            if self._as_int(self.threat_score) >= self._as_int(self.threat_threshold):
                self._kill("ThreatKillSwitchFired: cumulative threat score exceeded threshold")
            else:
                if dest:
                    self.approved_destination = dest
                self._apply_spend(next_spend_i)
        elif verdict == "ConstrainCap":
            new_cap = result["new_cap"]
            if new_cap < 0:
                new_cap = 0
            if new_cap < self._as_int(self.spend_cap):
                self.spend_cap = new_cap
            if dest:
                self.approved_destination = dest
            self._apply_spend(next_spend_i)
        elif verdict == "UnlockMilestone":
            items = self._load_milestones()
            matched = None
            for ms in items:
                if int(ms.get("id", 0)) == result["milestone_id"]:
                    matched = ms
                    break
            if matched is None or matched.get("completed"):
                raise Exception("UnknownMilestone" if matched is None else "MilestoneAlreadyCompleted")
            increase = self._as_int(matched.get("cap_increase", 0))
            if increase <= 0:
                raise Exception("ZeroCapIncrease")
            matched["completed"] = True
            self.milestones_json = json.dumps(items)
            self.spend_cap = self._as_int(self.spend_cap) + increase
            if dest:
                self.approved_destination = dest
            self._apply_spend(next_spend_i)
        elif verdict == "Revoke":
            self.is_paused = True
            self.spend_cap = 0

        return self._dump()
