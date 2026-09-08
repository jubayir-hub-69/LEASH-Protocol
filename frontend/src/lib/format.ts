import { formatEther } from "ethers";
import { VERDICT_NAMES, type VerdictName } from "./types";

export function formatUsdFromWei(wei: bigint | string): string {
  const value = typeof wei === "string" ? BigInt(wei) : wei;
  const eth = formatEther(value);
  const numeric = Number(eth);
  if (!Number.isFinite(numeric)) return `$${eth}`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function shortenAddress(address: string, size = 4): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 2 + size)}…${address.slice(-size)}`;
}

export function shortenHash(hash: string, size = 6): string {
  if (!hash || hash.length < 12) return hash;
  return `${hash.slice(0, 2 + size)}…${hash.slice(-size)}`;
}

export function verdictName(value: number | bigint): VerdictName {
  const index = Number(value);
  return VERDICT_NAMES[index] ?? "Continue";
}

export function formatUnix(seconds: number): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatCountdown(seconds: number, now = Date.now()): string {
  const remaining = seconds * 1000 - now;
  if (remaining <= 0) return "EXPIRED";
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
