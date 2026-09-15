"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ControlPanel } from "./ControlPanel";
import { Header } from "./Header";
import { MandatePanel } from "./MandatePanel";
import { StatusCards } from "./StatusCards";
import { POLL_INTERVAL_MS } from "@/lib/config";
import type { AgentResponse } from "@/lib/types";

const BYTECODE_FAULT =
  "No contract bytecode at the deployed LEASH address.";

export function Dashboard() {
  const [data, setData] = useState<AgentResponse | null>(null);
  const [clock, setClock] = useState("--:--:--");
  const loadSeq = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const response = await fetch("/api/agent", { cache: "no-store" });
      const payload = (await response.json()) as AgentResponse;
      if (seq !== loadSeq.current) return;
      setData(payload);
      // /api/agent returns 404 when the snapshot is connected but not ok
      // (historically the EVM bytecode check). Keep polling on 200; stop
      // on 404 so the Next.js terminal is not spammed.
      if (response.status === 404) stopPolling();
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
    }
  }, [stopPolling]);

  useEffect(() => {
    void load();
    pollRef.current = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => stopPolling();
  }, [load, stopPolling]);

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

        {data && !data.ok && data.error !== BYTECODE_FAULT ? (
          <ErrorBanner data={data} />
        ) : null}

        <StatusCards agent={agent} />
        <MandatePanel agent={agent} />
        <ControlPanel agent={agent} onRefresh={load} />

        <footer className="mt-auto flex flex-col gap-2 border-t border-white/8 py-4 font-mono text-[10px] tracking-widest text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            RPC {agent?.rpc ?? "https://studio-next.genlayer.com/api"} · CHAIN 61997 · AGENT ID 1 · OWNER OVERRIDE ENABLED
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
