import { Frame } from "./Frame";
import type { AgentSnapshot } from "@/lib/types";

export function StatusCards({ agent }: { agent: AgentSnapshot | null }) {
  const spend = agent?.spendCapUsd ?? "—";
  const threat = agent?.threatScore ?? 0;
  const threshold = agent?.threatThreshold ?? 10;
  const killActive = agent?.killSwitchStatus === "ACTIVE";
  const threatRatio = threshold > 0 ? Math.min(threat / threshold, 1) : 0;
  const threatTone =
    killActive || threatRatio >= 1
      ? "red"
      : threatRatio >= 0.4
        ? "amber"
        : "green";

  return (
    <section className="grid gap-4 md:grid-cols-3">
      <StatusCard
        tone={killActive || spend === "$0.00" ? "red" : "green"}
        kicker="01"
        title="Current Spend Cap"
        value={spend}
        hint="Remaining allowance the agent may still spend"
        footer={
          agent
            ? `Approved next spend ${agent.approvedNextSpendUsd} · nonce ${agent.nonce}`
            : "Awaiting chain state"
        }
      >
        <CapBar empty={spend === "$0.00" || killActive} />
      </StatusCard>

      <StatusCard
        tone={threatTone}
        kicker="02"
        title="Agent Threat Score"
        value={`${agent ? threat : "—"} / ${threshold}`}
        hint="Warn points toward the kill-switch threshold"
        footer={
          agent
            ? `${agent.warningCount} warning${agent.warningCount === 1 ? "" : "s"} logged · last verdict ${agent.lastVerdict}`
            : "Awaiting chain state"
        }
      >
        <ThreatMeter value={threat} max={threshold} />
      </StatusCard>

      <StatusCard
        tone={killActive ? "red" : "green"}
        kicker="03"
        title="Kill Switch Status"
        value={agent ? agent.killSwitchStatus : "—"}
        hint={killActive ? "ERC-7710 delegation disabled" : "Active / Disabled"}
        footer={
          agent
            ? killActive
              ? "Agent paused · spend cap zeroed · second tx cannot leave"
              : "Agent operational · caveat enforcer gate open"
            : "Awaiting chain state"
        }
        pulse={killActive}
      >
        <SwitchGlyph active={killActive} />
      </StatusCard>
    </section>
  );
}

function StatusCard({
  tone,
  kicker,
  title,
  value,
  hint,
  footer,
  children,
  pulse,
}: {
  tone: "green" | "red" | "amber";
  kicker: string;
  title: string;
  value: string;
  hint: string;
  footer: string;
  children: React.ReactNode;
  pulse?: boolean;
}) {
  const palette = {
    green: {
      border: "border-emerald-400/25",
      glow: "shadow-[0_0_40px_rgba(0,255,156,0.08)]",
      value: "text-emerald-300",
      kicker: "text-emerald-500/80",
    },
    red: {
      border: "border-rose-500/35",
      glow: "shadow-[0_0_48px_rgba(255,45,85,0.16)]",
      value: "text-rose-400",
      kicker: "text-rose-400/80",
    },
    amber: {
      border: "border-amber-400/30",
      glow: "shadow-[0_0_40px_rgba(245,185,66,0.12)]",
      value: "text-amber-300",
      kicker: "text-amber-400/80",
    },
  }[tone];

  return (
    <Frame
      tone={tone}
      className={`h-full border ${palette.border} ${palette.glow} bg-[#070d14]/85 p-5 backdrop-blur-md ${
        pulse ? "animate-kill-pulse" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={`font-mono text-[10px] tracking-[0.35em] ${palette.kicker}`}>
          {kicker} // SENSOR
        </p>
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      </div>
      <h2 className="mt-3 font-sans text-sm font-semibold tracking-[0.18em] text-slate-200 uppercase">
        {title}
      </h2>
      <p className={`mt-4 font-sans text-3xl font-bold tracking-wide sm:text-4xl ${palette.value}`}>
        {value}
      </p>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-slate-500">{hint}</p>
      <div className="mt-5">{children}</div>
      <p className="mt-4 border-t border-white/6 pt-3 font-mono text-[10px] leading-relaxed tracking-wide text-slate-500">
        {footer}
      </p>
    </Frame>
  );
}

function CapBar({ empty }: { empty: boolean }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
      <div
        className={`h-full ${empty ? "w-0 bg-rose-500" : "w-[72%] bg-emerald-400 shadow-[0_0_12px_#00ff9c]"}`}
      />
    </div>
  );
}

function ThreatMeter({ value, max }: { value: number; max: number }) {
  const ticks = Math.max(max, 1);
  return (
    <div className="flex gap-1">
      {Array.from({ length: ticks }).map((_, i) => {
        const filled = i < value;
        const critical = i >= ticks - 2;
        return (
          <span
            key={i}
            className={`h-2 flex-1 rounded-[1px] ${
              filled
                ? critical
                  ? "bg-rose-500 shadow-[0_0_8px_#ff2d55]"
                  : "bg-amber-400 shadow-[0_0_8px_#f5b942]"
                : "bg-white/8"
            }`}
          />
        );
      })}
    </div>
  );
}

function SwitchGlyph({ active }: { active: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div
        className={`relative h-7 w-14 rounded-full border ${
          active
            ? "border-rose-400/60 bg-rose-500/20"
            : "border-emerald-400/50 bg-emerald-400/15"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5.5 w-5.5 rounded-full transition-all ${
            active
              ? "right-0.5 bg-rose-400 shadow-[0_0_10px_#ff2d55]"
              : "left-0.5 bg-emerald-300 shadow-[0_0_10px_#00ff9c]"
          }`}
          style={{ height: 22, width: 22, top: 2 }}
        />
      </div>
      <span
        className={`font-mono text-[10px] tracking-[0.28em] ${
          active ? "text-rose-300" : "text-emerald-300"
        }`}
      >
        {active ? "KILLSWITCH ARMED" : "AGENT LIVE"}
      </span>
    </div>
  );
}
