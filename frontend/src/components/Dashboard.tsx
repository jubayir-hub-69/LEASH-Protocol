"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ControlPanel } from "./ControlPanel";
import { Header } from "./Header";
import { JuryPanel } from "./JuryPanel";
import { MandatePanel } from "./MandatePanel";
import { StatusCards } from "./StatusCards";
import { POLL_INTERVAL_MS } from "@/lib/config";
import type { AgentResponse, AgentSnapshot } from "@/lib/types";

export function Dashboard() {
  const [data, setData] = useState<AgentResponse | null>(null);
  const [clock, setClock] = useState("--:--:--");
  const loadSeq = useRef(0);
  const inflight = useRef(false);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    const seq = ++loadSeq.current;
    try {
      const response = await fetch("/api/agent", { cache: "no-store" });
      const payload = (await response.json()) as AgentResponse;
      if (seq !== loadSeq.current) return;
      setData((prev) => (payload.ok || !prev?.ok ? payload : prev));
    } catch (error) {
      if (seq === loadSeq.current) {
        setData({
          ok: false,
          connected: false,
          rpc: "https://studio-next.genlayer.com/api",
          error: "Dashboard could not reach the local API",
          detail: error instanceof Error ? error.message : String(error),
          fetchedAt: new Date().toISOString(),
        });
      }
    } finally {
      inflight.current = false;
    }
  }, []);

  const applyState = useCallback((state: AgentSnapshot) => {
    ++loadSeq.current;
    setData(state);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loop = async () => {
      await load();
      if (cancelled) return;
      timer = setTimeout(() => {
        void loop();
      }, POLL_INTERVAL_MS);
    };

    void loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-GB", {
          hour12: false,
          timeZone: "UTC",
        })
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const agent = data?.ok ? data : null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#03050a] text-slate-100">
      <div className="cyber-grid" />
      <div className="vignette" />
      <div className="scanlines" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Header data={data} clock={clock} />

        {!data ? (
          <p className="font-mono text-[11px] tracking-[0.3em] text-emerald-500/80">
            ESTABLISHING UPLINK TO STUDIO NEXT…
          </p>
        ) : null}

        {data && !data.ok ? <ErrorBanner data={data} /> : null}

        <StatusCards agent={agent} />
        <MandatePanel agent={agent} />
        <JuryPanel agent={agent} onApplied={applyState} />
        <ControlPanel agent={agent} onRefresh={load} onApplied={applyState} />

        <footer className="mt-auto flex flex-col gap-2 border-t border-white/8 py-4 font-mono text-[10px] tracking-widest text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            RPC {agent?.rpc ?? "https://studio-next.genlayer.com/api"} · CHAIN 61997 · GENLAYER-JS · get_state / adjudicate
          </span>
          <span>
            LAST SYNC {agent?.fetchedAt ?? data?.fetchedAt ?? "—"} · POLL {POLL_INTERVAL_MS / 1000}s
          </span>
        </footer>
      </div>
    </div>
  );
}

function ErrorBanner({ data }: { data: Extract<AgentResponse, { ok: false }> }) {
  return (
    <div className="border border-rose-500/40 bg-rose-500/10 px-4 py-3 font-mono text-xs text-rose-200 shadow-[0_0_24px_rgba(255,45,85,0.12)]">
      <p className="tracking-[0.28em] text-rose-400">SIGNAL FAULT</p>
      <p className="mt-1 text-rose-100">{data.error}</p>
      {data.detail ? (
        <p className="mt-1 truncate text-[11px] text-rose-300/80">{data.detail}</p>
      ) : null}
    </div>
  );
}
