"use client";

import { useState } from "react";
import { Frame } from "./Frame";
import { formatUsd } from "@/lib/format";
import type { AgentResponse, AgentSnapshot, AuditEntry } from "@/lib/types";

export function AuditLog({
  agent,
  onApplied,
}: {
  agent: AgentSnapshot | null;
  onApplied: (state: AgentSnapshot) => void;
}) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const rows = agent?.auditHistory ?? [];

  async function exportProof() {
    if (exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const response = await fetch("/api/agent", { cache: "no-store" });
      const payload = (await response.json()) as AgentResponse;
      if (!payload.ok) {
        setExportError(payload.error || "The on-chain read failed.");
        return;
      }
      onApplied(payload);
      const proof = {
        protocol: "LEASH Protocol v1.0",
        network: "studio_next",
        chainId: payload.chainId,
        rpc: payload.rpc,
        contractAddress: payload.contractAddress,
        exportedAt: new Date().toISOString(),
        source: "get_state",
        state: {
          mandate: payload.mandate,
          spend_cap: payload.spendCap,
          deadline: payload.deadline,
          owner: payload.owner,
          kill_switch: payload.killSwitch,
          frozen: payload.frozen,
          last_verdict: payload.lastVerdict,
          last_reason: payload.lastReason,
          last_action: payload.lastAction,
          last_receipts: payload.lastReceipts,
          last_spend: payload.lastSpend,
          approved_next_spend: payload.approvedNextSpend,
          threat_score: payload.threatScore,
          threat_threshold: payload.threatThreshold,
          submission_count: payload.submissionCount,
          can_proceed: payload.canProceed,
          last_risk_score: payload.lastRiskScore,
          last_threat_category: payload.lastThreatCategory,
          total_adjudications: payload.totalAdjudications,
          total_blocked_volume: payload.totalBlockedVolume,
          prompt_injections_blocked: payload.promptInjectionsBlocked,
          threats_neutralized: payload.threatsNeutralized,
        },
        auditHistory: payload.auditHistory.map(toChainAudit),
      };
      const blob = new Blob([JSON.stringify(proof, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = proof.exportedAt.replace(/[:.]/g, "-");
      anchor.href = url;
      anchor.download = `leash-audit-proof-${payload.contractAddress}-${stamp}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Frame className="border border-emerald-400/20 bg-[#070d14]/85 p-6 shadow-[0_0_40px_rgba(0,255,156,0.06)] backdrop-blur-md">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[10px] tracking-[0.38em] text-emerald-400/80">
            11 // AUDIT LOG
          </p>
          <h2 className="mt-2 font-sans text-sm font-semibold tracking-[0.22em] text-slate-100 uppercase">
            On-chain audit history
          </h2>
          <p className="mt-1 max-w-3xl font-mono text-[11px] leading-relaxed text-slate-500">
            Rows come from `audit_history` inside `get_state`. The export downloads that read, plus the telemetry fields, as JSON.
          </p>
        </div>
        <button
          type="button"
          disabled={exporting}
          onClick={() => void exportProof()}
          className="border border-emerald-400/45 bg-emerald-500/10 px-5 py-3 text-left font-mono text-[11px] tracking-[0.18em] text-emerald-100 transition hover:border-emerald-300/70 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {exporting ? "READING CHAIN…" : "EXPORT ON-CHAIN AUDIT PROOF (.JSON)"}
        </button>
      </div>

      {exportError ? (
        <p className="mt-4 font-mono text-[11px] text-rose-300">{exportError}</p>
      ) : null}

      <div className="mt-5 overflow-x-auto border border-white/8">
        <table className="min-w-[920px] w-full border-collapse text-left">
          <thead className="bg-black/40 font-mono text-[10px] tracking-[0.22em] text-slate-500">
            <tr>
              <th className="px-3 py-3 font-medium">ID</th>
              <th className="px-3 py-3 font-medium">KIND</th>
              <th className="px-3 py-3 font-medium">VERDICT</th>
              <th className="px-3 py-3 font-medium">THREAT</th>
              <th className="px-3 py-3 font-medium">RISK</th>
              <th className="px-3 py-3 font-medium">SPEND</th>
              <th className="px-3 py-3 font-medium">CAP AFTER</th>
              <th className="px-3 py-3 font-medium">REASON</th>
            </tr>
          </thead>
          <tbody className="font-mono text-[11px] text-slate-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-slate-500">
                  No audit rows on this contract yet. A finalized adjudicate, policy update, freeze, or appeal appends one.
                </td>
              </tr>
            ) : (
              [...rows].reverse().map((row) => (
                <tr key={`${row.id}-${row.kind}`} className="border-t border-white/6 align-top">
                  <td className="px-3 py-3 text-slate-400">{row.id}</td>
                  <td className="px-3 py-3">{row.kind}</td>
                  <td className={`px-3 py-3 ${verdictClass(row.verdict)}`}>{row.verdict}</td>
                  <td className="px-3 py-3">{row.threatCategory}</td>
                  <td className="px-3 py-3">{row.riskScore}</td>
                  <td className="px-3 py-3">{formatUsd(row.spend)}</td>
                  <td className="px-3 py-3">{formatUsd(row.spendCapAfter)}</td>
                  <td className="px-3 py-3 text-slate-400">{row.reason || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Frame>
  );
}

function verdictClass(verdict: string): string {
  if (verdict === "REVOKE") return "text-rose-300";
  if (verdict === "THROTTLE") return "text-amber-300";
  if (verdict === "CONTINUE") return "text-emerald-300";
  return "text-slate-200";
}

function toChainAudit(row: AuditEntry) {
  return {
    id: row.id,
    kind: row.kind,
    action: row.action,
    receipts: row.receipts,
    spend: row.spend,
    verdict: row.verdict,
    reason: row.reason,
    risk_score: row.riskScore,
    threat_category: row.threatCategory,
    spend_cap_after: row.spendCapAfter,
    kill_switch: row.killSwitch,
    blocked_volume: row.blockedVolume,
    timestamp: row.timestamp,
  };
}
