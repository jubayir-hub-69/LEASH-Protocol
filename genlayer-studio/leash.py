# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import genlayer as gl
from genlayer.types import *

import json
import typing


ALLOWED_VERDICTS = ("CONTINUE", "WARN", "CONSTRAIN", "REVOKE")


class Contract(gl.contract.Contract):
    mandate: str
    spend_cap: u256
    deadline: u256
    owner: str
    kill_switch: bool
    frozen: bool
    last_verdict: str
    last_reason: str
    last_action: str
    last_receipts: str
    last_spend: u256
    approved_next_spend: u256
    threat_score: u256
    threat_threshold: u256
    submission_count: u256

    def __init__(self, mandate: str, spend_cap: int, deadline: int):
        self.mandate = mandate
        self.spend_cap = spend_cap
        self.deadline = deadline
        self.owner = str(gl.message.sender_address)
        self.kill_switch = False
        self.frozen = False
        self.last_verdict = "NONE"
        self.last_reason = "No jury decision yet"
        self.last_action = ""
        self.last_receipts = ""
        self.last_spend = 0
        self.approved_next_spend = 0
        self.threat_score = 0
        self.threat_threshold = 10
        self.submission_count = 0

    def _snapshot(self) -> dict[str, typing.Any]:
        cap = int(self.spend_cap)
        deadline = int(self.deadline)
        kill = bool(self.kill_switch) or bool(self.frozen) or cap <= 0
        return {
            "mandate": self.mandate,
            "spend_cap": cap,
            "deadline": deadline,
            "owner": self.owner,
            "kill_switch": bool(self.kill_switch),
            "frozen": bool(self.frozen),
            "last_verdict": self.last_verdict,
            "last_reason": self.last_reason,
            "last_action": self.last_action,
            "last_receipts": self.last_receipts,
            "last_spend": int(self.last_spend),
            "approved_next_spend": int(self.approved_next_spend),
            "threat_score": int(self.threat_score),
            "threat_threshold": int(self.threat_threshold),
            "submission_count": int(self.submission_count),
            "can_proceed": not kill,
        }

    def _apply_verdict(self, verdict: str, reason: str, action: str, receipts: str, spend: int) -> None:
        cap = int(self.spend_cap)
        threat = int(self.threat_score)
        threshold = int(self.threat_threshold)

        self.last_verdict = verdict
        self.last_reason = reason
        self.last_action = action
        self.last_receipts = receipts
        self.last_spend = spend
        self.submission_count = int(self.submission_count) + 1

        if verdict == "CONTINUE":
            remaining = cap - spend if spend <= cap else 0
            self.spend_cap = remaining
            self.approved_next_spend = spend if spend <= cap else 0
            if remaining <= 0:
                self.kill_switch = True
                self.last_reason = reason + " Spend cap exhausted."
            return

        if verdict == "WARN":
            threat = threat + 2
            self.threat_score = threat
            remaining = cap - spend if spend <= cap else cap
            self.spend_cap = remaining
            self.approved_next_spend = spend if spend <= cap else 0
            if threat >= threshold:
                self.kill_switch = True
                self.spend_cap = 0
                self.approved_next_spend = 0
                self.last_reason = reason + " Threat threshold reached."
            return

        if verdict == "CONSTRAIN":
            if spend > cap:
                self.spend_cap = 0
            else:
                self.spend_cap = spend // 2 if spend > 1 else 0
            self.approved_next_spend = 0
            self.threat_score = threat + 4
            if int(self.spend_cap) <= 0:
                self.kill_switch = True
            return

        self.kill_switch = True
        self.spend_cap = 0
        self.approved_next_spend = 0
        self.threat_score = threat + 10

    @gl.public.view
    def get_state(self) -> dict[str, typing.Any]:
        return self._snapshot()

    @gl.public.view
    def get_mandate(self) -> str:
        return self.mandate

    @gl.public.view
    def get_spend_cap(self) -> u256:
        return self.spend_cap

    @gl.public.view
    def get_deadline(self) -> u256:
        return self.deadline

    @gl.public.view
    def get_last_verdict(self) -> str:
        return self.last_verdict

    @gl.public.view
    def get_last_reason(self) -> str:
        return self.last_reason

    @gl.public.view
    def get_kill_switch(self) -> bool:
        return bool(self.kill_switch) or bool(self.frozen)

    @gl.public.view
    def can_proceed(self) -> bool:
        return not (bool(self.kill_switch) or bool(self.frozen) or int(self.spend_cap) <= 0)

    @gl.public.write
    def adjudicate(self, proposed_action: str, spend_amount: int, receipts: str) -> None:
        if bool(self.frozen):
            raise Exception("agent frozen by owner")
        if not proposed_action:
            raise Exception("empty action")

        spend = int(spend_amount)
        if spend < 0:
            raise Exception("spend_amount must be >= 0")

        mandate = self.mandate
        spend_cap = int(self.spend_cap)
        deadline = int(self.deadline)
        kill_switch = bool(self.kill_switch)

        prompt = f"""
You are a GenLayer mandate jury for an autonomous AI spending agent.
Decide whether the proposed action is still the job the agent was allowed to do.

MANDATE:
{mandate}

CURRENT_SPEND_CAP_USD: {spend_cap}
DEADLINE_UNIX: {deadline}
KILL_SWITCH: {kill_switch}

PROPOSED_ACTION:
{proposed_action}

SPEND_AMOUNT_USD: {spend}
RECEIPTS:
{receipts}

Choose exactly one verdict:
- CONTINUE: the action is a flight (or the mandated job) fully within the spend cap and deadline
- WARN: related to the job but drifting (wrong cabin, extras, fuzzy arrival) while still under the cap
- CONSTRAIN: partially on-mandate but the cap or destination must be reduced
- REVOKE: clearly a different job, lands after 6pm when the mandate forbids that, exceeds the cap, or is otherwise off-mandate

Hard rules:
- If SPEND_AMOUNT_USD is greater than CURRENT_SPEND_CAP_USD, verdict MUST be REVOKE
- If the action is lodging, hotel, transfer, crypto, or anything that is not the mandated job, verdict MUST be REVOKE
- If the mandate requires landing before 6pm and the action/receipts land at or after 18:00, verdict MUST be REVOKE
- If the action is an economy/coach flight at or under the cap that lands before 18:00, verdict MUST be CONTINUE

Respond using ONLY this JSON object:
{{
  "verdict": "CONTINUE" | "WARN" | "CONSTRAIN" | "REVOKE",
  "reason": "one short sentence"
}}
It is mandatory that you respond only using the JSON format above.
Don't include any other words or characters.
Your output must be only JSON without any formatting prefix or suffix.
"""

        def get_jury_answer() -> str:
            result = gl.nondet.exec_prompt(prompt)
            result = result.replace("```json", "").replace("```", "").strip()
            print(result)
            return result

        raw = gl.eq_principle.prompt_comparative(
            get_jury_answer, "The value of verdict has to match"
        )
        if isinstance(raw, dict):
            parsed = raw
        else:
            parsed = json.loads(str(raw).replace("```json", "").replace("```", "").strip())

        verdict = str(parsed.get("verdict", "")).strip().upper()
        reason = str(parsed.get("reason", "")).strip()
        if verdict not in ALLOWED_VERDICTS:
            raise Exception("invalid jury verdict: " + verdict)
        if not reason:
            reason = "Validator majority agreed on " + verdict

        self._apply_verdict(verdict, reason, proposed_action, receipts, spend)

    @gl.public.write
    def emergency_freeze(self) -> None:
        if str(gl.message.sender_address) != self.owner:
            raise Exception("only owner")
        self.frozen = True
        self.kill_switch = True
        self.approved_next_spend = 0
        self.last_verdict = "REVOKE"
        self.last_reason = "Owner emergency freeze"
        self.submission_count = int(self.submission_count) + 1

    @gl.public.write
    def appeal_and_unfreeze(self, new_spend_cap: int) -> None:
        if str(gl.message.sender_address) != self.owner:
            raise Exception("only owner")
        cap = int(new_spend_cap)
        if cap < 0:
            raise Exception("new_spend_cap must be >= 0")
        self.frozen = False
        self.kill_switch = cap <= 0
        self.spend_cap = cap
        self.threat_score = 0
        self.approved_next_spend = 0
        self.last_verdict = "NONE"
        self.last_reason = "Owner appeal restored the leash"
        self.submission_count = int(self.submission_count) + 1
