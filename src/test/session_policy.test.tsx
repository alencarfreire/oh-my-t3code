import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import * as ipcClient from "../lib/ipc-client";
import {
  createMockSessionHealthScenario,
  MockIpcStore,
} from "../lib/mock-data";
import {
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

describe("Gestão Inteligente de Sessão e Concorrência (Onda 2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PopoverView: exibe saúde global & RAM, estados OK / Pai gordo / ACP morto / Muitos workers e copia prompt de handoff", async () => {
    const store = new MockIpcStore();
    store.setProjectSessionHealth(
      "proj-oh-my-t3code",
      createMockSessionHealthScenario("fat_parent", "proj-oh-my-t3code"),
    );
    store.setProjectSessionHealth(
      "proj-cabrito",
      createMockSessionHealthScenario("acp_dead", "proj-cabrito"),
    );
    store.setProjectSessionHealth(
      "proj-dashboard-meta",
      createMockSessionHealthScenario("over_concurrency", "proj-dashboard-meta"),
    );
    // proj-landing-page remains "ok" (visible via ⌘K search)

    vi.spyOn(ipcClient, "invokeIpc").mockImplementation(async (command, args) =>
      dispatchMockCommand(store, command, args),
    );
    vi.spyOn(ipcClient, "listenSnapshotUpdated").mockResolvedValue(() => {});

    setLocationSearch("?view=popover");
    const user = userEvent.setup();

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    render(<App />);

    // Global session health & RAM banner
    const globalBanner = await screen.findByLabelText(
      "Saúde global da sessão e RAM",
    );
    expect(globalBanner).toHaveTextContent(/Agy\s*6\/2/);
    expect(globalBanner).toHaveTextContent(/7\/3\s*workers/);
    expect(globalBanner).toHaveTextContent(/Alerta de RAM \(8 GB\)/i);

    // Override project badges and formatted counts
    const overridesSection = screen.getByLabelText(/Projetos com Override/i);
    expect(within(overridesSection).getByText("Pai gordo")).toBeInTheDocument();
    expect(within(overridesSection).getByText("ACP morto")).toBeInTheDocument();
    expect(
      within(overridesSection).getByText("Muitos workers"),
    ).toBeInTheDocument();

    expect(
      within(overridesSection).getByText("Agy 2/2 · pai 18 turns · 830 itens"),
    ).toBeInTheDocument();
    expect(
      within(overridesSection).getByText(/AcpRequestError.*6 ms/),
    ).toBeInTheDocument();
    expect(
      within(overridesSection).getByText(/Alerta de RAM \(8 GB\):/),
    ).toBeInTheDocument();

    // Search unconfigured project to assert OK badge
    await user.keyboard("{Meta>}k{/Meta}");
    const searchInput = screen.getByPlaceholderText(/Filtrar projetos/i);
    await user.type(searchInput, "landing");
    const unconfiguredSection = screen.getByLabelText(
      "Projetos seguindo Global Default",
    );
    expect(within(unconfiguredSection).getByText("OK")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    // Click "Abrir thread pai novo" on cabrito (acp_dead) -> copies handoff prompt
    const copyButton = screen.getByRole("button", {
      name: "Abrir thread pai novo (cabrito)",
    });
    await user.click(copyButton);

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    const copiedPrompt = writeTextMock.mock.calls[0][0] as string;
    expect(copiedPrompt).toContain("# Handoff de Sessão — cabrito");
    expect(copiedPrompt).toContain("ACP morto");
    expect(copiedPrompt).toContain("AcpRequestError");
    expect(copiedPrompt).toContain("ai-memory");
    expect(copiedPrompt).toContain("memory_handoff_accept");

    expect(screen.getByRole("status")).toHaveTextContent(
      "Prompt de handoff copiado para a área de transferência — abra um thread pai novo no T3 Code.",
    );
    expect(copyButton).toHaveTextContent("Handoff copiado!");
  });

  it("PopoverView: usa fallback execCommand quando navigator.clipboard.writeText falha", async () => {
    const store = new MockIpcStore();
    store.setProjectSessionHealth(
      "proj-oh-my-t3code",
      createMockSessionHealthScenario("fat_parent", "proj-oh-my-t3code"),
    );

    vi.spyOn(ipcClient, "invokeIpc").mockImplementation(async (command, args) =>
      dispatchMockCommand(store, command, args),
    );
    vi.spyOn(ipcClient, "listenSnapshotUpdated").mockResolvedValue(() => {});

    setLocationSearch("?view=popover");
    const user = userEvent.setup();

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("Clipboard denied")),
      },
    });
    const execCommandMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommandMock,
    });

    render(<App />);

    const copyBtn = await screen.findByRole("button", {
      name: "Abrir thread pai novo (oh-my-t3code)",
    });
    await user.click(copyBtn);

    expect(execCommandMock).toHaveBeenCalledWith("copy");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Prompt de handoff copiado para a área de transferência — abra um thread pai novo no T3 Code.",
    );
  });

  it("StudioView / ContentionTab: edita sessionPolicy, exibe aviso laptop-8gb, respeita dirty guard e reflete no Preview & Diff do SKILL.md", async () => {
    const store = new MockIpcStore();
    vi.spyOn(ipcClient, "invokeIpc").mockImplementation(async (command, args) =>
      dispatchMockCommand(store, command, args),
    );
    vi.spyOn(ipcClient, "listenStudioNavigate").mockResolvedValue(() => {});
    vi.spyOn(ipcClient, "listenSnapshotUpdated").mockResolvedValue(() => {});

    setLocationSearch("?view=studio");
    const user = userEvent.setup();
    render(<App />);

    // Open Pontos de Contenção tab
    const contentionTab = await screen.findByRole("tab", {
      name: /Pontos de Contenção/i,
    });
    await user.click(contentionTab);

    expect(
      screen.getByRole("heading", { name: /Sessão e hardware/i }),
    ).toBeInTheDocument();

    // 1. Check laptop-8gb + parentThinkingLevel="high" downgrade warning
    const hardwareSelect = screen.getByLabelText(/Perfil de Hardware/i);
    const parentThinkingSelect = screen.getByLabelText(
      /Thinking do Thread Pai/i,
    );
    expect(hardwareSelect).toHaveValue("laptop-8gb");
    await user.selectOptions(parentThinkingSelect, "high");
    expect(
      screen.getByText(/o compilador rebaixa automaticamente o thinking efetivo/i),
    ).toBeInTheDocument();

    // 2. Switch hardwareProfile to desktop-16gb and edit all concurrency & budget fields
    await user.selectOptions(hardwareSelect, "desktop-16gb");
    expect(
      screen.queryByText(/o compilador rebaixa automaticamente o thinking efetivo/i),
    ).not.toBeInTheDocument();

    const maxAgyInput = screen.getByLabelText("Máx. Workers Antigravity");
    await user.clear(maxAgyInput);
    await user.type(maxAgyInput, "3");

    const maxTotalInput = screen.getByLabelText("Máx. Total de Workers");
    await user.clear(maxTotalInput);
    await user.type(maxTotalInput, "4");

    const maxTurnsInput = screen.getByLabelText("Máx. Turns do Pai (Handoff)");
    await user.clear(maxTurnsInput);
    await user.type(maxTurnsInput, "20");

    const maxItemsInput = screen.getByLabelText("Máx. Itens do Pai (Handoff)");
    await user.clear(maxItemsInput);
    await user.type(maxItemsInput, "160");

    const warnTokensInput = screen.getByLabelText("Alerta de Input Tokens");
    await user.clear(warnTokensInput);
    await user.type(warnTokensInput, "250000");

    const hardTokensInput = screen.getByLabelText(
      "Limite Rígido de Input Tokens",
    );
    await user.clear(hardTokensInput);
    await user.type(hardTokensInput, "800000");

    await user.selectOptions(
      screen.getByLabelText(/Modo de Delegação/i),
      "adaptive",
    );
    await user.selectOptions(
      screen.getByLabelText(/Recuperação ACP Morto/i),
      "fallback-codex",
    );

    // 3. Edit workerThinkingByKind: update frontend, add security, remove research
    await user.selectOptions(
      screen.getByLabelText("Thinking para frontend"),
      "high",
    );
    await user.selectOptions(
      screen.getByLabelText("Modelo para frontend"),
      "gemini-4-argon",
    );

    await user.type(screen.getByLabelText("Novo tipo de worker"), "security");
    await user.selectOptions(
      screen.getByLabelText("Modelo do novo tipo"),
      "gpt-6.1-sol",
    );
    await user.selectOptions(
      screen.getByLabelText("Thinking do novo tipo"),
      "xhigh",
    );
    await user.click(screen.getByRole("button", { name: "Adicionar tipo" }));

    expect(screen.getByLabelText("Modelo para security")).toHaveValue(
      "gpt-6.1-sol",
    );
    expect(screen.getByLabelText("Thinking para security")).toHaveValue(
      "xhigh",
    );

    await user.click(
      screen.getByRole("button", { name: "Remover tipo research" }),
    );
    expect(
      screen.queryByLabelText("Modelo para research"),
    ).not.toBeInTheDocument();

    // 4. Edit forbiddenPatterns via StringListEditor
    const forbiddenInput = screen.getByLabelText(
      /Padrões Proibidos \(forbiddenPatterns\)/i,
    );
    await user.type(forbiddenInput, "polling em loop{Enter}");
    expect(screen.getByText("polling em loop")).toBeInTheDocument();

    // Verify dirty badge & SM-5 guard before switching away
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    // Attempt to switch preset in sidebar triggers SM-5 dirty dialog
    await user.click(screen.getByRole("button", { name: /Codex Squad/i }));
    const dirtyDialog = await screen.findByRole("alertdialog");
    expect(dirtyDialog).toHaveTextContent("Alterações não salvas");
    await user.click(
      within(dirtyDialog).getByRole("button", { name: "Continuar editando" }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    // 5. Switch to Preview & Diff and verify compiled SKILL.md reflects sessionPolicy BEFORE saving
    await user.click(screen.getByRole("tab", { name: /Preview & Diff/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: /\.agents\/skills\/oh-my-t3code-squad\/SKILL\.md/i,
        }),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", {
        name: /\.agents\/skills\/oh-my-t3code-squad\/SKILL\.md/i,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: /Markdown Compilado/i }),
    );

    const compiledPre = await screen.findByText(
      /## 5\. Gestão de sessão e concorrência \(oh-my-t3code\)/,
    );
    expect(compiledPre.textContent).toContain("`desktop-16gb`");
    expect(compiledPre.textContent).toContain("`3` worker(s)");
    expect(compiledPre.textContent).toContain("`4` worker(s)");
    expect(compiledPre.textContent).toContain("`20` turns ou `160` itens");
    expect(compiledPre.textContent).toContain(
      "aviso em `250000` / handoff obrigatório em `800000`",
    );
    expect(compiledPre.textContent).toContain("`adaptive`");
    expect(compiledPre.textContent).toContain("`fallback-codex`");
    expect(compiledPre.textContent).toContain(
      "| `security` | `gpt-6.1-sol` | `xhigh` |",
    );
    expect(compiledPre.textContent).toContain(
      "| `frontend` | `gemini-4-argon` | `high` |",
    );
    expect(compiledPre.textContent).not.toContain("| `research` |");
    expect(compiledPre.textContent).toContain("- `polling em loop`");
  });
});
