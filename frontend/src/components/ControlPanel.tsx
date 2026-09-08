"use client";

import { useState } from "react";
import { Frame } from "./Frame";
import {
  AGENT_ID,
  FALLBACK_LEASH_ADDRESS,
  HARDHAT_DEPLOYER_ADDRESS,
  RESTORE_CAP_USD,
} from "@/lib/config";
import {
  formatControlError,
  sendAppealAndUnfreeze,
  sendEmergencyFreeze,
} from "@/lib/control";
import { shortenAddress, shortenHash } from "@/lib/format";
import type { AgentSnapshot } from "@/lib/types";

type PendingAction = "freeze" | "reinstate" | null;

type LastAction = {
  kind: "freeze" | "reinstate";
  status: "confirmed" | "failed";
  hash?: string;
  blockNumber?: number;
  message: string;
};

export function ControlPanel({
  agent,
  onRefresh,
}: {
  agent: AgentSnapshot | null;
  onRefresh: () => Promise<void>;
}) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);

  const frozen = agent?.killSwitchStatus === "ACTIVE";
  const busy = pending !== null;
  const contractAddress = agent?.contractAddress ?? FALLBACK_LEASH_ADDRESS;
  const canAct = Boolean(agent);

  async function run(kind: "freeze" | "reinstate") {
    if (!canAct || busy) return;
    setPending(kind);
    setLastAction(null);
    try {
      const receipt =
        kind === "freeze"
          ? await sendEmergencyFreeze(contractAddress, AGENT_ID)
          : await sendAppealAndUnfreeze(contractAddress, AGENT_ID);
      await onRefresh();
      setLastAction({
        kind,
        status: "confirmed",
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        message:
          kind === "freeze"
            ? "Kill switch armed. Spend cap zeroed and ERC-7710 disabled."
            : `Agent reinstated. Spend cap restored to $${RESTORE_CAP_USD}.00.`,
      });
    } catch (error) {
      setLastAction({
        kind,
        status: "failed",
        message: formatControlError(error),
      });
    } finally {
      setPending(null);
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
            Manual Override
          </h2>
          <p className="mt-1 max-w-2xl font-mono text-[11px] leading-relaxed text-slate-500">
            Owner bypass of the AI jury. One click signs with Hardhat Account #0
            and sends the transaction to the local node — no MetaMask.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 font-mono text-[10px] tracking-widest text-slate-500">
          <span className="border border-white/8 bg-white/[0.03] px-3 py-1.5">
            SIGNER {shortenAddress(HARDHAT_DEPLOYER_ADDRESS)}
          </span>
          <span className="border border-white/8 bg-white/[0.03] px-3 py-1.5">
            AGENT {AGENT_ID}
          </span>
          <span
            className={`border px-3 py-1.5 ${
              frozen
                ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
            }`}
          >
            {frozen ? "OVERRIDE: FROZEN" : "OVERRIDE: LIVE"}
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <button
          type="button"
          disabled={!canAct || busy || frozen}
          onClick={() => void run("freeze")}
          className="group relative overflow-hidden border border-rose-500/45 bg-rose-600/15 px-5 py-5 text-left transition hover:border-rose-400/70 hover:bg-rose-600/25 hover:shadow-[0_0_36px_rgba(255,45,85,0.22)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-none"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-rose-400 to-transparent" />
          <p className="font-mono text-[10px] tracking-[0.32em] text-rose-300/80">
            {pending === "freeze" ? "BROADCASTING…" : frozen ? "ALREADY ARMED" : "OWNER COMMAND"}
          </p>
          <p className="mt-2 font-sans text-lg font-semibold tracking-[0.16em] text-rose-300">
            {pending === "freeze" ? "ARMING KILL SWITCH" : "EMERGENCY FREEZE"}
          </p>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-rose-100/70">
            Calls <span className="text-rose-200">emergencyFreeze({AGENT_ID})</span>. Pauses the
            agent, zeros the spend cap, and disables the ERC-7710 delegation.
          </p>
        </button>

        <button
          type="button"
          disabled={!canAct || busy || !frozen}
          onClick={() => void run("reinstate")}
          className="group relative overflow-hidden border border-emerald-400/45 bg-emerald-500/10 px-5 py-5 text-left transition hover:border-emerald-300/70 hover:bg-emerald-500/20 hover:shadow-[0_0_36px_rgba(0,255,156,0.22)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-none"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300 to-transparent" />
          <p className="font-mono text-[10px] tracking-[0.32em] text-emerald-300/80">
            {pending === "reinstate"
              ? "BROADCASTING…"
              : frozen
                ? "APPEAL PATH"
                : "AGENT ALREADY LIVE"}
          </p>
          <p className="mt-2 font-sans text-lg font-semibold tracking-[0.16em] text-emerald-300">
            {pending === "reinstate" ? "RESTORING AGENT" : "REINSTATE AGENT"}
          </p>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-emerald-100/70">
            Calls{" "}
            <span className="text-emerald-200">
              appealAndUnfreeze({AGENT_ID}, ${RESTORE_CAP_USD})
            </span>
            . Unpauses the agent, resets threat score, and restores the spend cap.
          </p>
        </button>
      </div>

      <div
        className={`mt-5 border px-4 py-3 font-mono text-[11px] tracking-wide ${
          lastAction?.status === "failed"
            ? "border-rose-500/35 bg-rose-500/10 text-rose-200"
            : lastAction?.status === "confirmed"
              ? lastAction.kind === "freeze"
                ? "border-rose-500/30 bg-rose-500/8 text-rose-100"
                : "border-emerald-400/30 bg-emerald-400/8 text-emerald-100"
              : "border-white/8 bg-black/25 text-slate-500"
        }`}
      >
        <p className="tracking-[0.28em]">
          {lastAction
            ? lastAction.status === "confirmed"
              ? "LAST ACTION CONFIRMED"
              : "LAST ACTION FAILED"
            : "AWAITING COMMAND"}
        </p>
        <p className="mt-1 text-[12px] text-slate-200">
          {lastAction
            ? lastAction.message
            : "Freeze to pull the leash. Reinstate to restore the $200 mandate cap."}
        </p>
        {lastAction?.hash ? (
          <p className="mt-1 text-slate-400">
            TX {shortenHash(lastAction.hash)} · BLOCK {lastAction.blockNumber}
          </p>
        ) : null}
      </div>
    </Frame>
  );
}
