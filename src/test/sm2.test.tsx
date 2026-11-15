import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import * as ipcClient from "../lib/ipc-client";
import { MockIpcStore } from "../lib/mock-data";
import { clonePreset, createEmptyPreset } from "../lib/preset-utils";
import { IPC_COMMANDS } from "../types/ipc";

function setLocationSearch(search: string) {
  window.history.replaceState({}, "", search ? `/${search}` : "/");
}

describe("SM-2: Override por Projeto, Prune de roles/*.md, Limpeza e Tombstone de Herança", () => {
  it("SM2-BUG-1 (PopoverView): pausar override desabilita botão Swap do projeto, impede chamada de swap_project_instance e reabilita ao reativar", async () => {
    const user = userEvent.setup();
    const invokeSpy = vi.spyOn(ipcClient, "invokeIpc");
    setLocationSearch("?view=popover");

    render(<App />);

    const projectToggle = await screen.findByRole("button", {
      name: "Alternar preset de oh-my-t3code",
    });
    const projectCard = projectToggle.closest("li");
    expect(projectCard).not.toBeNull();

    const swapButton = within(projectCard!).getByRole("button", {
      name: "Alternar instância Agy em oh-my-t3code",
    });

    expect(projectToggle).toHaveAttribute("aria-pressed", "true");
    expect(swapButton).not.toBeDisabled();
    expect(swapButton).toHaveAttribute(
      "title",
      "Alternar Agy Veca ⇄ Agy Principal (1 clique)",
    );

    // Pausar override do projeto
    await user.click(projectToggle);
    await waitFor(() => {
      expect(projectToggle).toHaveAttribute("aria-pressed", "false");
    });

    expect(swapButton).toBeDisabled();
    expect(swapButton).toHaveClass("disabled:cursor-not-allowed");
    expect(swapButton).toHaveAttribute(
      "title",
      "Ative o override do projeto para inverter a instância",
    );

    invokeSpy.mockClear();
    await user.click(swapButton);
    expect(
      invokeSpy.mock.calls.filter(
        ([cmd]) => cmd === IPC_COMMANDS.swapProjectInstance,
      ),
    ).toHaveLength(0);

    // Backend / Mock IPC também rejeita swap_project_instance com override pausado
    await expect(
      ipcClient.invokeIpc(IPC_COMMANDS.swapProjectInstance, {
        projectId: "proj-oh-my-t3code",
        workspaceRoot: "/Users/alencarfreire/.t3/projects/oh-my-t3code",
      }),
    ).rejects.toThrow(/pausado/i);

    // Reativar override do projeto restaura o botão Swap
    await user.click(projectToggle);
    await waitFor(() => {
      expect(projectToggle).toHaveAttribute("aria-pressed", "true");
    });
    expect(swapButton).not.toBeDisabled();
    expect(swapButton).toHaveAttribute(
      "title",
      "Alternar Agy Veca ⇄ Agy Principal (1 clique)",
    );

    invokeSpy.mockRestore();
  });

  it("SM2-BUG-4 (StudioView / RolesMatrixTab): deletar papel herdado qa-reviewer de preset com extends='agy-dual' persiste em disabledRoles após salvar/recarregar e sai de disabledRoles ao readicionar", async () => {
    const user = userEvent.setup();
    setLocationSearch("?view=studio");

    const { unmount } = render(<App />);

    // Criar novo preset global herdando de agy-dual
    const newPresetBtn = await screen.findByRole("button", {
      name: "Novo Preset Global",
    });
    await user.click(newPresetBtn);

    await user.type(
      screen.getByLabelText(/ID do Preset/i),
      "agy-derived-sm2",
    );
    await user.selectOptions(
      screen.getByLabelText(/Herdar de/i),
      "agy-dual",
    );
    await user.click(screen.getByRole("button", { name: "Criar" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "agy-derived-sm2" }),
    ).toBeInTheDocument();

    // Ir para a aba Matriz de Papéis e remover o papel herdado qa-reviewer
    await user.click(screen.getByRole("tab", { name: /Matriz de Papéis/i }));

    const qaRoleCard = await screen.findByRole("button", {
      name: /QA \/ Security Reviewer/i,
    });
    await user.click(qaRoleCard);
    await user.click(screen.getByRole("button", { name: "Remover Papel" }));

    expect(
      screen.queryByRole("button", { name: /QA \/ Security Reviewer/i }),
    ).not.toBeInTheDocument();

    // Salvar Preset Global
    await user.click(
      screen.getByRole("button", { name: "Salvar Preset Global" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Preset global 'agy-derived-sm2' salvo com sucesso.",
      );
    });

    // Verificar no snapshot que qa-reviewer está ausente e listado em disabledRoles
    const savedSnap = await ipcClient.invokeIpc(
      IPC_COMMANDS.getDashboardSnapshot,
    );
    const savedPreset = savedSnap.globalPresets.find(
      (p) => p.id === "agy-derived-sm2",
    );
    expect(savedPreset).toBeDefined();
    expect(savedPreset?.extends).toBe("agy-dual");
    expect(savedPreset?.roles["qa-reviewer"]).toBeUndefined();
    expect(savedPreset?.disabledRoles).toEqual(["qa-reviewer"]);

    // Simular reload do Studio selecionando novamente o preset salvo
    unmount();
    setLocationSearch("?view=studio&presetId=agy-derived-sm2");
    render(<App />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "agy-derived-sm2" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Matriz de Papéis/i }));
    expect(
      screen.queryByRole("button", { name: /QA \/ Security Reviewer/i }),
    ).not.toBeInTheDocument();

    // Readicionar qa-reviewer via Adicionar Papel (handleAddRole)
    await user.click(screen.getByRole("button", { name: "Adicionar Papel" }));
    await user.click(screen.getByRole("button", { name: "+ qa-reviewer" }));

    expect(
      await screen.findByRole("button", { name: /QA \/ Security Reviewer/i }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Salvar Preset Global" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Preset global 'agy-derived-sm2' salvo com sucesso.",
      );
    });

    const reloadedSnap = await ipcClient.invokeIpc(
      IPC_COMMANDS.getDashboardSnapshot,
    );
    const restoredPreset = reloadedSnap.globalPresets.find(
      (p) => p.id === "agy-derived-sm2",
    );
    expect(restoredPreset?.roles["qa-reviewer"]).toBeDefined();
    expect(restoredPreset?.disabledRoles).toBeUndefined();
  });

  it("MockIpcStore & preset-utils: paridade SM-2 (prune roles/*.md, applyPresetSync pausado, remoção seletiva de squad e clonePreset)", () => {
    const empty = createEmptyPreset("custom-sm2", "agy-dual", [
      "qa-reviewer",
      "explorer",
      "qa-reviewer",
    ]);
    expect(empty.disabledRoles).toEqual(["explorer", "qa-reviewer"]);

    const cloned = clonePreset({
      ...empty,
      disabledRoles: ["qa-reviewer", "explorer", "qa-reviewer"],
    });
    expect(cloned.disabledRoles).toEqual(["explorer", "qa-reviewer"]);
    expect(cloned.disabledRoles).not.toBe(empty.disabledRoles);

    const cleanCloned = clonePreset({ ...empty, disabledRoles: [] });
    expect(cleanCloned.disabledRoles).toBeUndefined();

    const store = new MockIpcStore();
    const ohMyRoot = "/Users/alencarfreire/.t3/projects/oh-my-t3code";

    // 1. Prune de roles/*.md obsoletos ao aplicar preset com papel suprimido
    const baseAgy = store
      .listGlobalPresets()
      .find((p) => p.id === "agy-dual")!;
    const derivedOverride = {
      ...clonePreset(baseAgy),
      id: "oh-my-t3code",
      extends: "agy-dual",
      disabledRoles: ["qa-reviewer"],
    };
    delete derivedOverride.roles["qa-reviewer"];

    store.applyPresetSync("proj-oh-my-t3code", ohMyRoot, null, derivedOverride);
    expect(store.getCompiledFilePaths()).not.toContain(
      `${ohMyRoot}/.agents/skills/oh-my-t3code-squad/roles/qa-reviewer.md`,
    );
    expect(store.getCompiledFilePaths()).toContain(
      `${ohMyRoot}/.agents/skills/oh-my-t3code-squad/roles/fixer.md`,
    );

    // 2. applyPresetSync com enabled=false não mantém override ativo em settings e mantém presetEnabled=false
    const pausedSync = store.applyPresetSync("proj-oh-my-t3code", ohMyRoot, null, {
      ...derivedOverride,
      enabled: false,
    });
    expect(pausedSync.presetId).toBe("oh-my-t3code");
    expect(store.hasProjectSettingsOverride("proj-oh-my-t3code")).toBe(false);
    const snapPaused = store.getDashboardSnapshot();
    const ohMySummary = snapPaused.projects.find(
      (p) => p.projectId === "proj-oh-my-t3code",
    );
    expect(ohMySummary?.presetEnabled).toBe(false);
    expect(() =>
      store.swapProjectInstance("proj-oh-my-t3code", ohMyRoot),
    ).toThrow(/pausado/i);

    // 3. removeProjectOverride limpa squad gerada pelo compilador, mas preserva squads manuais
    store.removeProjectOverride("proj-oh-my-t3code", ohMyRoot);
    expect(
      store
        .getCompiledFilePaths()
        .filter((p) => p.startsWith(`${ohMyRoot}/.agents/skills/oh-my-t3code-squad/`)),
    ).toHaveLength(0);

    const cabritoRoot = "/Users/alencarfreire/Workspace/cabrito";
    const afterCabritoRemove = store.removeProjectOverride(
      "proj-cabrito",
      cabritoRoot,
    );
    expect(store.getCompiledFilePaths()).toContain(
      `${cabritoRoot}/.agents/skills/cabrito-squad/SKILL.md`,
    );
    const cabritoSummary = afterCabritoRemove.projects.find(
      (p) => p.projectId === "proj-cabrito",
    );
    expect(cabritoSummary?.detectedSquadSlug).toBe("cabrito-squad");
  });
});
