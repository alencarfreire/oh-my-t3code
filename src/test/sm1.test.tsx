import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { invokeIpc } from "../lib/ipc-client";
import { IPC_COMMANDS } from "../types/ipc";

function setLocationSearch(search: string) {
  window.history.replaceState({}, "", search ? `/${search}` : "/");
}

describe("SM-1: Consistência entre Global Preset, settings.json e Studio", () => {
  it("SM1-BUG-1 (PopoverView): desabilita Swap Global ao pausar, limpa defaultModelSelection/fallbackModelSelection e reabilita ao reativar", async () => {
    const user = userEvent.setup();
    setLocationSearch("?view=popover");

    render(<App />);

    const globalCard = await screen.findByRole("region", {
      name: /Preset Global \(Default\)/i,
    });
    const globalToggle = within(globalCard).getByRole("button", {
      name: "Alternar status do Preset Global",
    });
    const swapButton = within(globalCard).getByRole("button", {
      name: "Inverter instância global",
    });

    expect(globalToggle).toHaveAttribute("aria-pressed", "true");
    expect(swapButton).not.toBeDisabled();
    expect(swapButton).toHaveAttribute(
      "title",
      "Alternar modelo global Codex (gpt-6.1-sol ⇄ gpt-6.1-terra)",
    );

    const initialSnap = await invokeIpc(IPC_COMMANDS.getDashboardSnapshot);
    expect(initialSnap.defaultModelSelection).toMatchObject({
      instanceId: "codex",
      model: "gpt-6.1-sol",
    });
    expect(initialSnap.fallbackModelSelection).toMatchObject({
      instanceId: "codex",
      model: "gpt-6.1-terra",
    });

    // Pausar Preset Global (Ativo -> Desativado)
    await user.click(globalToggle);
    await waitFor(() => {
      expect(globalToggle).toHaveAttribute("aria-pressed", "false");
    });

    expect(swapButton).toBeDisabled();
    expect(swapButton).toHaveAttribute(
      "title",
      "Ative o Preset Global para inverter a instância",
    );

    const pausedSnap = await invokeIpc(IPC_COMMANDS.getDashboardSnapshot);
    expect(pausedSnap.globalConfig.enabled).toBe(false);
    expect(pausedSnap.defaultModelSelection).toBeNull();
    expect(pausedSnap.fallbackModelSelection).toBeNull();

    // Backend / Mock IPC também bloqueia swap_global_instance quando desativado
    await expect(invokeIpc(IPC_COMMANDS.swapGlobalInstance)).rejects.toThrow(
      /desativado/i,
    );

    // Reativar Preset Global (Desativado -> Ativo)
    await user.click(globalToggle);
    await waitFor(() => {
      expect(globalToggle).toHaveAttribute("aria-pressed", "true");
    });

    expect(swapButton).not.toBeDisabled();
    expect(swapButton).toHaveAttribute(
      "title",
      "Alternar modelo global Codex (gpt-6.1-sol ⇄ gpt-6.1-terra)",
    );

    const resumedSnap = await invokeIpc(IPC_COMMANDS.getDashboardSnapshot);
    expect(resumedSnap.globalConfig.enabled).toBe(true);
    expect(resumedSnap.defaultModelSelection).toMatchObject({
      instanceId: "codex",
      model: "gpt-6.1-sol",
    });
    expect(resumedSnap.fallbackModelSelection).toMatchObject({
      instanceId: "codex",
      model: "gpt-6.1-terra",
    });
  });

  it("SM1-BUG-2 (StudioView): Salvar Preset Global no Global Default ativo sincroniza settings.json e alternar status mantém config.jsonc e presets/*.jsonc consistentes", async () => {
    const user = userEvent.setup();
    setLocationSearch("?view=studio");

    render(<App />);

    // Default Global ('default') é carregado inicialmente
    expect(
      await screen.findByRole("heading", { level: 1, name: "Default (OMOS Standard)" }),
    ).toBeInTheDocument();

    const globalToggle = screen.getByRole("button", {
      name: "Alternar status do Preset Global",
    });
    expect(globalToggle).toHaveAttribute("aria-pressed", "true");

    // 1. Alternar status quando limpo (!dirty) sincroniza config.jsonc + presets/<id>.jsonc
    await user.click(globalToggle);
    await waitFor(() => {
      expect(globalToggle).toHaveAttribute("aria-pressed", "false");
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Preset Global 'default' desativado.",
    );

    let snapAfterPause = await invokeIpc(IPC_COMMANDS.getDashboardSnapshot);
    expect(snapAfterPause.globalConfig.enabled).toBe(false);
    expect(snapAfterPause.defaultModelSelection).toBeNull();
    expect(
      snapAfterPause.globalPresets.find((p) => p.id === "default")?.enabled,
    ).toBe(false);

    // Reativar antes de editar e salvar
    await user.click(globalToggle);
    await waitFor(() => {
      expect(globalToggle).toHaveAttribute("aria-pressed", "true");
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Preset Global 'default' ativado e sincronizado.",
    );

    const snapAfterResume = await invokeIpc(IPC_COMMANDS.getDashboardSnapshot);
    expect(snapAfterResume.globalConfig.enabled).toBe(true);
    expect(
      snapAfterResume.globalPresets.find((p) => p.id === "default")?.enabled,
    ).toBe(true);

    // 2. Editar o Global Default ativo (modelo do orquestrador -> gpt-6.1-terra) e salvar
    const modelChips = screen.getAllByRole("button", { name: "gpt-6.1-terra" });
    await user.click(modelChips[0]);
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    // Se alternar status com rascunho dirty, preserva Alterações não salvas sem gravar rascunho em disco
    await user.click(globalToggle);
    await waitFor(() => {
      expect(globalToggle).toHaveAttribute("aria-pressed", "false");
    });
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    snapAfterPause = await invokeIpc(IPC_COMMANDS.getDashboardSnapshot);
    expect(
      snapAfterPause.globalPresets.find((p) => p.id === "default")?.orchestrator
        .model,
    ).toBe("gpt-6.1-sol");

    // Reativar e salvar definitivamente o Global Default editado
    await user.click(globalToggle);
    await waitFor(() => {
      expect(globalToggle).toHaveAttribute("aria-pressed", "true");
    });

    await user.click(
      screen.getByRole("button", { name: "Salvar Preset Global" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Preset global 'default' salvo e sincronizado com settings.json.",
      );
    });

    const syncedSnap = await invokeIpc(IPC_COMMANDS.getDashboardSnapshot);
    expect(syncedSnap.defaultModelSelection).toMatchObject({
      instanceId: "codex",
      model: "gpt-6.1-terra",
    });
    expect(
      syncedSnap.globalPresets.find((p) => p.id === "default")?.orchestrator.model,
    ).toBe("gpt-6.1-terra");
  });

  it("SM1-BUG-2 (StudioView): alinha enabled ao carregar preset global ativo pausado e salva sem mensagem de sync quando pausado", async () => {
    const user = userEvent.setup();
    await invokeIpc(IPC_COMMANDS.setGlobalPresetConfig, {
      activePresetId: "default",
      enabled: false,
    });
    setLocationSearch("?view=studio");

    render(<App />);

    const globalToggle = await screen.findByRole("button", {
      name: "Alternar status do Preset Global",
    });
    expect(globalToggle).toHaveAttribute("aria-pressed", "false");

    const nameInput = screen.getByLabelText("Nome do Preset");
    await user.clear(nameInput);
    await user.type(nameInput, "Default (Editado Pausado)");

    await user.click(
      screen.getByRole("button", { name: "Salvar Preset Global" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Preset global 'default' salvo com sucesso.",
      );
    });

    const snap = await invokeIpc(IPC_COMMANDS.getDashboardSnapshot);
    expect(snap.globalConfig.enabled).toBe(false);
    expect(snap.defaultModelSelection).toBeNull();
    expect(snap.globalPresets.find((p) => p.id === "default")?.enabled).toBe(false);
  });
});
