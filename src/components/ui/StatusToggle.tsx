import type { ButtonHTMLAttributes } from "react";

export interface StatusToggleProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  enabled: boolean;
  size?: "xs" | "sm";
  activeLabel?: string;
  inactiveLabel?: string;
}

export function StatusToggle({
  enabled,
  size = "xs",
  activeLabel = "Ativo",
  inactiveLabel = "Desativado",
  className = "",
  ...rest
}: StatusToggleProps) {
  const isSm = size === "sm";

  return (
    <button
      type="button"
      aria-pressed={enabled}
      className={[
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium select-none whitespace-nowrap",
        "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out",
        "enabled:active:scale-[0.96] disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950",
        isSm ? "h-7 px-2.5 text-xs" : "h-6 px-2 text-[11px]",
        enabled
          ? "border-emerald-400/45 bg-emerald-500/18 text-emerald-200 shadow-[0_0_12px_-3px_rgba(16,185,129,0.5),inset_0_1px_0_0_rgba(255,255,255,0.12)] hover:bg-emerald-500/25 hover:border-emerald-300/60"
          : "border-white/12 bg-zinc-800/85 text-zinc-400 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] hover:bg-zinc-700/80 hover:text-zinc-200 hover:border-white/20",
        className,
      ].join(" ")}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={[
          "relative inline-flex shrink-0 items-center rounded-full transition-colors duration-150",
          isSm ? "h-3.5 w-6" : "h-3 w-5",
          enabled ? "bg-emerald-400/85" : "bg-zinc-600/90",
        ].join(" ")}
      >
        <span
          className={[
            "inline-block rounded-full bg-white shadow-sm transition-transform duration-150",
            isSm ? "size-2.5" : "size-2",
            enabled
              ? isSm
                ? "translate-x-3"
                : "translate-x-2.5"
              : "translate-x-0.5",
          ].join(" ")}
        />
      </span>
      <span>{enabled ? activeLabel : inactiveLabel}</span>
    </button>
  );
}
