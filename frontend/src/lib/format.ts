export function formatUsd(amount: number | bigint | string): string {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return `$${amount}`;
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

export function formatUnix(seconds: number): string {
  if (!seconds) return "NONE";
  return new Date(seconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatCountdown(seconds: number, now = Date.now()): string {
  if (!seconds) return "OPEN";
  const remaining = seconds * 1000 - now;
  if (remaining <= 0) return "EXPIRED";
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
