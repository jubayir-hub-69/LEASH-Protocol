type Tone = "green" | "red" | "amber" | "cyan";

const TONE: Record<Tone, string> = {
  green: "border-emerald-400/70",
  red: "border-rose-500/80",
  amber: "border-amber-400/80",
  cyan: "border-cyan-400/70",
};

export function Frame({
  children,
  className = "",
  tone = "green",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: Tone;
}) {
  const edge = TONE[tone];
  return (
    <div className={`relative ${className}`}>
      <span className={`pointer-events-none absolute -top-px -left-px h-3 w-3 border-t-2 border-l-2 ${edge}`} />
      <span className={`pointer-events-none absolute -top-px -right-px h-3 w-3 border-t-2 border-r-2 ${edge}`} />
      <span className={`pointer-events-none absolute -bottom-px -left-px h-3 w-3 border-b-2 border-l-2 ${edge}`} />
      <span className={`pointer-events-none absolute -bottom-px -right-px h-3 w-3 border-b-2 border-r-2 ${edge}`} />
      {children}
    </div>
  );
}
