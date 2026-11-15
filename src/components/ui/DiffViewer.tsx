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
      <div className="surface-card rounded-xl px-4 py-8 text-center text-xs text-zinc-400">
        {emptyMessage}
      </div>
    );
  }

  const lines = diffText.replace(/\n$/, "").split("\n");

  return (
    <div
      className="max-h-[480px] overflow-auto overscroll-contain rounded-xl border border-white/10 bg-[#0b0b0e] font-mono text-[12px] leading-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
      role="region"
      aria-label="Unified Diff"
      tabIndex={0}
    >
      <div className="min-w-max py-1.5">
        {lines.map((line, idx) => {
          const isFileHeader = line.startsWith("+++") || line.startsWith("---");
          const isHunkHeader = line.startsWith("@@");
          const isAdd = !isFileHeader && line.startsWith("+");
          const isDel = !isFileHeader && line.startsWith("-");

          let rowClass = "text-zinc-300";
          let gutterClass = "text-zinc-600 border-white/[0.06]";
          let marker = " ";
          let content = line;

          if (isFileHeader) {
            rowClass = "bg-zinc-900/95 text-zinc-300 font-semibold border-y border-white/[0.06]";
            gutterClass = "text-zinc-500 border-white/[0.06]";
          } else if (isHunkHeader) {
            rowClass = "bg-indigo-500/12 text-indigo-300";
            gutterClass = "text-indigo-400/70 border-indigo-500/20";
          } else if (isAdd) {
            rowClass = "bg-emerald-500/[0.11] text-emerald-200";
            gutterClass = "bg-emerald-500/[0.08] text-emerald-400/80 border-emerald-500/20";
            marker = "+";
            content = line.slice(1);
          } else if (isDel) {
            rowClass = "bg-rose-500/[0.11] text-rose-200";
            gutterClass = "bg-rose-500/[0.08] text-rose-400/80 border-rose-500/20";
            marker = "-";
            content = line.slice(1);
          } else if (line.startsWith(" ")) {
            content = line.slice(1);
          }

          return (
            <div key={idx} className={`flex items-stretch px-0 ${rowClass}`}>
              <span
                className={`w-10 shrink-0 select-none border-e px-2 py-0.5 text-right text-[11px] tabular-nums ${gutterClass}`}
                aria-hidden="true"
              >
                {idx + 1}
              </span>
              {!isFileHeader && !isHunkHeader ? (
                <span
                  className="w-5 shrink-0 select-none py-0.5 text-center font-semibold opacity-80"
                  aria-hidden="true"
                >
                  {marker}
                </span>
              ) : (
                <span className="w-2 shrink-0" aria-hidden="true" />
              )}
              <span className="py-0.5 pe-4 whitespace-pre">
                {isFileHeader || isHunkHeader ? line : content || " "}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
