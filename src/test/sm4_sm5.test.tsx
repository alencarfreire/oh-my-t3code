import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    case "swap_global_instance":
      return store.swapGlobalInstance() as IpcCommandReturns[K];
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

describe("SM-4 & SM-5: Concorrência, Navegação e Falhas Parciais", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("SM4-BUG-1 (PopoverView): Swap Global em andamento bloqueia Toggle e Select, e loadSnapshot out-of-order ou anterior à mutação é descartado", async () => {
    const user = userEvent.setup();
    const store = new MockIpcStore();
    setLocationSearch("?view=popover");

    const swapDeferred =
      createDeferred<IpcCommandReturns["swap_global_instance"]>();
    const initialSnapDeferred =
      createDeferred<IpcCommandReturns["get_dashboard_snapshot"]>();
    const refreshSnapDeferred =
      createDeferred<IpcCommandReturns["get_dashboard_snapshot"]>();
    const postMutationRefreshDeferred =
      createDeferred<IpcCommandReturns["get_dashboard_snapshot"]>();

    let snapshotCalls = 0;
    const invokeSpy = vi
      .spyOn(ipcClient, "invokeIpc")
      .mockImplementation(async (command, args) => {
        if (command === IPC_COMMANDS.getDashboardSnapshot) {
          snapshotCalls += 1;
          if (snapshotCalls === 1) return initialSnapDeferred.promise;
          if (snapshotCalls === 2) return refreshSnapDeferred.promise;
          if (snapshotCalls === 3) return postMutationRefreshDeferred.promise;
        }
        if (command === IPC_COMMANDS.swapGlobalInstance) {
          return swapDeferred.promise;
        }
        return dispatchMockCommand(store, command, args);
      });

    render(<App />);

    // Dispara Refresh enquanto o load inicial ainda está em voo (SM4-BUG-1 out-of-order)
    const refreshBtn = await screen.findByRole("button", {
      name: "Atualizar painel",
    });
    await user.click(refreshBtn);
    expect(snapshotCalls).toBe(2);

    // O refresh mais novo resolve primeiro com 'agy-dual'
    store.setGlobalPresetConfig("agy-dual", true);
    await act(async () => {
      refreshSnapDeferred.resolve(store.getDashboardSnapshot());
    });

    const globalCard = await screen.findByRole("region", {
      name: /Preset Global \(Default\)/i,
    });
    const globalSelect = within(globalCard).getByLabelText(
      "Preset Global Default",
    ) as HTMLSelectElement;
    expect(globalSelect).toHaveValue("agy-dual");

    // O load inicial antigo resolve DEPOIS com erro/dado obsoleto -> deve ser descartado
    await act(async () => {
      initialSnapDeferred.reject(new Error("Stale initial snapshot error"));
    });
    expect(globalSelect).toHaveValue("agy-dual");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Volta para 'default' (Codex) para testar bloqueio durante Swap Global
    await user.selectOptions(globalSelect, "default");
    await waitFor(() => {
      expect(globalSelect).toHaveValue("default");
    });

    const globalToggle = within(globalCard).getByRole("button", {
      name: "Alternar status do Preset Global",
    });
    const swapButton = within(globalCard).getByRole("button", {
      name: "Inverter instância global",
    });

    // Inicia Swap Global (fica pendente em swapDeferred)
    await user.click(swapButton);

    await waitFor(() => {
      expect(globalToggle).toBeDisabled();
      expect(globalSelect).toBeDisabled();
      expect(swapButton).toBeDisabled();
    });

    const configCallsBefore = invokeSpy.mock.calls.filter(
      ([cmd]) => cmd === IPC_COMMANDS.setGlobalPresetConfig,
    ).length;

    // Cliques concorrentes enquanto Swap está ativo não podem disparar set_global_preset_config
    await user.click(globalToggle);
    expect(
      invokeSpy.mock.calls.filter(
        ([cmd]) => cmd === IPC_COMMANDS.setGlobalPresetConfig,
      ).length,
    ).toBe(configCallsBefore);

    // Inicia um Refresh em paralelo e finaliza o Swap antes do Refresh resolver
    await user.click(refreshBtn);
    expect(snapshotCalls).toBe(3);

    const staleBeforeSwap = store.getDashboardSnapshot();
    const swappedSnap = store.swapGlobalInstance();
    await act(async () => {
      swapDeferred.resolve(swappedSnap);
    });

    await waitFor(() => {
      expect(swapButton).toHaveTextContent("Codex · gpt-6.1-terra");
      expect(globalToggle).not.toBeDisabled();
      expect(globalSelect).not.toBeDisabled();
    });

    // O Refresh anterior à mutação resolve atrasado com gpt-6.1-sol -> deve ser descartado!
    await act(async () => {
      postMutationRefreshDeferred.resolve(staleBeforeSwap);
    });
    expect(swapButton).toHaveTextContent("Codex · gpt-6.1-terra");
    expect(refreshBtn).not.toBeDisabled();
  });

  it("SM4-BUG-2 (PopoverView): atualiza selectedPresets quando o backend muda, preserva seleção local pendente e retentativa de Sync cancela timer anterior", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const store = new MockIpcStore();
    setLocationSearch("?view=popover");

    vi.spyOn(ipcClient, "invokeIpc").mockImplementation(async (command, args) =>
      dispatchMockCommand(store, command, args),
    );

    render(<App />);

    const ohMySelect = (await screen.findByLabelText(
      "Preset para oh-my-t3code",
    )) as HTMLSelectElement;
    const cabritoSelect = screen.getByLabelText(
      "Preset para cabrito",
    ) as HTMLSelectElement;

    expect(ohMySelect).toHaveValue("agy-dual");

    // Usuário seleciona localmente 'hybrid-agy-codex' em cabrito sem clicar em Sync ainda
    await user.selectOptions(cabritoSelect, "hybrid-agy-codex");
    expect(cabritoSelect).toHaveValue("hybrid-agy-codex");

    // Mutação externa (Studio) altera o preset de oh-my-t3code para 'codex-squad', sem mexer em cabrito
    const codexPreset = store
      .listGlobalPresets()
      .find((p) => p.id === "codex-squad")!;
    store.saveProjectPreset(
      "proj-oh-my-t3code",
      "/Users/alencarfreire/.t3/projects/oh-my-t3code",
      {
        ...codexPreset,
        id: "oh-my-t3code",
        extends: "codex-squad",
      },
    );

    await user.click(
      screen.getByRole("button", { name: "Atualizar painel" }),
    );

    await waitFor(() => {
      expect(ohMySelect).toHaveValue("codex-squad");
    });
    // Seleção local pendente de cabrito permanece preservada porque o backend de cabrito não mudou
    expect(cabritoSelect).toHaveValue("hybrid-agy-codex");

    // Retentativa de Sync cancelando timer anterior sem apagar prematuramente "Sincronizado!"
    const syncCabritoBtn = screen.getByRole("button", {
      name: "Sync cabrito",
    });

    await user.click(syncCabritoBtn);
    await waitFor(() => {
      expect(syncCabritoBtn).toHaveTextContent("Sincronizado!");
    });

    // Avança 2000ms (< 2600ms) e executa novo Sync em cabrito
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(syncCabritoBtn).toHaveTextContent("Sincronizado!");

    await user.selectOptions(cabritoSelect, "default");
    await user.click(syncCabritoBtn);
    await waitFor(() => {
      expect(syncCabritoBtn).toHaveTextContent("Sincronizado!");
    });

    // Avança 1000ms (total 3000ms desde o 1º Sync): timer anterior teria disparado em 2600ms,
    // mas foi cancelado; o badge "Sincronizado!" deve permanecer visível!
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(syncCabritoBtn).toHaveTextContent("Sincronizado!");

    // Avança mais 1700ms (2700ms desde o 2º Sync): agora sim o badge volta para "Sync"
    await act(async () => {
      vi.advanceTimersByTime(1700);
    });
    expect(syncCabritoBtn).toHaveTextContent(/^Sync$/);
  });

  it("SM5-BUG-1 (StudioView): troca rápida Projeto A -> Projeto B descarta resposta atrasada de A e runPreview descarta resultado out-of-order", async () => {
    const user = userEvent.setup();
    const store = new MockIpcStore();
    setLocationSearch("?view=studio");

    const deferredProjA =
      createDeferred<IpcCommandReturns["get_project_preset"]>();
    const deferredProjB =
      createDeferred<IpcCommandReturns["get_project_preset"]>();
    const deferredPreview1 =
      createDeferred<IpcCommandReturns["preview_preset_sync"]>();
    const deferredPreview2 =
      createDeferred<IpcCommandReturns["preview_preset_sync"]>();

    let previewCalls = 0;

    vi.spyOn(ipcClient, "invokeIpc").mockImplementation(async (command, args) => {
      if (command === IPC_COMMANDS.getProjectPreset) {
        const a = args as IpcCommandArgs["get_project_preset"];
        if (a.projectId === "proj-oh-my-t3code") return deferredProjA.promise;
        if (a.projectId === "proj-cabrito") return deferredProjB.promise;
      }
      if (command === IPC_COMMANDS.previewPresetSync) {
        previewCalls += 1;
        if (previewCalls === 1) return deferredPreview1.promise;
        if (previewCalls === 2) return deferredPreview2.promise;
      }
      return dispatchMockCommand(store, command, args);
    });

    render(<App />);

    const sidebar = await screen.findByRole("complementary", {
      name: "Navegação de Presets e Projetos",
    });

    const ohMyBtn = within(sidebar).getByRole("button", {
      name: /oh-my-t3code/i,
    });
    const cabritoBtn = within(sidebar).getByRole("button", {
      name: /cabrito/i,
    });

    // Troca rápida A -> B
    await user.click(ohMyBtn);
    await user.click(cabritoBtn);

    const resolvedB = store.getProjectPreset(
      "proj-cabrito",
      "/Users/alencarfreire/Workspace/cabrito",
    );
    const resolvedA = store.getProjectPreset(
      "proj-oh-my-t3code",
      "/Users/alencarfreire/.t3/projects/oh-my-t3code",
    );

    // B resolve primeiro
    await act(async () => {
      deferredProjB.resolve(resolvedB);
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "cabrito" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("/Users/alencarfreire/Workspace/cabrito/.t3code/preset.jsonc"),
    ).toBeInTheDocument();

    // A resolve DEPOIS -> não pode sobrescrever cabeçalho nem draftPreset de B
    await act(async () => {
      deferredProjA.resolve(resolvedA);
    });

    expect(
      screen.getByRole("heading", { level: 1, name: "cabrito" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("/Users/alencarfreire/Workspace/cabrito/.t3code/preset.jsonc"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Agora testa runPreview out-of-order na aba Preview & Diff (usando modo global + seletor "Simular no projeto")
    await user.click(
      within(sidebar).getByRole("button", { name: /Default \(OMOS Standard\)/i }),
    );
    await user.click(screen.getByRole("tab", { name: /Preview & Diff/i }));
    await waitFor(() => {
      expect(previewCalls).toBe(1);
    });

    // Muda o projeto simulado para 'proj-cabrito' antes do 1º preview resolver -> dispara 2º preview
    const previewProjectSelect = screen.getByLabelText("Simular no projeto:");
    await user.selectOptions(previewProjectSelect, "proj-cabrito");
    await waitFor(() => {
      expect(previewCalls).toBe(2);
    });

    const defaultPreset = store
      .listGlobalPresets()
      .find((p) => p.id === "default")!;
    const preview1Data = store.previewPresetSync(
      "proj-oh-my-t3code",
      "/Users/alencarfreire/.t3/projects/oh-my-t3code",
      defaultPreset,
    );
    const preview2Data = store.previewPresetSync(
      "proj-cabrito",
      "/Users/alencarfreire/Workspace/cabrito",
      defaultPreset,
    );

    // Preview 2 (proj-cabrito) resolve primeiro
    await act(async () => {
      deferredPreview2.resolve(preview2Data);
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: /\.agents\/skills\/cabrito-squad\/SKILL\.md/i,
        }),
      ).toBeInTheDocument();
    });

    // Preview 1 (proj-oh-my-t3code, stale) resolve depois -> deve ser descartado!
    await act(async () => {
      deferredPreview1.resolve(preview1Data);
    });

    expect(
      screen.getByRole("button", {
        name: /\.agents\/skills\/cabrito-squad\/SKILL\.md/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /\.agents\/skills\/oh-my-t3code-squad\/SKILL\.md/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("SM5-BUG-2 (StudioView): studio://navigate durante cold-start navega ao alvo e re-emissão após mutação externa faz refresh do snapshot", async () => {
    const store = new MockIpcStore();
    setLocationSearch("?view=studio");

    const coldStartSnap =
      createDeferred<IpcCommandReturns["get_dashboard_snapshot"]>();
    let snapCount = 0;

    vi.spyOn(ipcClient, "invokeIpc").mockImplementation(async (command, args) => {
      if (command === IPC_COMMANDS.getDashboardSnapshot) {
        snapCount += 1;
        if (snapCount === 1) return coldStartSnap.promise;
        return store.getDashboardSnapshot();
      }
      return dispatchMockCommand(store, command, args);
    });

    // Para emitir eventos studio://navigate sem depender do mock wrapper, capturamos o handler
    let registeredNavigateHandler:
      | ((payload: ipcClient.StudioNavigatePayload) => void | Promise<void>)
      | null = null;
    vi.spyOn(ipcClient, "listenStudioNavigate").mockImplementation(
      async (handler) => {
        registeredNavigateHandler = handler;
        return () => {
          registeredNavigateHandler = null;
        };
      },
    );

    render(<App />);

    await waitFor(() => {
      expect(registeredNavigateHandler).not.toBeNull();
    });

    // 1. Cold-start: studio://navigate chega ANTES de get_dashboard_snapshot resolver
    await act(async () => {
      await registeredNavigateHandler?.({ projectId: "proj-cabrito", presetId: null });
    });

    // Agora resolve o cold-start snapshot -> deve navegar para 'cabrito' (não 'default')
    await act(async () => {
      coldStartSnap.resolve(store.getDashboardSnapshot());
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "cabrito" }),
      ).toBeInTheDocument();
    });

    // 2. Mutação externa (Popover configura override em landing-page enquanto Studio está aberto)
    store.applyPresetSync(
      "proj-landing-page",
      "/Users/alencarfreire/Workspace/landing-page",
      "codex-squad",
      null,
    );

    // Re-emissão de studio://navigate deve fazer refresh do snapshot e selecionar landing-page
    await act(async () => {
      await registeredNavigateHandler?.({
        projectId: "proj-landing-page",
        presetId: null,
      });
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "landing-page" }),
      ).toBeInTheDocument();
    });
    expect(snapCount).toBeGreaterThanOrEqual(2);
  });

  it("SM5-BUG-3 (StudioView): falha na etapa 2 de handleSaveProjectOverride, handleApplyProjectSync e handleSetAsGlobalDefault zera dirty, sincroniza etapa 1 e exibe erro claro", async () => {
    const user = userEvent.setup();
    const store = new MockIpcStore();
    setLocationSearch("?view=studio&projectId=proj-oh-my-t3code");

    let failApplySync = false;
    let failSetGlobalConfig = false;

    vi.spyOn(ipcClient, "invokeIpc").mockImplementation(async (command, args) => {
      if (command === IPC_COMMANDS.applyPresetSync && failApplySync) {
        throw new Error("EACCES settings.json");
      }
      if (command === IPC_COMMANDS.setGlobalPresetConfig && failSetGlobalConfig) {
        throw new Error("config.jsonc locked");
      }
      return dispatchMockCommand(store, command, args);
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "oh-my-t3code" }),
    ).toBeInTheDocument();

    // 1. Falha na etapa 2 de handleSaveProjectOverride
    const descInput = screen.getByLabelText("Descrição");
    await user.clear(descInput);
    await user.type(descInput, "Descrição gravada etapa 1");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    failApplySync = true;
    await user.click(screen.getByRole("button", { name: /^Salvar Override$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /salvo no disco.*sincronização falhou: EACCES settings\.json/i,
      );
    });
    // dirty voltou para false e o dado salvo na etapa 1 permanece no editor
    expect(screen.queryByText("Alterações não salvas")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Descrição")).toHaveValue(
      "Descrição gravada etapa 1",
    );

    // 2. Falha na etapa 2 de handleApplyProjectSync (Preview & Diff -> Salvar & Sincronizar Projeto)
    await user.clear(descInput);
    await user.type(descInput, "Descrição etapa 1 via sync");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Preview & Diff/i }));
    const syncBtn = await screen.findByRole("button", {
      name: /Salvar & Sincronizar Projeto/i,
    });
    await waitFor(() => {
      expect(syncBtn).not.toBeDisabled();
    });
    await user.click(syncBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /salvo no disco.*sincronização falhou: EACCES settings\.json/i,
      );
    });
    expect(screen.queryByText("Alterações não salvas")).not.toBeInTheDocument();

    // Retentativa após liberar settings.json funciona
    failApplySync = false;
    await user.click(syncBtn);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/Sincronizado!/i);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // 3. Falha na etapa 2 de handleSetAsGlobalDefault
    const sidebar = screen.getByRole("complementary", {
      name: "Navegação de Presets e Projetos",
    });
    await user.click(
      within(sidebar).getByRole("button", { name: /Agy Dual/i }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Agy Dual (Veca + Principal)" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: /Visão Geral & Fallback/i }));
    const globalDesc = screen.getByLabelText("Descrição");
    await user.clear(globalDesc);
    await user.type(globalDesc, "Agy Dual salvo antes de falhar ativação");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    failSetGlobalConfig = true;
    await user.click(
      screen.getByRole("button", { name: /Definir como Global Default/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Preset 'agy-dual' salvo no disco, mas a ativação como Global Default falhou: config\.jsonc locked/i,
      );
    });
    expect(screen.queryByText("Alterações não salvas")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Descrição")).toHaveValue(
      "Agy Dual salvo antes de falhar ativação",
    );
  });

  it("SM4-BUG-1 / VTECH-118 (PopoverView): guard síncrono busyProjectRef bloqueia Sync + Swap/Toggle no mesmo tick e desabilita <Select> do projeto durante busy", async () => {
    const store = new MockIpcStore();
    setLocationSearch("?view=popover");

    const syncDeferred = createDeferred<IpcCommandReturns["apply_preset_sync"]>();
    const invokeSpy = vi
      .spyOn(ipcClient, "invokeIpc")
      .mockImplementation(async (command, args) => {
        if (command === IPC_COMMANDS.applyPresetSync) {
          return syncDeferred.promise;
        }
        return dispatchMockCommand(store, command, args);
      });

    render(<App />);

    const syncBtn = await screen.findByRole("button", {
      name: "Sync oh-my-t3code",
    });
    const swapBtn = screen.getByRole("button", {
      name: "Alternar instância Agy em oh-my-t3code",
    });
    const toggleBtn = screen.getByRole("button", {
      name: "Alternar preset de oh-my-t3code",
    });
    const projectSelect = screen.getByLabelText(
      "Preset para oh-my-t3code",
    ) as HTMLSelectElement;

    expect(projectSelect).not.toBeDisabled();

    // Dispara Sync + Swap + Toggle no mesmo tick síncrono antes de React commitar `disabled`
    await act(async () => {
      fireEvent.click(syncBtn);
      fireEvent.click(swapBtn);
      fireEvent.click(toggleBtn);
    });

    // Apenas a primeira operação IPC (apply_preset_sync) foi disparada; Swap e Toggle foram bloqueados por busyProjectRef
    expect(
      invokeSpy.mock.calls.filter(([cmd]) => cmd === IPC_COMMANDS.applyPresetSync),
    ).toHaveLength(1);
    expect(
      invokeSpy.mock.calls.filter(([cmd]) => cmd === IPC_COMMANDS.swapProjectInstance),
    ).toHaveLength(0);
    expect(
      invokeSpy.mock.calls.filter(([cmd]) => cmd === IPC_COMMANDS.setProjectPresetEnabled),
    ).toHaveLength(0);

    // Select e botões do projeto ficam desabilitados durante o estado busy
    expect(projectSelect).toBeDisabled();
    expect(syncBtn).toBeDisabled();
    expect(swapBtn).toBeDisabled();
    expect(toggleBtn).toBeDisabled();

    const syncResult = store.applyPresetSync(
      "proj-oh-my-t3code",
      "/Users/alencarfreire/.t3/projects/oh-my-t3code",
      "agy-dual",
      null,
    );
    await act(async () => {
      syncDeferred.resolve(syncResult);
    });

    await waitFor(() => {
      expect(projectSelect).not.toBeDisabled();
      expect(swapBtn).not.toBeDisabled();
      expect(toggleBtn).not.toBeDisabled();
    });
  });

  it("SM4-BUG-2 / VTECH-118 (PopoverView): unmount antes dos 2600ms executa clearTimeout e evita callbacks tardios após desmontagem", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const store = new MockIpcStore();
    setLocationSearch("?view=popover");

    vi.spyOn(ipcClient, "invokeIpc").mockImplementation(async (command, args) =>
      dispatchMockCommand(store, command, args),
    );
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(<App />);

    const syncCabritoBtn = await screen.findByRole("button", {
      name: "Sync cabrito",
    });
    await user.click(syncCabritoBtn);

    await waitFor(() => {
      expect(syncCabritoBtn).toHaveTextContent("Sincronizado!");
    });

    clearTimeoutSpy.mockClear();
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("SM5-BUG-2 / VTECH-118 (StudioView): corrida studio://navigate out-of-order preserva último destino e reflete mutações do Popover", async () => {
    const store = new MockIpcStore();
    setLocationSearch("?view=studio");

    const nav1SnapDeferred =
      createDeferred<IpcCommandReturns["get_dashboard_snapshot"]>();
    const nav2SnapDeferred =
      createDeferred<IpcCommandReturns["get_dashboard_snapshot"]>();
    let snapshotCallCount = 0;

    vi.spyOn(ipcClient, "invokeIpc").mockImplementation(async (command, args) => {
      if (command === IPC_COMMANDS.getDashboardSnapshot) {
        snapshotCallCount += 1;
        if (snapshotCallCount === 1) return store.getDashboardSnapshot();
        if (snapshotCallCount === 2) return nav1SnapDeferred.promise;
        if (snapshotCallCount === 3) return nav2SnapDeferred.promise;
      }
      return dispatchMockCommand(store, command, args);
    });

    let registeredNavigateHandler:
      | ((payload: ipcClient.StudioNavigatePayload) => void | Promise<void>)
      | null = null;
    vi.spyOn(ipcClient, "listenStudioNavigate").mockImplementation(
      async (handler) => {
        registeredNavigateHandler = handler;
        return () => {
          registeredNavigateHandler = null;
        };
      },
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Default (OMOS Standard)",
      }),
    ).toBeInTheDocument();
    expect(registeredNavigateHandler).not.toBeNull();

    // Captura snapshot antes da mutação do Popover para o nav1 lento
    const staleNav1Snapshot = store.getDashboardSnapshot();

    // Popover atualiza cabrito para codex-squad enquanto Studio está aberto
    store.applyPresetSync(
      "proj-cabrito",
      "/Users/alencarfreire/Workspace/cabrito",
      "codex-squad",
      null,
    );
    const freshNav2Snapshot = store.getDashboardSnapshot();

    // Dispara nav1 (lento -> oh-my-t3code) e imediatamente nav2 (rápido -> cabrito)
    let nav1Promise: void | Promise<void>;
    let nav2Promise: void | Promise<void>;
    await act(async () => {
      nav1Promise = registeredNavigateHandler?.({
        projectId: "proj-oh-my-t3code",
        presetId: null,
      });
      nav2Promise = registeredNavigateHandler?.({
        projectId: "proj-cabrito",
        presetId: null,
      });
    });

    expect(snapshotCallCount).toBe(3);

    // nav2 (cabrito com snapshot atualizado pelo Popover) resolve primeiro
    await act(async () => {
      nav2SnapDeferred.resolve(freshNav2Snapshot);
      await nav2Promise;
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "cabrito" }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/Orquestrador: Codex/i)).toHaveTextContent(
      /gpt-6\.1-sol/i,
    );

    // nav1 (oh-my-t3code atrasado) resolve depois -> não deve sobrescrever o Studio!
    await act(async () => {
      nav1SnapDeferred.resolve(staleNav1Snapshot);
      await nav1Promise;
    });

    expect(
      screen.getByRole("heading", { level: 1, name: "cabrito" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 1, name: "oh-my-t3code" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
