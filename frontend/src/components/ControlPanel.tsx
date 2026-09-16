"use client";

import { useState } from "react";
import { Frame } from "./Frame";
import { FALLBACK_LEASH_ADDRESS } from "@/lib/config";
import { shortenAddress } from "@/lib/format";
import type { AgentSnapshot, JuryWriteResult } from "@/lib/types";

export function ControlPanel({
  agent,
  onRefresh,
  onApplied,
}: {
  agent: AgentSnapshot | null;
  onRefresh: () => Promise<void>;
  onApplied: (state: AgentSnapshot) => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<"freeze" | "unfreeze" | null>(null);
  const [lastWrite, setLastWrite] = useState<JuryWriteResult | null>(null);
  const frozen = agent?.killSwitchStatus === "ACTIVE";
  const contractAddress = agent?.contractAddress ?? FALLBACK_LEASH_ADDRESS;

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  async function control(action: "freeze" | "unfreeze") {
    if (busy) return;
    setBusy(action);
    setLastWrite(null);
    try {
      const response = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "unfreeze"
            ? { action, newSpendCap: 200 }
            : { action }
        ),
      });
      const payload = (await response.json()) as JuryWriteResult;
      setLastWrite(payload);
      if (payload.ok && payload.state) onApplied(payload.state);
    } catch (error) {
      setLastWrite({
        ok: false,
        functionName:
          action === "freeze" ? "emergency_freeze" : "appeal_and_unfreeze",
        error: "Dashboard could not reach /api/control",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Frame
      tone={frozen ? "red" : "green"}
      className={`border bg-[#070d14]/85 p-6 backdrop-blur-md ${
        frozen
          ? "border-rose-500/25 shadow-[0_0_40px_rgba(255,45,85,0.08)]"
          : "border-emerald-400/20 shadow-[0_0_40px_rgba(0,255,156,0.06)]"
      }`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p
            className={`font-mono text-[10px] tracking-[0.38em] ${
              frozen ? "text-rose-400/80" : "text-emerald-400/80"
            }`}
          >
            05 // CONTROL PANEL
          </p>
          <h2 className="mt-2 font-sans text-sm font-semibold tracking-[0.22em] text-slate-100 uppercase">
            Live Intelligent Contract
          </h2>
          <p className="mt-1 max-w-2xl font-mono text-[11px] leading-relaxed text-slate-500">
            Dashboard calls the Python contract API through genlayer-js:
            `get_state`, `adjudicate`, `emergency_freeze`,
            `appeal_and_unfreeze`. Schema reports {agent ? agent.methodCount : "—"}{" "}
            public methods.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 font-mono text-[10px] tracking-widest text-slate-500">
          <span className="border border-white/8 bg-white/[0.03] px-3 py-1.5">
            LEASH {shortenAddress(contractAddress)}
          </span>
          <span className="border border-white/8 bg-white/[0.03] px-3 py-1.5">
            METHODS {agent ? agent.methodCount : "—"}
          </span>
          <span
            className={`border px-3 py-1.5 ${
              frozen
                ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
            }`}
          >
            {frozen ? "KILL SWITCH ACTIVE" : "GATE OPEN"}
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <StateTile label="MANDATE" value={agent?.mandate ?? "—"} />
        <StateTile label="SPEND_CAP" value={agent?.spendCapUsd ?? "—"} />
        <StateTile
          label="LAST_VERDICT"
          value={agent?.lastVerdict && agent.lastVerdict !== "NONE" ? agent.lastVerdict : "NONE"}
        />
      </div>

      {agent?.methods?.length ? (
        <p className="mt-4 font-mono text-[10px] leading-relaxed tracking-wide text-slate-500">
          ABI {agent.methods.join(" · ")}
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={refreshing || Boolean(busy)}
            onClick={() => void refresh()}
            className="border border-emerald-400/45 bg-emerald-500/10 px-5 py-3 text-left font-mono text-[11px] tracking-[0.22em] text-emerald-200 transition hover:border-emerald-300/70 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {refreshing ? "READING GET_STATE…" : "REFRESH ON-CHAIN STATE"}
          </button>
          <button
            type="button"
            disabled={Boolean(busy) || Boolean(agent?.frozen)}
            onClick={() => void control("freeze")}
            className="border border-rose-400/45 bg-rose-500/10 px-5 py-3 text-left font-mono text-[11px] tracking-[0.22em] text-rose-200 transition hover:border-rose-300/70 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "freeze" ? "FREEZING…" : "EMERGENCY FREEZE"}
          </button>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void control("unfreeze")}
            className="border border-cyan-400/45 bg-cyan-500/10 px-5 py-3 text-left font-mono text-[11px] tracking-[0.22em] text-cyan-200 transition hover:border-cyan-300/70 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "unfreeze" ? "RESTORING…" : "APPEAL + UNFREEZE $200"}
          </button>
        </div>
        <p className="font-mono text-[11px] leading-relaxed text-slate-500">
          Reads `get_state`. Writes wait for Studio Next finality, then read the
          mutated spend_cap / kill_switch / last_verdict back.
        </p>
      </div>

      {lastWrite ? (
        <p
          className={`mt-4 font-mono text-[11px] ${
            lastWrite.ok ? "text-emerald-300" : "text-rose-300"
          }`}
        >
          {lastWrite.ok
            ? `${lastWrite.functionName} finalized · ${lastWrite.txHash ?? ""}`
            : `${lastWrite.error}${lastWrite.detail ? ` — ${lastWrite.detail}` : ""}`}
        </p>
      ) : null}
    </Frame>
  );
}

function StateTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/8 bg-black/25 px-4 py-4">
      <p className="font-mono text-[10px] tracking-[0.32em] text-slate-500">{label}</p>
      <p className="mt-2 font-mono text-sm leading-relaxed text-slate-100">{value}</p>
    </div>
  );
}
