import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "./Button";

interface KeyValueEditorProps {
  label: string;
  entries: Record<string, string>;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  onChange: (next: Record<string, string>) => void;
}

export function KeyValueEditor({
  label,
  entries,
  keyPlaceholder = "Chave (ex: thinking_level)",
  valuePlaceholder = "Valor (ex: high)",
  onChange,
}: KeyValueEditorProps) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const keyInputId = useId();
  const valInputId = useId();

  const sortedEntries = Object.entries(entries).sort(([a], [b]) => a.localeCompare(b));

  const handleAdd = () => {
    const k = newKey.trim();
    const v = newValue.trim();
    if (!k) return;
    onChange({ ...entries, [k]: v });
    setNewKey("");
    setNewValue("");
  };

  const handleUpdateValue = (key: string, value: string) => {
    onChange({ ...entries, [key]: value });
  };

  const handleDelete = (key: string) => {
    const copy = { ...entries };
    delete copy[key];
    onChange(copy);
  };

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-zinc-200">{label}</div>

      {sortedEntries.length > 0 ? (
        <div className="space-y-1.5">
          {sortedEntries.map(([k, v]) => (
            <div
              key={k}
              className="flex items-center gap-2 rounded-lg border border-white/8 bg-zinc-900/75 px-2.5 py-1.5"
            >
              <span className="w-36 shrink-0 truncate font-mono text-[11px] text-indigo-300">
                {k}
              </span>
              <input
                type="text"
                value={v}
                aria-label={`Valor de ${k}`}
                onChange={(e) => handleUpdateValue(k, e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              />
              <button
                type="button"
                onClick={() => handleDelete(k)}
                aria-label={`Remover ${k}`}
                className="shrink-0 rounded p-1 text-zinc-400 transition-colors duration-150 hover:bg-rose-500/15 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <div className="min-w-[130px] flex-1">
          <label htmlFor={keyInputId} className="sr-only">
            {keyPlaceholder}
          </label>
          <input
            id={keyInputId}
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder={keyPlaceholder}
            className="h-8 w-full rounded-lg border border-white/12 bg-zinc-950/90 px-2.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          />
        </div>
        <div className="min-w-[130px] flex-1">
          <label htmlFor={valInputId} className="sr-only">
            {valuePlaceholder}
          </label>
          <input
            id={valInputId}
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder={valuePlaceholder}
            className="h-8 w-full rounded-lg border border-white/12 bg-zinc-950/90 px-2.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          />
        </div>
        <Button variant="secondary" size="sm" onClick={handleAdd}>
          <Plus className="size-3.5" aria-hidden="true" />
          Adicionar
        </Button>
      </div>
    </div>
  );
}
