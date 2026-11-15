import { render, screen, waitFor, within } from "@testing-library/react";
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

describe("Jornadas Reais de Usabilidade (Popover & Preset Studio)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Jornada 1 (Popover — descoberta, ⌘K, Swap Global/Projeto, + Configurar Projeto e retorno ao Global)", async () => {
    const user = userEvent.setup();
    const store = new MockIpcStore();
    setLocationSearch("?view=popover");

    vi.spyOn(ipcClient, "invokeIpc").mockImplementation(async (command, args) =>
      dispatchMockCommand(store, command, args),
    );

    render(<App />);

    // 1. Verifica card Global Default, faixa de subagentes ativos (VTECH-121) e projetos iniciais com override (oh-my-t3code e cabrito)
    const globalCard = await screen.findByRole("region", {
      name: /Preset Global \(Default\)/i,
    });
    expect(globalCard).toBeInTheDocument();
    expect(
      screen.getByText(/Swaps aplicam-se a novas threads no T3 Code\./i),
    ).toBeInTheDocument();

    const activeStrip = screen.getByLabelText("Subagentes ativos agora");
    expect(activeStrip).toHaveTextContent("2 subagentes ativos");
    expect(activeStrip).toHaveTextContent("Agy Principal · 1");
    expect(activeStrip).toHaveTextContent("Agy Veca · 1");

    // cabrito ("Squad s/ preset") exibe CTA seguro "Importar Squad" (VTECH-122)
    const importCabritoBtn = screen.getByRole("button", {
      name: "Importar squad de cabrito",
    });
    expect(importCabritoBtn).toBeInTheDocument();
    await user.click(importCabritoBtn);
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Importar squad de cabrito" }),
      ).not.toBeInTheDocument();
    });

    const searchInput = screen.getByRole("searchbox", {
      name: "Filtrar projetos",
    });

    // Atalho ⌘K foca o input de busca e descobre projeto seguindo Global Default (VTECH-122)
    await user.keyboard("{Meta>}k{/Meta}");
    expect(searchInput).toHaveFocus();

    await user.type(searchInput, "landing");
    const followingSection = await screen.findByLabelText(
      "Projetos seguindo Global Default",
    );
    expect(within(followingSection).getByText("landing-page")).toBeInTheDocument();

    // Esc com filtro preenchido limpa o filtro sem fechar o Popover
    await user.keyboard("{Escape}");
    expect(searchInput).toHaveValue("");
    expect(screen.getByText("oh-my-t3code")).toBeInTheDocument();

    await user.type(searchInput, "cabrito");
    expect(screen.getByText("cabrito")).toBeInTheDocument();
    expect(screen.queryByText("oh-my-t3code")).not.toBeInTheDocument();

    // Limpa filtro pelo botão acessível "Limpar filtro de projetos"
    await user.click(
      screen.getByRole("button", { name: "Limpar filtro de projetos" }),
    );
    expect(searchInput).toHaveValue("");
    expect(screen.getByText("oh-my-t3code")).toBeInTheDocument();

    // 2. Troca Preset Global para Agy Dual e usa o Swap Global (⇄) e Swap Squad (VTECH-124)
    const globalSelect = within(globalCard).getByLabelText(
      "Preset Global Default",
    ) as HTMLSelectElement;
    await user.selectOptions(globalSelect, "agy-dual");
    await waitFor(() => {
      expect(globalSelect).toHaveValue("agy-dual");
    });

    const globalSwapBtn = within(globalCard).getByRole("button", {
      name: "Inverter instância global",
    });
    expect(globalSwapBtn).toHaveTextContent("Agy Principal");
    await user.click(globalSwapBtn);
    await waitFor(() => {
      expect(globalSwapBtn).toHaveTextContent("Agy Veca");
    });

    const globalSwapSquadBtn = within(globalCard).getByRole("button", {
      name: "Swap completo da squad global",
    });
    await user.click(globalSwapSquadBtn);
    await waitFor(() => {
      expect(globalSwapBtn).toHaveTextContent("Agy Principal");
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      /Alteração vale para novas threads no T3 Code\./i,
    );

    // 3. Usa o Swap individual (⇄) no projeto oh-my-t3code quando a cota aperta
    const ohMySwapBtn = screen.getByRole("button", {
      name: "Alternar instância Agy em oh-my-t3code",
    });
    expect(ohMySwapBtn).toHaveTextContent("Agy Principal");
    await user.click(ohMySwapBtn);
    await waitFor(() => {
      expect(ohMySwapBtn).toHaveTextContent("Agy Veca");
    });

    // 4. Descobre projeto oculto (landing-page) via "+ Configurar Projeto" e cria override
    const addProjectBtn = screen.getByRole("button", {
      name: /Configurar Projeto/i,
    });
    await user.click(addProjectBtn);

    const projectSelect = screen.getByLabelText(
      "Selecionar projeto para configurar",
    );
    const presetSelect = screen.getByLabelText(
      "Selecionar preset para override",
    );
    expect(projectSelect).toHaveValue("proj-landing-page");

    await user.selectOptions(presetSelect, "codex-squad");
    await user.click(screen.getByRole("button", { name: "Aplicar Override" }));

    await waitFor(() => {
      expect(screen.getByText("landing-page")).toBeInTheDocument();
    });

    // 5. Remove override de landing-page clicando em "Global" (volta a seguir Global Default)
    const removeLandingBtn = screen.getByRole("button", {
      name: "Remover override de landing-page",
    });
    await user.click(removeLandingBtn);
    await waitFor(() => {
      expect(screen.queryByText("landing-page")).not.toBeInTheDocument();
    });
  });

  it("Jornada 2 (Studio — criação/edição com extends, Roles Matrix + Tombstones, guarda de dirty state e Preview & Diff obrigatório)", async () => {
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

    const sidebar = screen.getByRole("complementary", {
      name: "Navegação de Presets e Projetos",
    });

    // 1. Seleciona o projeto oh-my-t3code na sidebar
    await user.click(
      within(sidebar).getByRole("button", { name: /oh-my-t3code/i }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "oh-my-t3code" }),
    ).toBeInTheDocument();

    // 2. Edita o Orquestrador na aba Visão Geral & Fallback
    const instanceSelect = screen.getByLabelText(
      "Instância (`providerInstanceId`)",
    );
    await user.selectOptions(instanceSelect, "antigravity");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    // 3. Vai para Matriz de Papéis, remove o papel herdado "oracle" (cria tombstone em disabledRoles) e adiciona novo papel
    await user.click(screen.getByRole("tab", { name: /Matriz de Papéis/i }));

    // Seleciona o papel oracle na lista e clica em "Remover Papel"
    await user.click(screen.getByRole("button", { name: /oracle/i }));
    await user.click(screen.getByRole("button", { name: /Remover Papel/i }));

    // Verifica que oracle saiu da lista de papéis ativos
    expect(
      screen.queryByRole("button", { name: /Oracle — Arquitetura/i }),
    ).not.toBeInTheDocument();

    // Adiciona um novo papel customizado "security-specialist"
    await user.click(screen.getByRole("button", { name: /Adicionar Papel/i }));
    const newRoleIdInput = screen.getByLabelText("ID do Novo Papel");
    await user.type(newRoleIdInput, "security-specialist");
    await user.click(screen.getByRole("button", { name: "Criar" }));

    expect(
      screen.getByDisplayValue("security-specialist"),
    ).toBeInTheDocument();

    // 4. Tenta navegar para outro item na sidebar com dirty=true -> valida proteção alertdialog
    await user.click(
      within(sidebar).getByRole("button", { name: /Agy Dual/i }),
    );
    const dirtyDialog = await screen.findByRole("alertdialog");
    expect(
      within(dirtyDialog).getByRole("heading", { name: "Alterações não salvas" }),
    ).toBeInTheDocument();
    await user.click(
      within(dirtyDialog).getByRole("button", { name: "Continuar editando" }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    // 5. Abre Preview & Diff obrigatório ("Revisar Diff & Sincronizar") antes de sincronizar no repositório
    await user.click(
      screen.getByRole("button", { name: /Revisar Diff & Sincronizar/i }),
    );

    expect(
      await screen.findByText(/Preview & Unified Diff antes da gravação/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /\.t3code\/preset\.jsonc/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /\.agents\/skills\/oh-my-t3code-squad\/SKILL\.md/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /\.agents\/skills\/oh-my-t3code-squad\/roles\/security-specialist\.md/i,
      }),
    ).toBeInTheDocument();

    // 6. Confirma e aplica a sincronização a partir do Preview & Diff
    const confirmApplyBtn = screen.getByRole("button", {
      name: /Salvar & Sincronizar Projeto/i,
    });
    expect(confirmApplyBtn).not.toBeDisabled();
    await user.click(confirmApplyBtn);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/Sincronizado/i);
    });
    expect(screen.queryByText("Alterações não salvas")).not.toBeInTheDocument();
  });

  it("Jornada 3 (Estados vazios, erros de IPC e Importação Reversa de 'Squad s/ preset' no Studio)", async () => {
    const user = userEvent.setup();
    const store = new MockIpcStore();
    setLocationSearch("?view=studio");

    let failNextSave = false;
    vi.spyOn(ipcClient, "invokeIpc").mockImplementation(async (command, args) => {
      if (command === IPC_COMMANDS.saveGlobalPreset && failNextSave) {
        failNextSave = false;
        throw new Error("Falha simulada de disco ao gravar preset global");
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

    // 1. Simula erro de IPC ao salvar Preset Global -> exibe alerta claro sem perder rascunho
    const nameInput = screen.getByLabelText("Nome do Preset");
    await user.type(nameInput, " v2");
    failNextSave = true;

    await user.click(
      screen.getByRole("button", { name: "Salvar Preset Global" }),
    );

    const errorAlert = await screen.findByRole("alert");
    expect(errorAlert).toHaveTextContent(
      /Falha simulada de disco ao gravar preset global/i,
    );
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    // 2. Aciona "Importar Squad Existente" no projeto cabrito na sidebar (com rascunho sujo -> pede confirmação)
    const sidebar = screen.getByRole("complementary", {
      name: "Navegação de Presets e Projetos",
    });
    const importButtons = within(sidebar).getAllByRole("button", {
      name: /Importar Squad Existente/i,
    });
    // cabrito é o 2º projeto com squad na lista da sidebar (oh-my-t3code é o 1º)
    await user.click(importButtons[1]!);

    const discardDialog = await screen.findByRole("alertdialog");
    await user.click(
      within(discardDialog).getByRole("button", {
        name: "Descartar alterações e continuar",
      }),
    );

    // Após importar, cabrito é carregado no Studio com seu preset importado e status de sucesso
    expect(
      await screen.findByRole("heading", { level: 1, name: "cabrito" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /Squad importada de cabrito para .*\.t3code\/preset\.jsonc/i,
      );
    });
    expect(
      store.getProjectPreset(
        "proj-cabrito",
        "/Users/alencarfreire/Workspace/cabrito",
      ).hasLocalOverride,
    ).toBe(true);
  });
});
