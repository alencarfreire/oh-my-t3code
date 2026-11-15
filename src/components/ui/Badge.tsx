import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "emerald" | "indigo" | "amber" | "sky" | "rose";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-zinc-800/80 text-zinc-300 border-white/10",
  emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  indigo: "bg-indigo-500/15 text-indigo-300 border-indigo-500/25",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/25",
  sky: "bg-sky-500/15 text-sky-300 border-sky-500/25",
  rose: "bg-rose-500/15 text-rose-300 border-rose-500/25",
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "neutral", children, className = "" }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4",
        TONE_CLASSES[tone],
        className,
      ].join(" ")}
    >
      {children}
    </span>
  );
}

export function getInstanceBadgeTone(instanceId: string | null | undefined): BadgeTone {
  if (instanceId === "antigravity_2") return "indigo";
  if (instanceId === "antigravity") return "sky";
  if (instanceId === "codex") return "emerald";
  if (instanceId === "claudeAgent") return "amber";
  return "neutral";
}
