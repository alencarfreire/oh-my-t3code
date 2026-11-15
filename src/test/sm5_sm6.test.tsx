import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import * as ipcClient from "../lib/ipc-client";
import { MockIpcStore } from "../lib/mock-data";
import { clonePreset, createEmptyPreset } from "../lib/preset-utils";
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

describe("SM5-BUG-4 & SM6-BUG-1: Guarda de dirty/saving no Studio e Paridade do MockIpcStore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("SM5-BUG-4 (StudioView): exibe alertdialog acessível quando dirty=true ao trocar preset/projeto/criar, suporta Escape e Continuar editando vs Descartar", async () => {
    const user = userEvent.setup();
    const store = new MockIpcStore();
    setLocationSearch("?view=studio");

    vi.spyOn(ipcClient, "invokeIpc").mockImplementation(async (command, args) =>
      dispatchMockCommand(store, command, args),
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Default (OMOS Standard)",
      }),
    ).toBeInTheDocument();

    // Edita Nome do Preset -> dirty = true
    const nameInput = screen.getByLabelText("Nome do Preset") as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, "Default Editado Localmente");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    const sidebar = screen.getByRole("complementary", {
      name: "Navegação de Presets e Projetos",
    });

    // Clicar no preset JÁ selecionado não abre confirmação
    await user.click(
      within(sidebar).getByRole("button", { name: /Default \(OMOS Standard\)/i }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    // Tentar trocar para Agy Dual -> abre alertdialog acessível
    await user.click(
      within(sidebar).getByRole("button", { name: /Agy Dual/i }),
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      within(dialog).getByRole("heading", { name: "Alterações não salvas" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /Você tem edições não salvas no preset atual/i,
      ),
    ).toBeInTheDocument();

    const keepEditingBtn = within(dialog).getByRole("button", {
      name: "Continuar editando",
    });
    expect(keepEditingBtn).toHaveFocus();

    // Cancelar via botão "Continuar editando" mantém edições
    await user.click(keepEditingBtn);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(nameInput).toHaveValue("Default Editado Localmente");
    expect(
      screen.getByRole("heading", { level: 1, name: "Default Editado Localmente" }),
    ).toBeInTheDocument();

    // Tentar trocar para projeto oh-my-t3code -> abre alertdialog; Escape cancela
    await user.click(
      within(sidebar).getByRole("button", { name: /oh-my-t3code/i }),
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(nameInput).toHaveValue("Default Editado Localmente");

    // Tentar trocar para Agy Dual e confirmar descarte
    await user.click(
      within(sidebar).getByRole("button", { name: /Agy Dual/i }),
    );
    const confirmDialog = screen.getByRole("alertdialog");
    await user.click(
      within(confirmDialog).getByRole("button", {
        name: "Descartar alterações e continuar",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "Agy Dual (Veca + Principal)",
        }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Alterações não salvas")).not.toBeInTheDocument();

    // Tornar Agy Dual dirty e tentar criar Novo Preset Global -> também passa pela guarda
    const agyNameInput = screen.getByLabelText("Nome do Preset");
    await user.type(agyNameInput, " (Draft)");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    await user.click(
      within(sidebar).getByRole("button", { name: "Novo Preset Global" }),
    );
    await user.type(within(sidebar).getByLabelText(/ID do Preset/i), "new-dirty-test");
    await user.click(within(sidebar).getByRole("button", { name: "Criar" }));

    const createDialog = screen.getByRole("alertdialog");
    await user.click(
      within(createDialog).getByRole("button", {
        name: "Descartar alterações e continuar",
      }),
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "new-dirty-test" }),
    ).toBeInTheDocument();
  });

  it("SM5-BUG-4 (StudioView): studio://navigate com dirty=true pede confirmação antes de trocar e saving=true desabilita sidebar e adia navegação", async () => {
    const user = userEvent.setup();
    const store = new MockIpcStore();
    setLocationSearch("?view=studio");

    const saveDeferred = createDeferred<IpcCommandReturns["save_global_preset"]>();
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

    vi.spyOn(ipcClient, "invokeIpc").mockImplementation(async (command, args) => {
      if (command === IPC_COMMANDS.saveGlobalPreset) {
        return saveDeferred.promise;
      }
      return dispatchMockCommand(store, command, args);
    });

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Default (OMOS Standard)",
      }),
    ).toBeInTheDocument();

    // Edita preset para ficar dirty=true e sai do campo para concluir blur/change antes do evento IPC
    const nameInput = screen.getByLabelText("Nome do Preset") as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, "Default Não Salvo");
    await user.tab();

    // 1. Emite studio://navigate enquanto dirty=true -> deve abrir alertdialog
    await act(async () => {
      await registeredNavigateHandler?.({ projectId: "proj-oh-my-t3code", presetId: null });
    });

    const navDialog = await screen.findByRole("alertdialog");
    await user.click(
      within(navDialog).getByRole("button", { name: "Continuar editando" }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Default Não Salvo" }),
    ).toBeInTheDocument();

    // 2. Inicia save (saving = true) -> sidebar inteira deve ficar desabilitada
    await user.click(
      screen.getByRole("button", { name: "Salvar Preset Global" }),
    );

    const sidebar = screen.getByRole("complementary", {
      name: "Navegação de Presets e Projetos",
    });

    const newPresetBtn = within(sidebar).getByRole("button", {
      name: "Novo Preset Global",
    });
    const configProjBtn = within(sidebar).getByRole("button", {
      name: "Configurar Projeto",
    });
    const agyBtn = within(sidebar).getByRole("button", {
      name: /Agy Dual/i,
    });
    const ohMyBtn = within(sidebar).getByRole("button", {
      name: /oh-my-t3code/i,
    });

    await waitFor(() => {
      expect(newPresetBtn).toBeDisabled();
      expect(configProjBtn).toBeDisabled();
      expect(agyBtn).toBeDisabled();
      expect(ohMyBtn).toBeDisabled();
    });

    // Emite studio://navigate durante saving=true -> deve ser adiado até saving terminar
    await act(async () => {
      await registeredNavigateHandler?.({ projectId: "proj-cabrito", presetId: null });
    });
    expect(
      screen.getByRole("heading", { level: 1, name: "Default Não Salvo" }),
    ).toBeInTheDocument();

    const baseDefault = store
      .listGlobalPresets()
      .find((p) => p.id === "default")!;
    const savedPreset = store.saveGlobalPreset({
      ...clonePreset(baseDefault),
      name: "Default Não Salvo",
    });

    await act(async () => {
      saveDeferred.resolve(savedPreset);
    });

    // Após salvar, a navegação adiada para cabrito é drenada e a sidebar volta a ficar habilitada
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "cabrito" }),
      ).toBeInTheDocument();
    });
    expect(newPresetBtn).not.toBeDisabled();
    expect(configProjBtn).not.toBeDisabled();
    expect(agyBtn).not.toBeDisabled();
    expect(ohMyBtn).not.toBeDisabled();
  });

  it("SM6-BUG-1 (MockIpcStore): garante paridade estrita com backend Rust (getProjectPreset, validação atômica, disabledRoles/prune e fallbacks)", () => {
    const store = new MockIpcStore();
    const cabritoRoot = "/Users/alencarfreire/Workspace/cabrito";
    const landingRoot = "/Users/alencarfreire/Workspace/landing-page";

    // 1. getProjectPreset sem override local segue activeGlobalPresetId (mesmo se activeInstanceId era antigravity/codex)
    const initialCabrito = store.getProjectPreset("proj-cabrito", cabritoRoot);
    expect(initialCabrito.hasLocalOverride).toBe(false);
    expect(initialCabrito.resolvedPreset.id).toBe("default");

    store.setGlobalPresetConfig("agy-dual", true);
    const agyCabrito = store.getProjectPreset("proj-cabrito", cabritoRoot);
    expect(agyCabrito.resolvedPreset.id).toBe("agy-dual");

    // 2. setGlobalPresetConfig valida ID e existência antes de mutar estado
    expect(() => store.setGlobalPresetConfig("../evil", true)).toThrow(/Invalid/i);
    expect(() => store.setGlobalPresetConfig("missing-preset", true)).toThrow(
      /not found/i,
    );
    expect(store.getDashboardSnapshot().globalConfig.activeGlobalPresetId).toBe(
      "agy-dual",
    );

    // 3. applyPresetSync rejeita preset desconhecido sem fallback silencioso ou mutação parcial
    const compiledBefore = store.getCompiledFilePaths();
    expect(() =>
      store.applyPresetSync("proj-landing-page", landingRoot, "non-existent-id"),
    ).toThrow(/not found/i);
    expect(store.getCompiledFilePaths()).toEqual(compiledBefore);
    expect(store.hasProjectSettingsOverride("proj-landing-page")).toBe(false);

    // 4. saveGlobalPreset e saveProjectPreset validam herança/ciclo atomicamente antes de gravar
    const invalidGlobal = createEmptyPreset("broken-global", "non-existent-parent");
    expect(() => store.saveGlobalPreset(invalidGlobal)).toThrow(/not found/i);
    expect(store.listGlobalPresets().some((p) => p.id === "broken-global")).toBe(
      false,
    );

    const selfExtend = createEmptyPreset("self-cycle", "self-cycle");
    expect(() => store.saveGlobalPreset(selfExtend)).toThrow(/extend itself/i);

    const brokenLocal = createEmptyPreset("landing-page", "non-existent-parent");
    expect(() =>
      store.saveProjectPreset("proj-landing-page", landingRoot, brokenLocal),
    ).toThrow(/not found/i);
    expect(
      store.getProjectPreset("proj-landing-page", landingRoot).hasLocalOverride,
    ).toBe(false);

    // 5. applyPresetSync com extends + disabledRoles compila e faz prune de roles/*.md removidas
    store.applyPresetSync("proj-landing-page", landingRoot, "agy-dual");
    expect(store.getCompiledFilePaths()).toContain(
      `${landingRoot}/.agents/skills/landing-page-squad/roles/oracle.md`,
    );

    const withDisabledRole: typeof invalidGlobal = {
      ...createEmptyPreset("landing-page", "agy-dual", ["oracle"]),
      enabled: true,
    };
    store.applyPresetSync("proj-landing-page", landingRoot, null, withDisabledRole);
    expect(store.getCompiledFilePaths()).not.toContain(
      `${landingRoot}/.agents/skills/landing-page-squad/roles/oracle.md`,
    );
    expect(store.getCompiledFilePaths()).toContain(
      `${landingRoot}/.agents/skills/landing-page-squad/roles/fixer.md`,
    );
    expect(store.hasProjectSettingsOverride("proj-landing-page")).toBe(true);

    // 6. setProjectPresetEnabled(false) com Global ativo faz fallback para o Global ativo;
    //    com Global pausado faz fallback para activeInstanceId=null e activeModel=defaultModel
    store.setProjectPresetEnabled("proj-landing-page", landingRoot, false);
    expect(store.hasProjectSettingsOverride("proj-landing-page")).toBe(false);
    let snap = store.getDashboardSnapshot();
    let landingSummary = snap.projects.find(
      (p) => p.projectId === "proj-landing-page",
    );
    expect(landingSummary?.presetEnabled).toBe(false);
    expect(landingSummary?.activeInstanceId).toBe("antigravity_2");

    store.setGlobalPresetConfig("agy-dual", false);
    snap = store.getDashboardSnapshot();
    landingSummary = snap.projects.find(
      (p) => p.projectId === "proj-landing-page",
    );
    expect(landingSummary?.activeInstanceId).toBeNull();
    expect(landingSummary?.activeModel).toBe(landingSummary?.defaultModel);

    // 7. swapGlobalInstance reflete em projetos seguindo fallback global e rejeita se config estiver inconsistente
    store.setGlobalPresetConfig("default", true);
    const swappedSnap = store.swapGlobalInstance();
    expect(swappedSnap.defaultModelSelection?.model).toBe("gpt-6.1-terra");
    const cabritoAfterSwap = swappedSnap.projects.find(
      (p) => p.projectId === "proj-cabrito",
    );
    // cabrito tem hasCustomOverride=true e presetEnabled=true; landing-page tem presetEnabled=false -> segue global
    const landingAfterSwap = swappedSnap.projects.find(
      (p) => p.projectId === "proj-landing-page",
    );
    expect(cabritoAfterSwap).toBeDefined();
    expect(landingAfterSwap?.activeInstanceId).toBe("codex");
    expect(landingAfterSwap?.activeModel).toBe("gpt-6.1-terra");

    // 8. previewPresetSync inclui .t3code/preset.jsonc como 1º item e retorna newOverride=null quando enabled=false
    const agyDual = store.listGlobalPresets().find((p) => p.id === "agy-dual")!;
    const beforePreview = store.previewPresetSync(
      "proj-cabrito",
      cabritoRoot,
      agyDual,
    );
    expect(beforePreview.files[0]?.relativePath).toBe(".t3code/preset.jsonc");
    expect(beforePreview.files[0]?.existingContent).toBeNull();
    expect(beforePreview.files[0]?.changed).toBe(true);

    store.applyPresetSync("proj-cabrito", cabritoRoot, null, agyDual);
    const cleanPreview = store.previewPresetSync(
      "proj-cabrito",
      cabritoRoot,
      agyDual,
    );
    expect(cleanPreview.files[0]?.relativePath).toBe(".t3code/preset.jsonc");
    expect(cleanPreview.files[0]?.existingContent).not.toBeNull();
    expect(cleanPreview.files[0]?.changed).toBe(false);
    expect(cleanPreview.hasChanges).toBe(false);

    const disabledPreview = store.previewPresetSync("proj-cabrito", cabritoRoot, {
      ...clonePreset(agyDual),
      enabled: false,
    });
    expect(disabledPreview.settingsPreview.newOverride).toBeNull();
    expect(disabledPreview.settingsPreview.changed).toBe(true);
  });
});
