import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "xs" | "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-indigo-500 text-white border border-indigo-400/30 hover:bg-indigo-400 shadow-sm shadow-indigo-950/40",
  secondary:
    "bg-zinc-800/90 text-zinc-100 border border-white/10 hover:bg-zinc-700/90 hover:border-white/20",
  ghost:
    "bg-transparent text-zinc-300 border border-transparent hover:bg-white/8 hover:text-zinc-100",
  danger:
    "bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "h-7 px-2 text-xs gap-1 rounded-md",
  sm: "h-8 px-2.5 text-xs gap-1.5 rounded-lg",
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
        "transition-[background-color,border-color,color,transform,opacity] duration-150 ease-out",
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
