import { Frame } from "./Frame";
import { formatCountdown, formatUnix } from "@/lib/format";
import type { AgentSnapshot } from "@/lib/types";

export function StatusCards({ agent }: { agent: AgentSnapshot | null }) {
  const spend = agent?.spendCapUsd ?? "—";
  const killActive = agent?.killSwitchStatus === "ACTIVE";
  const expired = Boolean(agent?.expired);
  const deadlineOpen = Boolean(agent?.deadlineOpen);
  const deadlineValue = agent
    ? deadlineOpen
      ? "OPEN"
      : formatCountdown(agent.deadline)
    : "—";

  return (
    <section className="grid gap-4 md:grid-cols-3">
      <StatusCard
        tone={killActive || spend === "$0.00" ? "red" : "green"}
        kicker="01"
        title="Current Spend Cap"
        value={spend}
        hint="On-chain spend_cap from the live leash.py contract"
        footer={
          agent
            ? `Raw spend_cap ${agent.spendCap} · ${agent.canProceed ? "gate open" : agent.canProceedReason}`
            : "Awaiting chain state"
        }
      >
        <CapBar empty={spend === "$0.00" || killActive} />
      </StatusCard>

      <StatusCard
        tone={expired ? "red" : deadlineOpen ? "green" : "amber"}
        kicker="02"
        title="Mandate Deadline"
        value={deadlineValue}
        hint="On-chain deadline. Zero means the mandate window is open-ended."
        footer={
          agent
            ? deadlineOpen
              ? "deadline = 0 · no expiry encoded on chain"
              : `${formatUnix(agent.deadline)} UTC`
            : "Awaiting chain state"
        }
      >
        <DeadlineBar open={deadlineOpen} expired={expired} />
      </StatusCard>

      <StatusCard
        tone={killActive ? "red" : "green"}
        kicker="03"
        title="Kill Switch Status"
        value={agent ? agent.killSwitchStatus : "—"}
        hint={
          killActive
            ? "Derived from spend_cap = 0 or a passed deadline"
            : "Derived from live spend_cap and deadline"
        }
        footer={
          agent
            ? killActive
              ? agent.canProceedReason
              : "Agent operational · spend_cap is live"
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

function DeadlineBar({ open, expired }: { open: boolean; expired: boolean }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
      <div
        className={`h-full ${
          expired
            ? "w-full bg-rose-500 shadow-[0_0_12px_#ff2d55]"
            : open
              ? "w-full bg-emerald-400 shadow-[0_0_12px_#00ff9c]"
              : "w-[45%] bg-amber-400 shadow-[0_0_12px_#f5b942]"
        }`}
      />
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
