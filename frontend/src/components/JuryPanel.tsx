"use client";

import { useState } from "react";
import { Frame } from "./Frame";
import { JURY_CASES, type JuryCase } from "@/lib/cases";
import { formatUsd, shortenAddress } from "@/lib/format";
import { PROMPT_INJECTION_SAMPLE, composeReceipts } from "@/lib/policies";
import type { AgentSnapshot, JuryWriteResult } from "@/lib/types";

export function JuryPanel({
  agent,
  onApplied,
}: {
  agent: AgentSnapshot | null;
  onApplied: (state: AgentSnapshot) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastWrite, setLastWrite] = useState<JuryWriteResult | null>(null);
  const [action, setAction] = useState("");
  const [spendAmount, setSpendAmount] = useState("186");
  const [receipts, setReceipts] = useState("");
  const [untrusted, setUntrusted] = useState("");

  async function submitAdjudication(input: {
    id: string;
    action: string;
    spendAmount: number;
    receipts: string;
    caseId?: string;
  }) {
    if (busyId) return;
    setBusyId(input.id);
    setLastWrite(null);
    try {
      const response = await fetch("/api/jury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: input.caseId,
          action: input.action,
          spendAmount: input.spendAmount,
          receipts: input.receipts,
        }),
      });
      const payload = (await response.json()) as JuryWriteResult;
      setLastWrite(payload);
      if (payload.ok && payload.state) onApplied(payload.state);
    } catch (error) {
      setLastWrite({
        ok: false,
        functionName: "adjudicate",
        error: "Dashboard could not reach /api/jury",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyId(null);
    }
  }

  async function submitCase(entry: JuryCase) {
    await submitAdjudication({
      id: entry.id,
      caseId: entry.id,
      action: entry.action,
      spendAmount: entry.spendAmount,
      receipts: entry.receipts,
    });
  }

  async function submitCustom() {
    const spend = Number(spendAmount);
    const proposed = action.trim();
    const evidence = composeReceipts(receipts, untrusted);
    if (!proposed || !Number.isFinite(spend) || spend < 0) {
      setLastWrite({
        ok: false,
        functionName: "adjudicate",
        error: "Enter a proposed action and a non-negative spend amount.",
      });
      return;
    }
    await submitAdjudication({
      id: "custom",
      action: proposed,
      spendAmount: spend,
      receipts: evidence,
    });
  }

  function fillInjection() {
    setAction(PROMPT_INJECTION_SAMPLE.action);
    setSpendAmount(String(PROMPT_INJECTION_SAMPLE.spendAmount));
    setReceipts(PROMPT_INJECTION_SAMPLE.receipts);
    setUntrusted(PROMPT_INJECTION_SAMPLE.untrusted);
  }

  const verdict = agent?.lastVerdict && agent.lastVerdict !== "NONE" ? agent.lastVerdict : null;
  const tone = verdictTone(verdict);

  return (
    <Frame
      tone={tone}
      className={`border bg-[#070d14]/85 p-6 backdrop-blur-md ${
        tone === "red"
          ? "border-rose-500/25 shadow-[0_0_40px_rgba(255,45,85,0.08)]"
          : tone === "amber"
            ? "border-amber-400/25 shadow-[0_0_40px_rgba(245,185,66,0.08)]"
            : "border-cyan-400/20 shadow-[0_0_40px_rgba(77,228,255,0.06)]"
      }`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[10px] tracking-[0.38em] text-cyan-400/80">
            09 // MANDATE JURY
          </p>
          <h2 className="mt-2 font-sans text-sm font-semibold tracking-[0.22em] text-slate-100 uppercase">
            Validator-decided adjudication
          </h2>
          <p className="mt-1 max-w-3xl font-mono text-[11px] leading-relaxed text-slate-500">
            Submits `adjudicate(proposed_action, spend_amount, receipts)` on the
            Studio Next Intelligent Contract. Validators agree on CONTINUE,
            THROTTLE, or REVOKE, then the dashboard reads the new state.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 font-mono text-[10px] tracking-widest text-slate-500">
          <span className="border border-white/8 bg-white/[0.03] px-3 py-1.5">
            METHOD adjudicate
          </span>
          <span className="border border-white/8 bg-white/[0.03] px-3 py-1.5">
            SUBMISSIONS {agent?.submissionCount ?? "0"}
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {JURY_CASES.map((entry) => {
          const active = busyId === entry.id;
          const throttle = entry.expected === "THROTTLE";
          return (
            <button
              key={entry.id}
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => void submitCase(entry)}
              className={
                throttle
                  ? "border border-amber-400/55 bg-amber-500/[0.08] px-4 py-4 text-left shadow-[0_0_28px_rgba(245,185,66,0.16)] transition hover:border-amber-300/80 hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                  : "border border-cyan-400/20 bg-black/30 px-4 py-4 text-left transition hover:border-cyan-300/50 hover:bg-cyan-500/5 disabled:cursor-not-allowed disabled:opacity-40"
              }
            >
              <p
                className={`font-mono text-[10px] tracking-[0.28em] ${
                  throttle ? "text-amber-300" : "text-cyan-400/80"
                }`}
              >
                {throttle ? "V1 · THROTTLE" : entry.id.toUpperCase()}
              </p>
              <p className="mt-2 font-sans text-sm font-semibold tracking-wide text-slate-100">
                {entry.title}
              </p>
              <p className="mt-1 font-mono text-[11px] text-slate-500">
                {entry.summary}
              </p>
              <p
                className={`mt-3 font-mono text-[10px] tracking-[0.22em] ${
                  throttle ? "text-amber-200" : "text-slate-400"
                }`}
              >
                {active
                  ? "WAITING ON VALIDATORS…"
                  : `EXPECT ${entry.expected} · ${formatUsd(entry.spendAmount)}`}
              </p>
              {throttle ? (
                <p className="mt-2 font-mono text-[10px] leading-relaxed tracking-wide text-amber-100/80">
                  Same flight, premium cabin, under the cap. On the default flight mandate, THROTTLE halves spend_cap and leaves the kill switch off. The Flight/Commerce template rejects cabin upgrades.
                </p>
              ) : null}
            </button>
          );
        })}
      </div>

      <form
        className="mt-5 border border-cyan-400/15 bg-black/25 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submitCustom();
        }}
      >
        <p className="font-mono text-[10px] tracking-[0.32em] text-cyan-400/80">
          CUSTOM LIVE ADJUDICATION
        </p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="block lg:col-span-2">
            <span className="font-mono text-[10px] tracking-[0.28em] text-slate-500">
              PROPOSED ACTION
            </span>
            <textarea
              value={action}
              onChange={(event) => setAction(event.target.value)}
              rows={3}
              className="mt-2 w-full border border-cyan-400/20 bg-black/40 px-3 py-3 font-mono text-xs leading-relaxed text-cyan-50 outline-none focus:border-cyan-300/60"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.28em] text-slate-500">
              SPEND AMOUNT $
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={spendAmount}
              onChange={(event) => setSpendAmount(event.target.value)}
              className="mt-2 w-full border border-cyan-400/20 bg-black/40 px-3 py-3 font-mono text-xs text-cyan-50 outline-none focus:border-cyan-300/60"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.28em] text-slate-500">
              RECEIPTS
            </span>
            <textarea
              value={receipts}
              onChange={(event) => setReceipts(event.target.value)}
              rows={3}
              className="mt-2 w-full border border-cyan-400/20 bg-black/40 px-3 py-3 font-mono text-xs leading-relaxed text-cyan-50 outline-none focus:border-cyan-300/60"
            />
          </label>
          <label className="block lg:col-span-2">
            <span className="font-mono text-[10px] tracking-[0.28em] text-slate-500">
              UNTRUSTED CONTEXT
            </span>
            <textarea
              value={untrusted}
              onChange={(event) => setUntrusted(event.target.value)}
              rows={3}
              placeholder="Receipt notes and any untrusted text the jury must treat as data."
              className="mt-2 w-full border border-cyan-400/20 bg-black/40 px-3 py-3 font-mono text-xs leading-relaxed text-cyan-50 outline-none placeholder:text-slate-600 focus:border-cyan-300/60"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="submit"
            disabled={Boolean(busyId)}
            className="border border-cyan-400/45 bg-cyan-500/10 px-5 py-3 text-left font-mono text-[11px] tracking-[0.22em] text-cyan-100 transition hover:border-cyan-300/70 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busyId === "custom" ? "WAITING ON VALIDATORS…" : "ADJUDICATE ON-CHAIN"}
          </button>
          <button
            type="button"
            disabled={Boolean(busyId)}
            onClick={fillInjection}
            className="border border-rose-400/45 bg-rose-500/10 px-5 py-3 text-left font-mono text-[11px] tracking-[0.18em] text-rose-100 transition hover:border-rose-300/70 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Simulate Prompt Injection Attack
          </button>
        </div>
        <p className="mt-3 font-mono text-[11px] leading-relaxed text-slate-500">
          The injection button fills the four fields with a jailbreak hidden in untrusted context. Submit it with Adjudicate On-Chain. The call is a real `adjudicate` transaction, and the contract is expected to answer REVOKE / PROMPT_INJECTION.
        </p>
      </form>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <VerdictCard
          label="Last verdict"
          value={verdict ?? "NONE"}
          detail={
            agent?.lastReason
              ? agent.lastReason
              : "No validator decision has been written yet. Submit a case."
          }
          alert={verdict === "REVOKE"}
        />
        <VerdictCard
          label="Last action judged"
          value={agent?.lastAction ? agent.lastAction : "—"}
          detail={
            agent?.lastReceipts
              ? agent.lastReceipts
              : "Receipts from the last adjudicate() call appear here after finality."
          }
        />
      </div>

      {busyId ? (
        <p className="mt-4 font-mono text-[11px] tracking-wide text-cyan-300">
          Consensus in progress on studio_next. Leader proposes, validators
          compare `verdict`, then the write finalizes. This usually takes 1–3
          minutes.
        </p>
      ) : null}

      {lastWrite ? <WriteStatus write={lastWrite} /> : null}
    </Frame>
  );
}

function verdictTone(verdict: string | null): "green" | "red" | "amber" | "cyan" {
  if (verdict === "REVOKE") return "red";
  if (verdict === "THROTTLE" || verdict === "WARN" || verdict === "CONSTRAIN") return "amber";
  if (verdict === "CONTINUE") return "green";
  return "cyan";
}

function VerdictCard({
  label,
  value,
  detail,
  alert,
}: {
  label: string;
  value: string;
  detail: string;
  alert?: boolean;
}) {
  return (
    <div className="border border-white/8 bg-black/25 px-4 py-4">
      <p className="font-mono text-[10px] tracking-[0.32em] text-slate-500">
        {label.toUpperCase()}
      </p>
      <p
        className={`mt-2 font-mono text-sm leading-relaxed ${
          alert ? "text-rose-300" : "text-slate-100"
        }`}
      >
        {value}
      </p>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-slate-500">
        {detail}
      </p>
    </div>
  );
}

function WriteStatus({ write }: { write: JuryWriteResult }) {
  if (!write.ok) {
    return (
      <div className="mt-4 border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-mono text-[11px] text-rose-100">
        <p className="tracking-[0.28em] text-rose-400">JURY WRITE FAILED</p>
        <p className="mt-1">{write.error}</p>
        {write.detail ? (
          <p className="mt-1 break-all text-rose-300/80">{write.detail}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-4 border border-emerald-400/25 bg-emerald-500/8 px-4 py-3 font-mono text-[11px] text-emerald-100">
      <p className="tracking-[0.28em] text-emerald-400">FINALIZED ON STUDIO NEXT</p>
      <p className="mt-1">
        {write.functionName} · {write.status || "FINALIZED"} ·{" "}
        {write.result || "MAJORITY_AGREE"}
      </p>
      {write.txHash ? (
        <p className="mt-1 text-emerald-200/80">
          tx {shortenAddress(write.txHash, 8)}
        </p>
      ) : null}
      {write.state ? (
        <p className="mt-1 text-emerald-200/80">
          Read-back: verdict {write.state.lastVerdict} · spend_cap{" "}
          {write.state.spendCapUsd} · kill {write.state.killSwitchStatus}
        </p>
      ) : null}
    </div>
  );
}
