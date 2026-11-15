import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "caramel";
type ButtonSize = "xs" | "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-indigo-500 text-white border border-indigo-400/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),0_1px_3px_0_rgba(0,0,0,0.45)] hover:bg-indigo-400 hover:border-indigo-300/50",
  caramel:
    "bg-amber-500 text-zinc-950 border border-amber-300/50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35),0_1px_3px_0_rgba(0,0,0,0.4)] hover:bg-amber-400 font-semibold",
  secondary:
    "bg-zinc-800/95 text-zinc-100 border border-white/12 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] hover:bg-zinc-700/95 hover:border-white/20",
  ghost:
    "bg-transparent text-zinc-300 border border-transparent hover:bg-white/[0.08] hover:text-zinc-100",
  danger:
    "bg-rose-500/12 text-rose-300 border border-rose-500/25 hover:bg-rose-500/22 hover:border-rose-400/40",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "h-7 px-2 text-xs gap-1.5 rounded-lg",
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-9 px-3.5 text-sm gap-2 rounded-lg",
};

export function Button({
  variant = "secondary",
  size = "sm",
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        "inline-flex items-center justify-center font-medium select-none whitespace-nowrap",
        "transition-[background-color,border-color,color,transform,opacity,box-shadow] duration-150 ease-out",
        "enabled:active:scale-[0.96] disabled:opacity-45",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
