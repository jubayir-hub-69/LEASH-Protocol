"use client";

import { useState } from "react";
import { Frame } from "./Frame";
import { JURY_CASES, type JuryCase } from "@/lib/cases";
import { formatUsd, shortenAddress } from "@/lib/format";
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

  async function submitCase(entry: JuryCase) {
    if (busyId) return;
    setBusyId(entry.id);
    setLastWrite(null);
    try {
      const response = await fetch("/api/jury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: entry.id }),
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
            06 // MANDATE JURY
          </p>
          <h2 className="mt-2 font-sans text-sm font-semibold tracking-[0.22em] text-slate-100 uppercase">
            Validator-decided adjudication
          </h2>
          <p className="mt-1 max-w-3xl font-mono text-[11px] leading-relaxed text-slate-500">
            Submits `adjudicate(proposed_action, spend_amount, receipts)` on the
            Studio Next Intelligent Contract. GenLayer validators run the LLM
            jury, agree on `verdict`, write it to contract state, then the
            dashboard reads it back with `get_state`.
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
          return (
            <button
              key={entry.id}
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => void submitCase(entry)}
              className="border border-cyan-400/20 bg-black/30 px-4 py-4 text-left transition hover:border-cyan-300/50 hover:bg-cyan-500/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <p className="font-mono text-[10px] tracking-[0.28em] text-cyan-400/80">
                {entry.id.toUpperCase()}
              </p>
              <p className="mt-2 font-sans text-sm font-semibold tracking-wide text-slate-100">
                {entry.title}
              </p>
              <p className="mt-1 font-mono text-[11px] text-slate-500">
                {entry.summary}
              </p>
              <p className="mt-3 font-mono text-[10px] tracking-[0.22em] text-slate-400">
                {active
                  ? "WAITING ON VALIDATORS…"
                  : `EXPECT ${entry.expected} · ${formatUsd(entry.spendAmount)}`}
              </p>
            </button>
          );
        })}
      </div>

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
  if (verdict === "WARN" || verdict === "CONSTRAIN") return "amber";
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
