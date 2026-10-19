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

  const risk = agent ? agent.lastRiskScore : null;
  const category = agent?.lastThreatCategory || "NONE";
  const riskTone = riskToneFor(risk);
  const categoryTone = categoryToneFor(category);

  return (
    <div className="flex flex-col gap-4">
    <section className="grid min-w-0 gap-4 md:grid-cols-3">
      <StatusCard
        tone={killActive || spend === "$0.00" ? "red" : "green"}
        kicker="01"
        title="Current Spend Cap"
        value={spend}
        hint="On-chain spend_cap after the last validator verdict"
        footer={
          agent
            ? `Raw spend_cap ${agent.spendCap} · verdict ${agent.lastVerdict} · ${agent.canProceed ? "gate open" : agent.canProceedReason}`
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
            ? "On-chain kill_switch / frozen / zero spend_cap from get_state"
            : "On-chain kill_switch is false and spend_cap is live"
        }
        footer={
          agent
            ? killActive
              ? agent.canProceedReason
              : `Agent operational · last verdict ${agent.lastVerdict}`
            : "Awaiting chain state"
        }
        pulse={killActive}
      >
        <SwitchGlyph active={killActive} />
      </StatusCard>
    </section>

    <section className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <StatusCard
        tone={riskTone}
        kicker="04"
        title="Risk Score"
        value={risk == null ? "—" : `${risk}`}
        hint="On-chain last_risk_score from the validator jury, 0 to 100"
        footer={
          agent
            ? `Adjudications ${agent.totalAdjudications} · submissions ${agent.submissionCount}`
            : "Awaiting chain state"
        }
      >
        <RiskMeter score={risk ?? 0} empty={risk == null} />
      </StatusCard>

      <StatusCard
        tone={categoryTone}
        kicker="05"
        title="Threat Category"
        value={agent ? category : "—"}
        hint="On-chain last_threat_category written by adjudicate()"
        footer={
          agent
            ? category === "NONE"
              ? "No active threat category on the last decision"
              : `Last verdict ${agent.lastVerdict}`
            : "Awaiting chain state"
        }
      >
        <CategoryBadge category={agent ? category : "NONE"} />
      </StatusCard>

      <StatusCard
        tone={agent && agent.totalBlockedVolume !== "0" ? "amber" : "green"}
        kicker="06"
        title="Total Blocked Volume"
        value={agent?.totalBlockedVolumeUsd ?? "—"}
        hint="On-chain total_blocked_volume denied by THROTTLE and REVOKE"
        footer={
          agent
            ? `Raw total_blocked_volume ${agent.totalBlockedVolume}`
            : "Awaiting chain state"
        }
      >
        <CapBar empty={!agent || agent.totalBlockedVolume === "0"} />
      </StatusCard>

      <StatusCard
        tone={agent && agent.threatsNeutralized !== "0" ? "red" : "green"}
        kicker="07"
        title="Neutralized Threats"
        value={agent?.threatsNeutralized ?? "—"}
        hint="On-chain threats_neutralized across throttle and revoke decisions"
        footer={
          agent
            ? `${agent.promptInjectionsBlocked} prompt injections blocked`
            : "Awaiting chain state"
        }
      >
        <ThreatTicks count={Number(agent?.promptInjectionsBlocked ?? 0)} />
      </StatusCard>
    </section>
    </div>
  );
}

function SensorValue({ value, className }: { value: string; className: string }) {
  const long = value.length > 12 || value.includes("_");
  const size = long
    ? "text-lg leading-tight tracking-tight sm:text-xl xl:text-2xl"
    : "text-3xl tracking-wide sm:text-4xl";
  const parts = value.split("_");
  return (
    <p className={`mt-4 max-w-full font-sans font-bold break-words [overflow-wrap:anywhere] ${size} ${className}`}>
      {parts.map((part, index) => (
        <span key={`${part}-${index}`}>
          {part}
          {index < parts.length - 1 ? (
            <>
              _
              <wbr />
            </>
          ) : null}
        </span>
      ))}
    </p>
  );
}

function riskToneFor(score: number | null): "green" | "red" | "amber" {
  if (score == null) return "green";
  if (score >= 70) return "red";
  if (score >= 35) return "amber";
  return "green";
}

function categoryToneFor(category: string): "green" | "red" | "amber" {
  if (category === "PROMPT_INJECTION" || category === "OVERSPEND") return "red";
  if (category === "POLICY_DRIFT" || category === "DEADLINE_VIOLATION") return "amber";
  return "green";
}

function RiskMeter({ score, empty }: { score: number; empty: boolean }) {
  const clamped = Math.max(0, Math.min(100, score));
  const color =
    clamped >= 70 ? "bg-rose-500 shadow-[0_0_12px_#ff2d55]" : clamped >= 35 ? "bg-amber-400 shadow-[0_0_12px_#f5b942]" : "bg-emerald-400 shadow-[0_0_12px_#00ff9c]";
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
      <div className={`h-full ${empty ? "w-0" : color}`} style={empty ? undefined : { width: `${clamped}%` }} />
    </div>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const tone =
    category === "PROMPT_INJECTION" || category === "OVERSPEND"
      ? "border-rose-400/50 bg-rose-500/10 text-rose-200"
      : category === "POLICY_DRIFT" || category === "DEADLINE_VIOLATION"
        ? "border-amber-400/50 bg-amber-500/10 text-amber-200"
        : "border-emerald-400/40 bg-emerald-400/10 text-emerald-200";
  return (
    <span className={`inline-block max-w-full border px-3 py-1 font-mono text-[10px] tracking-[0.14em] break-all ${tone}`}>
      {category}
    </span>
  );
}

function ThreatTicks({ count }: { count: number }) {
  const filled = Math.max(0, Math.min(8, count));
  return (
    <div className="flex gap-1">
      {Array.from({ length: 8 }).map((_, index) => (
        <span
          key={index}
          className={`h-2 flex-1 ${index < filled ? "bg-rose-400 shadow-[0_0_8px_#ff2d55]" : "bg-white/10"}`}
        />
      ))}
    </div>
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
      className={`h-full min-w-0 border ${palette.border} ${palette.glow} bg-[#070d14]/85 p-5 backdrop-blur-md ${
        pulse ? "animate-kill-pulse" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={`font-mono text-[10px] tracking-[0.35em] ${palette.kicker}`}>
          {`${kicker} // SENSOR`}
        </p>
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      </div>
      <h2 className="mt-3 font-sans text-sm font-semibold tracking-[0.18em] text-slate-200 uppercase">
        {title}
      </h2>
      <SensorValue value={value} className={palette.value} />
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
