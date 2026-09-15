"use client";

import { useState } from "react";
import { Frame } from "./Frame";
import { FALLBACK_LEASH_ADDRESS } from "@/lib/config";
import { shortenAddress } from "@/lib/format";
import type { AgentSnapshot } from "@/lib/types";

export function ControlPanel({
  agent,
  onRefresh,
}: {
  agent: AgentSnapshot | null;
  onRefresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
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
            The deployed leash.py contract exposes storage variables only:
            mandate, spend_cap, and deadline. Schema reports {agent ? agent.methodCount : "—"} public
            methods, so owner freeze/unfreeze writes are not available on this network.
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
            {frozen ? "OVERRIDE: LOCKED" : "OVERRIDE: LIVE READ"}
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <StateTile label="MANDATE" value={agent?.mandate ?? "—"} />
        <StateTile label="SPEND_CAP" value={agent?.spendCapUsd ?? "—"} />
        <StateTile
          label="DEADLINE"
          value={
            agent
              ? agent.deadlineOpen
                ? "0 (OPEN)"
                : String(agent.deadline)
              : "—"
          }
        />
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void refresh()}
          className="border border-emerald-400/45 bg-emerald-500/10 px-5 py-3 text-left font-mono text-[11px] tracking-[0.22em] text-emerald-200 transition hover:border-emerald-300/70 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {refreshing ? "READING STUDIO NEXT…" : "REFRESH ON-CHAIN STATE"}
        </button>
        <p className="font-mono text-[11px] leading-relaxed text-slate-500">
          Reads go through genlayer-js `readContract` / `gen_call` against
          https://studio-next.genlayer.com/api (chain 61997).
        </p>
      </div>
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
