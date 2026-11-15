import { useId, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "./Button";

interface StringListEditorProps {
  label: string;
  items: string[];
  placeholder?: string;
  helperText?: string;
  monospace?: boolean;
  displayMode?: "list" | "chips" | "terminal";
  chipTone?: "neutral" | "emerald" | "rose";
  onChange: (next: string[]) => void;
}

export function StringListEditor({
  label,
  items,
  placeholder = "Adicionar item...",
  helperText,
  monospace = false,
  displayMode = "list",
  chipTone = "neutral",
  onChange,
}: StringListEditorProps) {
  const [draft, setDraft] = useState("");
  const inputId = useId();

  const handleAdd = () => {
    const val = draft.trim();
    if (!val) return;
    if (!items.includes(val)) {
      onChange([...items, val]);
    }
    setDraft("");
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, idx) => idx !== index));
  };

  const chipToneClasses =
    chipTone === "emerald"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
      : chipTone === "rose"
        ? "border-rose-500/25 bg-rose-500/10 text-rose-200"
        : "border-white/12 bg-zinc-900/90 text-zinc-200";

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="text-xs font-medium text-zinc-200">
          {label}
        </label>
        {helperText ? (
          <span className="text-[11px] text-zinc-400">{helperText}</span>
        ) : null}
      </div>

      <div className="flex gap-2">
        <input
          id={inputId}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={placeholder}
          className={[
            "h-8 flex-1 rounded-lg border border-white/12 bg-zinc-950/90 px-3 text-xs text-zinc-100 placeholder:text-zinc-500",
            "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
            monospace ? "font-mono" : "",
          ].join(" ")}
        />
        <Button variant="secondary" size="sm" onClick={handleAdd}>
          <Plus className="size-3.5" aria-hidden="true" />
          Adicionar
        </Button>
      </div>

      {items.length > 0 ? (
        displayMode === "chips" ? (
          <ul className="flex flex-wrap gap-1.5 pt-0.5">
            {items.map((item, idx) => (
              <li key={`${item}-${idx}`}>
                <span
                  className={[
                    "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]",
                    monospace ? "font-mono" : "",
                    chipToneClasses,
                  ].join(" ")}
                >
                  <span className="break-all">{item}</span>
                  <button
                    type="button"
                    onClick={() => handleRemove(idx)}
                    aria-label={`Remover ${item}`}
                    className="rounded p-0.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : displayMode === "terminal" ? (
          <ul className="space-y-1.5">
            {items.map((item, idx) => (
              <li
                key={`${item}-${idx}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-zinc-950/95 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200"
              >
                <span className="flex min-w-0 items-center gap-2 break-all">
                  <span className="select-none font-semibold text-emerald-400" aria-hidden="true">
                    $
                  </span>
                  <span>{item}</span>
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(idx)}
                  aria-label={`Remover ${item}`}
                  className="shrink-0 rounded p-1 text-zinc-400 transition-colors duration-150 hover:bg-rose-500/15 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item, idx) => (
              <li
                key={`${item}-${idx}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-zinc-950/70 px-2.5 py-1.5 text-xs text-zinc-200"
              >
                <span className={`min-w-0 break-all ${monospace ? "font-mono text-[11px]" : ""}`}>
                  {item}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(idx)}
                  aria-label={`Remover ${item}`}
                  className="shrink-0 rounded p-1 text-zinc-400 transition-colors duration-150 hover:bg-rose-500/15 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="text-[11px] text-zinc-500">Nenhum item configurado.</p>
      )}
    </div>
  );
}
