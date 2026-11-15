interface DiffViewerProps {
  diffText: string;
  emptyMessage?: string;
}

export function DiffViewer({
  diffText,
  emptyMessage = "Sem alterações em relação ao arquivo atual em disco.",
}: DiffViewerProps) {
  const trimmed = diffText.trim();
  if (!trimmed) {
    return (
      <div className="rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-6 text-center text-xs text-zinc-400">
        {emptyMessage}
      </div>
    );
  }

  const lines = diffText.replace(/\n$/, "").split("\n");

  return (
    <div
      className="overflow-auto overscroll-contain rounded-xl border border-white/10 bg-zinc-950 font-mono text-[12px] leading-5"
      role="region"
      aria-label="Unified Diff"
      tabIndex={0}
    >
      <div className="min-w-max py-2">
        {lines.map((line, idx) => {
          let rowClass = "text-zinc-300";
          if (line.startsWith("+++") || line.startsWith("---")) {
            rowClass = "bg-zinc-900/90 text-zinc-400 font-semibold";
          } else if (line.startsWith("@@")) {
            rowClass = "bg-indigo-500/10 text-indigo-300";
          } else if (line.startsWith("+")) {
            rowClass = "bg-emerald-500/12 text-emerald-300";
          } else if (line.startsWith("-")) {
            rowClass = "bg-rose-500/12 text-rose-300";
          }

          return (
            <div key={idx} className={`flex px-3 py-0.5 ${rowClass}`}>
              <span
                className="mr-3 w-8 shrink-0 select-none text-right text-[11px] text-zinc-500 tabular-nums"
                aria-hidden="true"
              >
                {idx + 1}
              </span>
              <span className="whitespace-pre">{line || " "}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
