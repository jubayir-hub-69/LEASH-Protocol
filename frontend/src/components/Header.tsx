import { Frame } from "./Frame";
import type { AgentResponse } from "@/lib/types";
import { shortenAddress } from "@/lib/format";

function LeashMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-11 w-11 drop-shadow-[0_0_10px_rgba(0,255,156,0.55)]" aria-hidden>
      <polygon
        points="24,2 44,13 44,35 24,46 4,35 4,13"
        fill="none"
        stroke="#00ff9c"
        strokeWidth="1.6"
      />
      <polygon
        points="24,10 36,17 36,31 24,38 12,31 12,17"
        fill="rgba(0,255,156,0.08)"
        stroke="#00ff9c"
        strokeWidth="1"
      />
      <path
        d="M18 24c0-3.3 2.7-6 6-6s6 2.7 6 6-2.7 6-6 6"
        fill="none"
        stroke="#00ff9c"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M30 24h7" stroke="#00ff9c" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="38.5" cy="24" r="1.6" fill="#00ff9c" />
    </svg>
  );
}

export function Header({
  data,
  clock,
}: {
  data: AgentResponse | null;
  clock: string;
}) {
  const live = Boolean(data?.ok);
  const address = data && "contractAddress" in data ? data.contractAddress : undefined;
  const chainId = data && data.ok ? data.chainId : 61997;
  const block = data && data.ok ? data.blockNumber : null;

  return (
    <header className="relative">
      <div className="pointer-events-none absolute inset-x-0 -top-8 h-24 bg-[radial-gradient(ellipse_at_top,rgba(0,255,156,0.16),transparent_70%)]" />
      <Frame className="overflow-hidden border border-emerald-400/20 bg-[#070d14]/80 px-5 py-4 backdrop-blur-md md:px-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <LeashMark />
            <div>
              <p className="font-mono text-[10px] tracking-[0.38em] text-emerald-400/80">
                PROTOCOL v0.1 · ERC-7710 GATE
              </p>
              <h1 className="mt-1 font-sans text-lg font-semibold tracking-[0.12em] text-emerald-50 sm:text-2xl md:text-[1.65rem]">
                LEASH - AI Agent Security Command Center
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tracking-widest text-slate-400">
            <StatusChip
              label={live ? "UPLINK LIVE" : "UPLINK SEEKING"}
              on={live}
            />
            <Meta label="NET" value={`STUDIO NEXT ${chainId}`} />
            <Meta
              label="LEASH"
              value={address ? shortenAddress(address, 4) : "—"}
            />
            {block != null ? <Meta label="BLK" value={String(block)} /> : null}
            <Meta label="UTC" value={clock} />
          </div>
        </div>
      </Frame>
    </header>
  );
}

function StatusChip({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 ${
        on
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300 shadow-[0_0_18px_rgba(0,255,156,0.18)]"
          : "border-rose-500/40 bg-rose-500/10 text-rose-300"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "animate-pulse bg-emerald-400" : "bg-rose-400"}`} />
      {label}
    </span>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-sm border border-white/8 bg-white/3 px-3 py-1.5">
      <span className="mr-2 text-emerald-500/70">{label}</span>
      <span className="text-slate-200">{value}</span>
    </span>
  );
}
