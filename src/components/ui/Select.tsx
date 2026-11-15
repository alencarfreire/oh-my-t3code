import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  sizeVariant?: "xs" | "sm";
  monospace?: boolean;
  wrapperClassName?: string;
}

export function Select({
  sizeVariant = "sm",
  monospace = false,
  wrapperClassName = "",
  className = "",
  children,
  ...rest
}: SelectProps) {
  const heightPadding =
    sizeVariant === "xs"
      ? "h-7 ps-2.5 pe-7 text-xs rounded-lg"
      : "h-8.5 ps-3 pe-8 text-xs rounded-lg";

  return (
    <div className={`relative ${wrapperClassName}`}>
      <select
        className={[
          "w-full appearance-none truncate border border-white/12 bg-zinc-950/90 text-zinc-100",
          "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
          "transition-[border-color,background-color,box-shadow] duration-150 ease-out",
          "hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
          "disabled:opacity-50",
          heightPadding,
          monospace ? "font-mono" : "",
          className,
        ].join(" ")}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        className={[
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-zinc-400",
          sizeVariant === "xs" ? "end-2 size-3.5" : "end-2.5 size-3.5",
        ].join(" ")}
        aria-hidden="true"
      />
    </div>
  );
}
