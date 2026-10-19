"use client";

import { useState } from "react";
import { Frame } from "./Frame";
import { formatCountdown, formatUnix, shortenAddress } from "@/lib/format";
import { INDUSTRY_POLICIES, type IndustryPolicy } from "@/lib/policies";
import type { AgentSnapshot, JuryWriteResult } from "@/lib/types";

export function MandatePanel({
  agent,
  onApplied,
}: {
  agent: AgentSnapshot | null;
  onApplied: (state: AgentSnapshot) => void;
}) {
  const [draft, setDraft] = useState<{
    mandate: string;
    spendCap: string;
    deadline: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastWrite, setLastWrite] = useState<JuryWriteResult | null>(null);
  const mandate = draft?.mandate ?? agent?.mandate ?? "";
  const spendCap = draft?.spendCap ?? agent?.spendCap ?? "200";
  const deadline = draft?.deadline ?? String(agent?.deadline ?? 0);

  function editDraft(partial: Partial<{ mandate: string; spendCap: string; deadline: string }>) {
    setDraft({ mandate, spendCap, deadline, ...partial });
  }

  async function publish(next: {
    id: string;
    mandate: string;
    spendCap: number;
    deadline: number;
  }) {
    if (busy) return;
    setBusy(next.id);
    setLastWrite(null);
    setDraft({
      mandate: next.mandate,
      spendCap: String(next.spendCap),
      deadline: String(next.deadline),
    });
    try {
      const response = await fetch("/api/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_policy",
          mandate: next.mandate,
          spendCap: next.spendCap,
          deadline: next.deadline,
        }),
      });
      const payload = (await response.json()) as JuryWriteResult;
      setLastWrite(payload);
      if (payload.ok && payload.state) {
        setDraft(null);
        onApplied(payload.state);
      }
    } catch (error) {
      setLastWrite({
        ok: false,
        functionName: "update_policy",
        error: "Dashboard could not reach /api/control",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  }

  function applyTemplate(policy: IndustryPolicy) {
    void publish({
      id: policy.id,
      mandate: policy.mandate,
      spendCap: policy.spendCap,
      deadline: policy.deadline,
    });
  }

  function applyCustom() {
    const cap = Number(spendCap);
    const window = Number(deadline);
    if (!mandate.trim() || !Number.isFinite(cap) || cap < 0 || !Number.isInteger(window) || window < 0) {
      setLastWrite({
        ok: false,
        functionName: "update_policy",
        error: "Enter a mandate, a non-negative spend cap, and a non-negative integer deadline.",
      });
      return;
    }
    void publish({
      id: "custom",
      mandate: mandate.trim(),
      spendCap: cap,
      deadline: window,
    });
  }

  return (
    <Frame className="border border-cyan-400/20 bg-[#070d14]/85 p-6 shadow-[0_0_40px_rgba(77,228,255,0.06)] backdrop-blur-md" tone="cyan">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] tracking-[0.38em] text-cyan-400/80">
            08 // POLICY
          </p>
          <h2 className="mt-2 font-sans text-sm font-semibold tracking-[0.22em] text-slate-100 uppercase">
            Current Mandate
          </h2>
          <p className="mt-1 font-mono text-[11px] text-slate-500">
            Live `mandate` from `get_state`. Industry templates and the editor call `update_policy` on Studio Next.
          </p>
        </div>
        {agent ? (
          <p className="font-mono text-[10px] tracking-widest text-slate-500">
            LEASH {shortenAddress(agent.contractAddress, 6)}
          </p>
        ) : null}
      </div>

      <blockquote className="relative mt-5 overflow-hidden rounded-sm border border-cyan-400/15 bg-black/35 px-5 py-6">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-cyan-400 via-emerald-400 to-transparent" />
        <p className="font-mono text-sm leading-relaxed text-cyan-50 sm:text-lg">
          {agent?.mandate ? `“${agent.mandate}”` : "Waiting for on-chain mandate…"}
        </p>
      </blockquote>

      <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Spend cap" value={agent ? agent.spendCapUsd : "—"} />
        <Fact
          label="Deadline"
          value={
            agent
              ? agent.deadlineOpen
                ? "OPEN · deadline = 0"
                : `${formatCountdown(agent.deadline)} · ${formatUnix(agent.deadline)}`
              : "—"
          }
        />
        <Fact
          label="Last verdict"
          value={
            agent?.lastVerdict && agent.lastVerdict !== "NONE"
              ? agent.lastVerdict
              : "NONE"
          }
          alert={agent?.lastVerdict === "REVOKE"}
        />
        <Fact
          label="Jury gate"
          value={
            agent
              ? agent.canProceed
                ? "CAN PROCEED"
                : agent.canProceedReason.toUpperCase()
              : "—"
          }
          alert={Boolean(agent && !agent.canProceed)}
        />
      </dl>

      <div className="mt-6">
        <p className="font-mono text-[10px] tracking-[0.32em] text-cyan-400/80">
          INDUSTRY USE-CASE SWITCHER
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {INDUSTRY_POLICIES.map((policy) => {
            const active = busy === policy.id;
            return (
              <button
                key={policy.id}
                type="button"
                disabled={Boolean(busy)}
                onClick={() => applyTemplate(policy)}
                className="border border-cyan-400/20 bg-black/30 px-4 py-4 text-left transition hover:border-cyan-300/50 hover:bg-cyan-500/5 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <p className="font-sans text-sm font-semibold tracking-wide text-slate-100">
                  {policy.title}
                </p>
                <p className="mt-1 font-mono text-[11px] text-slate-500">{policy.summary}</p>
                <p className="mt-3 font-mono text-[10px] tracking-[0.22em] text-cyan-300/80">
                  {active ? "WRITING UPDATE_POLICY…" : "APPLY ON-CHAIN"}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 border border-white/8 bg-black/25 p-4">
        <p className="font-mono text-[10px] tracking-[0.32em] text-slate-500">
          CUSTOM MANDATE EDITOR
        </p>
        <label className="mt-4 block">
          <span className="font-mono text-[10px] tracking-[0.28em] text-slate-500">MANDATE</span>
          <textarea
            value={mandate}
            onChange={(event) => editDraft({ mandate: event.target.value })}
            rows={4}
            className="mt-2 w-full border border-cyan-400/20 bg-black/40 px-3 py-3 font-mono text-xs leading-relaxed text-cyan-50 outline-none focus:border-cyan-300/60"
          />
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.28em] text-slate-500">SPEND CAP $</span>
            <input
              type="number"
              min={0}
              step={1}
              value={spendCap}
              onChange={(event) => editDraft({ spendCap: event.target.value })}
              className="mt-2 w-full border border-cyan-400/20 bg-black/40 px-3 py-3 font-mono text-xs text-cyan-50 outline-none focus:border-cyan-300/60"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.28em] text-slate-500">DEADLINE UNIX</span>
            <input
              type="number"
              min={0}
              step={1}
              value={deadline}
              onChange={(event) => editDraft({ deadline: event.target.value })}
              className="mt-2 w-full border border-cyan-400/20 bg-black/40 px-3 py-3 font-mono text-xs text-cyan-50 outline-none focus:border-cyan-300/60"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={applyCustom}
            className="border border-cyan-400/45 bg-cyan-500/10 px-5 py-3 text-left font-mono text-[11px] tracking-[0.22em] text-cyan-100 transition hover:border-cyan-300/70 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "custom" ? "WRITING UPDATE_POLICY…" : "UPDATE POLICY ON-CHAIN"}
          </button>
          <p className="font-mono text-[11px] leading-relaxed text-slate-500">
            Deadline 0 keeps the window open. This write does not clear an active kill switch.
          </p>
        </div>
      </div>

      {busy ? (
        <p className="mt-4 font-mono text-[11px] tracking-wide text-cyan-300">
          update_policy is finalizing on studio_next. The mandate card refreshes from get_state after consensus.
        </p>
      ) : null}
      {lastWrite ? <PolicyStatus write={lastWrite} /> : null}
    </Frame>
  );
}

function Fact({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="border border-white/6 bg-white/[0.02] px-3 py-3">
      <dt className="font-mono text-[10px] tracking-[0.28em] text-slate-500 uppercase">
        {label}
      </dt>
      <dd
        className={`mt-1.5 font-mono text-xs tracking-wide ${
          alert ? "text-amber-300" : "text-slate-200"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function PolicyStatus({ write }: { write: JuryWriteResult }) {
  if (!write.ok) {
    return (
      <div className="mt-4 border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-mono text-[11px] text-rose-100">
        <p className="tracking-[0.28em] text-rose-400">POLICY WRITE FAILED</p>
        <p className="mt-1">{write.error}</p>
        {write.detail ? <p className="mt-1 break-all text-rose-300/80">{write.detail}</p> : null}
      </div>
    );
  }
  return (
    <div className="mt-4 border border-emerald-400/25 bg-emerald-500/8 px-4 py-3 font-mono text-[11px] text-emerald-100">
      <p className="tracking-[0.28em] text-emerald-400">POLICY FINALIZED ON STUDIO NEXT</p>
      <p className="mt-1">
        {write.functionName} · {write.status || "FINALIZED"}
        {write.txHash ? ` · ${write.txHash}` : ""}
      </p>
      {write.state ? (
        <p className="mt-1 text-emerald-200/80">
          Read-back mandate is live · spend_cap {write.state.spendCapUsd}
        </p>
      ) : null}
    </div>
  );
}
