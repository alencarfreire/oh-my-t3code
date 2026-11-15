import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "emerald" | "indigo" | "amber" | "sky" | "rose";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-zinc-800/85 text-zinc-300 border-white/10",
  emerald: "bg-emerald-500/14 text-emerald-300 border-emerald-500/25",
  indigo: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  amber: "bg-amber-500/14 text-amber-300 border-amber-500/28",
  sky: "bg-sky-500/14 text-sky-300 border-sky-500/28",
  rose: "bg-rose-500/14 text-rose-300 border-rose-500/28",
};

const DOT_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-zinc-400",
  emerald: "bg-emerald-400",
  indigo: "bg-indigo-400",
  amber: "bg-amber-400",
  sky: "bg-sky-400",
  rose: "bg-rose-400",
};

export interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

export function Badge({
  tone = "neutral",
  dot = false,
  children,
  className = "",
}: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      ].join(" ")}
    >
      {dot ? (
        <span
          className={`size-1.5 shrink-0 rounded-full ${DOT_CLASSES[tone]}`}
          aria-hidden="true"
        />
      ) : null}
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
