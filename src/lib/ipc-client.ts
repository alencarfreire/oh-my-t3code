import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { IpcCommandArgs, IpcCommandName, IpcCommandReturns } from "../types/ipc";
import { MockIpcStore } from "./mock-data";

export interface StudioNavigatePayload {
  projectId?: string | null;
  presetId?: string | null;
}

type NavigateListener = (payload: StudioNavigatePayload) => void;

const mockStore = new MockIpcStore();
const mockNavigateListeners = new Set<NavigateListener>();
const mockPopoverListeners = new Set<() => void>();

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

export function resetMockIpcState(): void {
  mockStore.reset();
}

export function subscribeMockStudioNavigate(listener: NavigateListener): () => void {
  mockNavigateListeners.add(listener);
  return () => {
    mockNavigateListeners.delete(listener);
  };
}

export function subscribeMockPopoverToggle(listener: () => void): () => void {
  mockPopoverListeners.add(listener);
  return () => {
    mockPopoverListeners.delete(listener);
  };
}

export async function listenStudioNavigate(
  handler: NavigateListener,
): Promise<UnlistenFn> {
  if (isTauriRuntime()) {
    return listen<StudioNavigatePayload>("studio://navigate", (event) => {
      handler(event.payload ?? {});
    });
  }
  return subscribeMockStudioNavigate(handler);
}

export async function invokeIpc<K extends IpcCommandName>(
  command: K,
  args?: IpcCommandArgs[K],
): Promise<IpcCommandReturns[K]> {
  if (isTauriRuntime()) {
    return invoke<IpcCommandReturns[K]>(
      command,
      args as Record<string, unknown> | undefined,
    );
  }

  // Fallback mock store when running in standalone browser / Vite preview / Vitest
  switch (command) {
    case "get_dashboard_snapshot":
      return mockStore.getDashboardSnapshot() as IpcCommandReturns[K];
    case "list_global_presets":
      return mockStore.listGlobalPresets() as IpcCommandReturns[K];
    case "get_project_preset": {
      const a = args as IpcCommandArgs["get_project_preset"];
      return mockStore.getProjectPreset(
        a.projectId,
        a.workspaceRoot,
      ) as IpcCommandReturns[K];
    }
    case "save_global_preset": {
      const a = args as IpcCommandArgs["save_global_preset"];
      return mockStore.saveGlobalPreset(a.preset) as IpcCommandReturns[K];
    }
    case "save_project_preset": {
      const a = args as IpcCommandArgs["save_project_preset"];
      return mockStore.saveProjectPreset(
        a.projectId,
        a.workspaceRoot,
        a.preset,
      ) as IpcCommandReturns[K];
    }
    case "preview_preset_sync": {
      const a = args as IpcCommandArgs["preview_preset_sync"];
      return mockStore.previewPresetSync(
        a.projectId,
        a.workspaceRoot,
        a.preset,
      ) as IpcCommandReturns[K];
    }
    case "apply_preset_sync": {
      const a = args as IpcCommandArgs["apply_preset_sync"];
      return mockStore.applyPresetSync(
        a.projectId,
        a.workspaceRoot,
        a.presetIdOrCustom,
        a.customPreset,
      ) as IpcCommandReturns[K];
    }
    case "swap_project_instance": {
      const a = args as IpcCommandArgs["swap_project_instance"];
      return mockStore.swapProjectInstance(
        a.projectId,
        a.workspaceRoot,
      ) as IpcCommandReturns[K];
    }
    case "import_project_squad": {
      const a = args as IpcCommandArgs["import_project_squad"];
      return mockStore.importProjectSquad(
        a.projectId,
        a.workspaceRoot,
      ) as IpcCommandReturns[K];
    }
    case "set_global_preset_config": {
      const a = args as IpcCommandArgs["set_global_preset_config"];
      return mockStore.setGlobalPresetConfig(
        a.activePresetId,
        a.enabled,
      ) as IpcCommandReturns[K];
    }
    case "swap_global_instance":
      return mockStore.swapGlobalInstance() as IpcCommandReturns[K];
    case "set_project_preset_enabled": {
      const a = args as IpcCommandArgs["set_project_preset_enabled"];
      return mockStore.setProjectPresetEnabled(
        a.projectId,
        a.workspaceRoot,
        a.enabled,
      ) as IpcCommandReturns[K];
    }
    case "remove_project_override": {
      const a = args as IpcCommandArgs["remove_project_override"];
      return mockStore.removeProjectOverride(
        a.projectId,
        a.workspaceRoot,
      ) as IpcCommandReturns[K];
    }
    case "open_studio_window": {
      const a = (args ?? {}) as IpcCommandArgs["open_studio_window"];
      mockNavigateListeners.forEach((fn) =>
        fn({ projectId: a.projectId ?? null, presetId: a.presetId ?? null }),
      );
      return undefined as IpcCommandReturns[K];
    }
    case "toggle_popover_window": {
      mockPopoverListeners.forEach((fn) => fn());
      return undefined as IpcCommandReturns[K];
    }
    default: {
      const exhaustive: never = command;
      throw new Error(`Unhandled IPC command: ${String(exhaustive)}`);
    }
  }
}
