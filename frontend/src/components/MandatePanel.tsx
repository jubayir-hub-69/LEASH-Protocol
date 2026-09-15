import { Frame } from "./Frame";
import { formatCountdown, formatUnix, shortenAddress } from "@/lib/format";
import type { AgentSnapshot } from "@/lib/types";

export function MandatePanel({ agent }: { agent: AgentSnapshot | null }) {
  return (
    <Frame className="border border-cyan-400/20 bg-[#070d14]/85 p-6 shadow-[0_0_40px_rgba(77,228,255,0.06)] backdrop-blur-md" tone="cyan">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] tracking-[0.38em] text-cyan-400/80">
            04 // POLICY
          </p>
          <h2 className="mt-2 font-sans text-sm font-semibold tracking-[0.22em] text-slate-100 uppercase">
            Current Mandate
          </h2>
          <p className="mt-1 font-mono text-[11px] text-slate-500">
            Live `mandate` string stored on the Studio Next Intelligent Contract
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
          label="Constructor"
          value={
            agent?.constructorParams.length
              ? agent.constructorParams.join(" · ")
              : "—"
          }
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
