import { useEffect, useState } from "react";
import { PanelLeft, Smartphone } from "lucide-react";
import { isTauriRuntime, subscribeMockStudioNavigate } from "./lib/ipc-client";
import { PopoverView } from "./views/PopoverView";
import { StudioView } from "./views/StudioView";

type ViewMode = "popover" | "studio";

function resolveInitialView(): ViewMode {
  if (typeof window === "undefined") return "popover";
  const params = new URLSearchParams(window.location.search);
  return params.get("view") === "studio" ? "studio" : "popover";
}

function resolveInitialQueryParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

export function App() {
  const inTauri = isTauriRuntime();
  const [view, setView] = useState<ViewMode>(resolveInitialView);
  const [studioProjectId, setStudioProjectId] = useState<string | null>(() =>
    resolveInitialQueryParam("projectId"),
  );
  const [studioPresetId, setStudioPresetId] = useState<string | null>(() =>
    resolveInitialQueryParam("presetId"),
  );

  // In standalone browser preview, allow `open_studio_window` from Popover to switch cleanly to Studio
  useEffect(() => {
    if (inTauri) return;
    return subscribeMockStudioNavigate((payload) => {
      setStudioProjectId(payload.projectId ?? null);
      setStudioPresetId(payload.presetId ?? null);
      setView("studio");
    });
  }, [inTauri]);

  useEffect(() => {
    document.title =
      view === "studio"
        ? "Oh My T3Code — Preset Studio"
        : "Oh My T3Code";
  }, [view]);

  if (inTauri) {
    return view === "studio" ? (
      <StudioView
        initialProjectId={studioProjectId}
        initialPresetId={studioPresetId}
      />
    ) : (
      <PopoverView />
    );
  }

  // In browser/dev preview outside Tauri runtime, offer a discrete dev switcher bar
  const hasExplicitViewParam =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("view");

  if (hasExplicitViewParam) {
    return view === "studio" ? (
      <StudioView
        initialProjectId={studioProjectId}
        initialPresetId={studioPresetId}
      />
    ) : (
      <PopoverView />
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-zinc-900/90 px-4 py-1.5 text-[11px] text-zinc-300">
        <span className="font-mono text-zinc-400">
          Browser Preview (Mock IPC ativo)
        </span>
        <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-zinc-950 p-0.5">
          <button
            type="button"
            onClick={() => setView("popover")}
            aria-pressed={view === "popover"}
            className={[
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
              view === "popover"
                ? "bg-indigo-500 text-white"
                : "text-zinc-300 hover:text-zinc-100",
            ].join(" ")}
          >
            <Smartphone className="size-3" aria-hidden="true" />
            Popover (380×500)
          </button>
          <button
            type="button"
            onClick={() => setView("studio")}
            aria-pressed={view === "studio"}
            className={[
              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
              view === "studio"
                ? "bg-indigo-500 text-white"
                : "text-zinc-300 hover:text-zinc-100",
            ].join(" ")}
          >
            <PanelLeft className="size-3" aria-hidden="true" />
            Preset Studio (1120×760)
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 flex items-center justify-center overflow-hidden p-0">
        {view === "studio" ? (
          <StudioView
            initialProjectId={studioProjectId}
            initialPresetId={studioPresetId}
          />
        ) : (
          <div className="h-[500px] w-[380px] overflow-hidden rounded-2xl border border-white/15 shadow-2xl shadow-black/70">
            <PopoverView />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
