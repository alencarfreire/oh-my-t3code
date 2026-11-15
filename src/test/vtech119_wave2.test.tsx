import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import * as ipcClient from "../lib/ipc-client";
import { MockIpcStore } from "../lib/mock-data";
import {
  IPC_COMMANDS,
  type IpcCommandArgs,
  type IpcCommandName,
  type IpcCommandReturns,
} from "../types/ipc";

function setLocationSearch(search: string) {
  window.history.replaceState({}, "", search ? `/${search}` : "/");
}

function dispatchMockCommand<K extends IpcCommandName>(
  store: MockIpcStore,
  command: K,
  args?: unknown,
): IpcCommandReturns[K] {
  switch (command) {
    case "get_dashboard_snapshot":
      return store.getDashboardSnapshot() as IpcCommandReturns[K];
    case "list_global_presets":
      return store.listGlobalPresets() as IpcCommandReturns[K];
    case "get_project_preset": {
      const a = args as IpcCommandArgs["get_project_preset"];
      return store.getProjectPreset(
        a.projectId,
        a.workspaceRoot,
      ) as IpcCommandReturns[K];
    }
    case "save_global_preset": {
      const a = args as IpcCommandArgs["save_global_preset"];
      return store.saveGlobalPreset(a.preset) as IpcCommandReturns[K];
    }
    case "save_project_preset": {
      const a = args as IpcCommandArgs["save_project_preset"];
      return store.saveProjectPreset(
        a.projectId,
        a.workspaceRoot,
        a.preset,
      ) as IpcCommandReturns[K];
    }
    case "preview_preset_sync": {
      const a = args as IpcCommandArgs["preview_preset_sync"];
      return store.previewPresetSync(
        a.projectId,
        a.workspaceRoot,
        a.preset,
      ) as IpcCommandReturns[K];
    }
    case "apply_preset_sync": {
      const a = args as IpcCommandArgs["apply_preset_sync"];
      return store.applyPresetSync(
        a.projectId,
        a.workspaceRoot,
        a.presetIdOrCustom,
        a.customPreset,
      ) as IpcCommandReturns[K];
    }
    case "swap_project_instance": {
      const a = args as IpcCommandArgs["swap_project_instance"];
      return store.swapProjectInstance(
        a.projectId,
        a.workspaceRoot,
        a.includeRoles,
      ) as IpcCommandReturns[K];
    }
    case "import_project_squad": {
      const a = args as IpcCommandArgs["import_project_squad"];
      return store.importProjectSquad(
        a.projectId,
        a.workspaceRoot,
      ) as IpcCommandReturns[K];
    }
    case "set_global_preset_config": {
      const a = args as IpcCommandArgs["set_global_preset_config"];
      return store.setGlobalPresetConfig(
        a.activePresetId,
        a.enabled,
      ) as IpcCommandReturns[K];
    }
    case "swap_global_instance": {
      const a = args as IpcCommandArgs["swap_global_instance"];
      return store.swapGlobalInstance(
        a?.includeRoles,
        a?.resyncInherited,
      ) as IpcCommandReturns[K];
    }
    case "set_project_preset_enabled": {
      const a = args as IpcCommandArgs["set_project_preset_enabled"];
      return store.setProjectPresetEnabled(
        a.projectId,
        a.workspaceRoot,
        a.enabled,
      ) as IpcCommandReturns[K];
    }
    case "remove_project_override": {
      const a = args as IpcCommandArgs["remove_project_override"];
      return store.removeProjectOverride(
        a.projectId,
        a.workspaceRoot,
      ) as IpcCommandReturns[K];
    }
    case "open_studio_window":
    case "toggle_popover_window":
      return undefined as IpcCommandReturns[K];
    default:
      throw new Error(`Unexpected command in test store: ${command}`);
  }
}

describe("VTECH-119 Wave 2 — VTECH-121, VTECH-122 & VTECH-124", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("VTECH-121 (Popover & Studio): exibe monitor de subagentes ativos, distribuição por instância, estado vazio e refresh via t3://snapshot-updated", async () => {
    const user = userEvent.setup();
    const store = new MockIpcStore();
    let emptySubagents = false;

    vi.spyOn(ipcClient, "invokeIpc").mockImplementation(async (command, args) => {
      if (command === IPC_COMMANDS.getDashboardSnapshot) {
        const snap = store.getDashboardSnapshot();
        if (emptySubagents) {
          return {
            ...snap,
            subagents: [],
            projects: snap.projects.map((p) => ({ ...p, activeSubagentCount: 0 })),
          };
        }
        return snap;
      }
      return dispatchMockCommand(store, command, args);
    });

    // 1. PopoverView
    setLocationSearch("?view=popover");
    const { unmount } = render(<App />);

    const strip = await screen.findByLabelText("Subagentes ativos agora");
    expect(strip).toHaveTextContent("2 subagentes ativos");
    expect(strip).toHaveTextContent("Agy Principal · 1");
    expect(strip).toHaveTextContent("Agy Veca · 1");

    const monitorSection = screen.getByRole("region", {
      name: /Monitor de Subagentes/i,
    });
    const toggleBtn = within(monitorSection).getByRole("button", {
      name: /Monitor de Subagentes/i,
    });
    expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
    expect(toggleBtn).toHaveTextContent("2 ativos");

    await user.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute("aria-expanded", "true");
    expect(within(monitorSection).getByText("frontend-ui")).toBeInTheDocument();
    expect(within(monitorSection).getByText("backend")).toBeInTheDocument();
    expect(within(monitorSection).getByText("qa-reviewer")).toBeInTheDocument();
    expect(within(monitorSection).getAllByText("Em execução")).toHaveLength(2);

    // Emite t3://snapshot-updated sem subagentes ativos -> strip some e empty state aparece
    emptySubagents = true;
    await act(async () => {
      ipcClient.emitMockSnapshotUpdated();
    });

    await waitFor(() => {
      expect(
        screen.queryByLabelText("Subagentes ativos agora"),
      ).not.toBeInTheDocument();
    });
    expect(
      within(monitorSection).getByText("Nenhum subagente ativo ou recente."),
    ).toBeInTheDocument();
    expect(toggleBtn).toHaveTextContent("0 ativos");

    unmount();

    // 2. StudioView & StudioSidebar (com preservação de rascunho dirty em t3://snapshot-updated)
    emptySubagents = false;
    setLocationSearch("?view=studio");
    render(<App />);

    const studioToggle = await screen.findByRole("button", {
      name: /Subagentes: 2 ativos/i,
    });
    expect(studioToggle).toHaveAttribute("aria-expanded", "false");
    await user.click(studioToggle);
    expect(studioToggle).toHaveAttribute("aria-expanded", "true");

    const studioPanel = screen.getByRole("region", {
      name: "Monitor de Subagentes",
    });
    expect(within(studioPanel).getByText("frontend-ui")).toBeInTheDocument();
    expect(within(studioPanel).getByText("backend")).toBeInTheDocument();
    expect(within(studioPanel).getByText("qa-reviewer")).toBeInTheDocument();

    const sidebar = screen.getByRole("complementary", {
      name: "Navegação de Presets e Projetos",
    });
    expect(within(sidebar).getAllByText("1 subagente")).toHaveLength(2);

    // Torna o rascunho sujo e recebe snapshot-updated -> não descarta edição local
    const descInput = screen.getByLabelText("Descrição");
    await user.clear(descInput);
    await user.type(descInput, "Rascunho preservado durante snapshot-updated");

    emptySubagents = true;
    await act(async () => {
      ipcClient.emitMockSnapshotUpdated();
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Subagentes: 0 ativos/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Descrição")).toHaveValue(
      "Rascunho preservado durante snapshot-updated",
    );
  });

  it("VTECH-122 (PopoverView): CTA seguro 'Importar Squad' em cabrito, busca ⌘K encontrando 'Seguindo Global Default' (landing-page) e Esc em dois passos", async () => {
    const user = userEvent.setup();
    const store = new MockIpcStore();
    setLocationSearch("?view=popover");

    const invokeSpy = vi
      .spyOn(ipcClient, "invokeIpc")
      .mockImplementation(async (command, args) =>
        dispatchMockCommand(store, command, args),
      );

    render(<App />);

    // cabrito inicia como "Squad s/ preset" -> exibe CTA seguro "Importar Squad"
    const importBtn = await screen.findByRole("button", {
      name: "Importar squad de cabrito",
    });
    expect(importBtn).toHaveTextContent("Importar Squad");
    expect(
      screen.getByText(/Squad manual detectada\. Importe antes de sincronizar\./i),
    ).toBeInTheDocument();

    await user.click(importBtn);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /Squad de cabrito importada com segurança para .*\.t3code\/preset\.jsonc/i,
      );
    });
    expect(
      screen.queryByRole("button", { name: "Importar squad de cabrito" }),
    ).not.toBeInTheDocument();

    // ⌘K foca busca e encontra projeto sem override ("Seguindo Global Default")
    const filterInput = screen.getByLabelText("Filtrar projetos");
    await user.keyboard("{Meta>}k{/Meta}");
    expect(filterInput).toHaveFocus();

    await user.type(filterInput, "landing");
    const unconfiguredRegion = await screen.findByLabelText(
      "Projetos seguindo Global Default",
    );
    expect(within(unconfiguredRegion).getByText("landing-page")).toBeInTheDocument();
    expect(
      within(unconfiguredRegion).getByText("Seguindo Global Default (1)"),
    ).toBeInTheDocument();

    // Ação rápida "Configurar" abre formulário "+ Configurar Projeto" já apontando para landing-page
    await user.click(
      within(unconfiguredRegion).getByRole("button", {
        name: "Configurar landing-page",
      }),
    );
    expect(
      screen.getByLabelText("Selecionar projeto para configurar"),
    ).toHaveValue("proj-landing-page");

    // Ação rápida "Abrir landing-page no Studio"
    await user.click(
      within(unconfiguredRegion).getByRole("button", {
        name: "Abrir landing-page no Studio",
      }),
    );
    expect(invokeSpy).toHaveBeenCalledWith(IPC_COMMANDS.openStudioWindow, {
      projectId: "proj-landing-page",
      presetId: null,
    });

    // Esc com busca preenchida limpa filtro sem fechar Popover; segundo Esc fecha Popover
    await user.click(filterInput);
    await user.keyboard("{Escape}");
    expect(filterInput).toHaveValue("");
    expect(invokeSpy).not.toHaveBeenCalledWith(
      IPC_COMMANDS.togglePopoverWindow,
    );

    await user.keyboard("{Escape}");
    expect(invokeSpy).toHaveBeenCalledWith(IPC_COMMANDS.togglePopoverWindow);
  });

  it("VTECH-124 (PopoverView): comunica efeito em novas threads, executa Swap Squad Global/Projeto e exibe alerta de falha parcial", async () => {
    const user = userEvent.setup();
    const store = new MockIpcStore();
    setLocationSearch("?view=popover");

    let injectPartialFailure = false;
    const invokeSpy = vi
      .spyOn(ipcClient, "invokeIpc")
      .mockImplementation(async (command, args) => {
        if (command === IPC_COMMANDS.swapGlobalInstance && injectPartialFailure) {
          const a = args as IpcCommandArgs["swap_global_instance"];
          const snap = store.swapGlobalInstance(
            a?.includeRoles,
            a?.resyncInherited,
          );
          return {
            ...snap,
            lastGlobalSwapReport: {
              includeRoles: true,
              resyncInherited: true,
              rebalancedRolesCount: 5,
              rebalancedRoles: ["explorer", "oracle", "designer", "fixer", "qa-reviewer"],
              resyncedProjects: [
                {
                  projectId: "proj-oh-my-t3code",
                  title: "oh-my-t3code",
                  workspaceRoot: "/Users/alencarfreire/.t3/projects/oh-my-t3code",
                  presetId: "agy-dual",
                  writtenFiles: [],
                },
              ],
              failedProjects: [
                {
                  projectId: "proj-legacy",
                  title: "legacy-repo",
                  workspaceRoot: "/tmp/legacy-repo",
                  error: "EACCES permission denied",
                },
              ],
            },
          };
        }
        return dispatchMockCommand(store, command, args);
      });

    render(<App />);

    expect(
      await screen.findByText(/Swaps aplicam-se a novas threads no T3 Code\./i),
    ).toBeInTheDocument();

    // 1. Swap Global simples
    await user.click(
      screen.getByRole("button", { name: "Inverter instância global" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /Alteração vale para novas threads no T3 Code\./i,
      );
    });

    // 2. Troca Global para agy-dual e dispara Swap Squad Global com falha parcial simulada
    await user.selectOptions(
      screen.getByLabelText("Preset Global Default"),
      "agy-dual",
    );
    injectPartialFailure = true;
    await user.click(
      screen.getByRole("button", { name: "Swap completo da squad global" }),
    );

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith(IPC_COMMANDS.swapGlobalInstance, {
        includeRoles: true,
        resyncInherited: true,
      });
    });

    expect(screen.getByRole("status")).toHaveTextContent(/5 papéis rebalanceados/i);
    expect(screen.getByRole("status")).toHaveTextContent(
      /1 projeto herdado ressincronizado/i,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /Alteração vale para novas threads no T3 Code\./i,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /Falha parcial ao ressincronizar 1 projeto: legacy-repo \(EACCES permission denied\)/i,
    );

    // 3. Swap Squad no projeto oh-my-t3code
    await user.click(
      screen.getByRole("button", {
        name: "Swap completo da squad em oh-my-t3code",
      }),
    );

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith(IPC_COMMANDS.swapProjectInstance, {
        projectId: "proj-oh-my-t3code",
        workspaceRoot: "/Users/alencarfreire/.t3/projects/oh-my-t3code",
        includeRoles: true,
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      /Instância alternada em oh-my-t3code.*papéis rebalanceados.*Alteração vale para novas threads no T3 Code\./i,
    );
  });

  it("VTECH-124 (StudioView): suporta Swap Global/Projeto e Swap Squad com guarda SM-5 para alterações não salvas", async () => {
    const user = userEvent.setup();
    const store = new MockIpcStore();
    setLocationSearch("?view=studio");

    const invokeSpy = vi
      .spyOn(ipcClient, "invokeIpc")
      .mockImplementation(async (command, args) =>
        dispatchMockCommand(store, command, args),
      );

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Default (OMOS Standard)",
      }),
    ).toBeInTheDocument();

    // Edita descrição para tornar dirty=true e tenta Swap Squad Global -> abre alertdialog SM-5
    const descInput = screen.getByLabelText("Descrição");
    await user.type(descInput, " (dirty)");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Swap completo da squad global" }),
    );
    const dirtyDialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dirtyDialog).getByRole("button", { name: "Continuar editando" }),
    );
    expect(invokeSpy).not.toHaveBeenCalledWith(
      IPC_COMMANDS.swapGlobalInstance,
      expect.anything(),
    );

    // Confirma descarte para executar Swap Squad Global
    await user.click(
      screen.getByRole("button", { name: "Swap completo da squad global" }),
    );
    const confirmDialog = await screen.findByRole("alertdialog");
    await user.click(
      within(confirmDialog).getByRole("button", {
        name: "Descartar alterações e continuar",
      }),
    );

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith(IPC_COMMANDS.swapGlobalInstance, {
        includeRoles: true,
        resyncInherited: true,
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      /Alteração vale para novas threads no T3 Code\./i,
    );
    expect(screen.queryByText("Alterações não salvas")).not.toBeInTheDocument();

    // Seleciona projeto oh-my-t3code e executa Swap Squad no Studio
    const sidebar = screen.getByRole("complementary", {
      name: "Navegação de Presets e Projetos",
    });
    await user.click(
      within(sidebar).getByRole("button", { name: /oh-my-t3code/i }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "oh-my-t3code" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Swap completo da squad em oh-my-t3code",
      }),
    );

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith(IPC_COMMANDS.swapProjectInstance, {
        projectId: "proj-oh-my-t3code",
        workspaceRoot: "/Users/alencarfreire/.t3/projects/oh-my-t3code",
        includeRoles: true,
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      /Instância alternada em oh-my-t3code.*Alteração vale para novas threads no T3 Code\./i,
    );
  });
});
