import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { subscribeMockPopoverToggle } from "../lib/ipc-client";

function setLocationSearch(search: string) {
  window.history.replaceState({}, "", search ? `/${search}` : "/");
}

describe("Oh My T3Code — Popover & Preset Studio", () => {
  describe("Menu Bar Popover View", () => {
    it("renders featured Global Default card, strictly filters Override projects (hiding landing-page), supports toggles, + Configurar Projeto, sync, swap, and Escape close", async () => {
      const user = userEvent.setup();
      setLocationSearch("?view=popover");

      const onTogglePopover = vi.fn();
      const unsub = subscribeMockPopoverToggle(onTogglePopover);

      render(<App />);

      // Header logo & summary (no subagent monitor)
      expect(await screen.findByText("Oh My T3Code")).toBeInTheDocument();
      expect(screen.getByAltText("Oh My T3Code")).toHaveAttribute("src", "/logo.png");
      expect(screen.getByText("Global Ativo · 3 overrides · 4 presets")).toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: /Subagentes/i }),
      ).not.toBeInTheDocument();

      // 1. Featured Global Default Card at the top ('default' OMOS Standard active initially)
      const globalCard = screen.getByRole("region", {
        name: /Preset Global \(Default\)/i,
      });
      const globalToggle = within(globalCard).getByRole("button", {
        name: "Alternar status do Preset Global",
      });
      expect(globalToggle).toHaveAttribute("aria-pressed", "true");
      expect(within(globalCard).getByText("Ativo")).toBeInTheDocument();
      expect(within(globalCard).getByText("Instalado por padrão")).toBeInTheDocument();

      const globalSelect = within(globalCard).getByLabelText("Preset Global Default") as HTMLSelectElement;
      expect(globalSelect).toHaveValue("default");
      expect(globalSelect.options[0].value).toBe("default");

      // Toggle Global Default off and back on
      await user.click(globalToggle);
      await waitFor(() => {
        expect(globalToggle).toHaveAttribute("aria-pressed", "false");
      });
      expect(within(globalCard).getByText("Desativado")).toBeInTheDocument();

      await user.click(globalToggle);
      await waitFor(() => {
        expect(globalToggle).toHaveAttribute("aria-pressed", "true");
      });

      // Swap Global Model on 'default' preset (Codex · gpt-6.1-sol -> Codex · gpt-6.1-terra)
      const globalSwapBtn = within(globalCard).getByRole("button", {
        name: "Inverter instância global",
      });
      expect(globalSwapBtn).toHaveTextContent("Codex · gpt-6.1-sol");
      await user.click(globalSwapBtn);
      await waitFor(() => {
        expect(
          within(globalCard).getByRole("button", { name: "Inverter instância global" }),
        ).toHaveTextContent("Codex · gpt-6.1-terra");
      });

      // Switch Global Preset Default select to agy-dual and swap Agy Principal -> Agy Veca
      await user.selectOptions(globalSelect, "agy-dual");
      await waitFor(() => {
        expect(
          within(globalCard).getByRole("button", { name: "Inverter instância global" }),
        ).toHaveTextContent("Agy Principal");
      });
      await user.click(
        within(globalCard).getByRole("button", { name: "Inverter instância global" }),
      );
      await waitFor(() => {
        expect(
          within(globalCard).getByRole("button", { name: "Inverter instância global" }),
        ).toHaveTextContent("Agy Veca");
      });

      // Switch across codex-squad, hybrid-agy-codex, and back to default
      await user.selectOptions(globalSelect, "codex-squad");
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(
          /Preset Global Default alterado para codex-squad/i,
        );
      });
      await user.selectOptions(globalSelect, "hybrid-agy-codex");
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(
          /Preset Global Default alterado para hybrid-agy-codex/i,
        );
      });
      await user.selectOptions(globalSelect, "default");
      await waitFor(() => {
        expect(within(globalCard).getByText("Instalado por padrão")).toBeInTheDocument();
      });

      // 2. Strict "Projetos com Override (3)" section: excludes landing-page
      const projectsSection = screen.getByRole("region", {
        name: /Projetos com Override/i,
      });
      expect(within(projectsSection).getByText("(3)")).toBeInTheDocument();
      expect(within(projectsSection).getByText("oh-my-t3code")).toBeInTheDocument();
      expect(within(projectsSection).getByText("cabrito")).toBeInTheDocument();
      expect(within(projectsSection).getByText("dashboard-meta")).toBeInTheDocument();
      expect(
        within(projectsSection).queryByText("landing-page"),
      ).not.toBeInTheDocument();

      // Toggle override of oh-my-t3code off -> shows "Seguindo Global Default (override pausado)"
      const ohMyToggle = within(projectsSection).getByRole("button", {
        name: "Alternar preset de oh-my-t3code",
      });
      expect(ohMyToggle).toHaveAttribute("aria-pressed", "true");
      await user.click(ohMyToggle);
      await waitFor(() => {
        expect(
          within(projectsSection).getByText(
            "Seguindo Global Default (override pausado)",
          ),
        ).toBeInTheDocument();
      });
      expect(ohMyToggle).toHaveAttribute("aria-pressed", "false");

      // Re-enable oh-my-t3code override
      await user.click(ohMyToggle);
      await waitFor(() => {
        expect(ohMyToggle).toHaveAttribute("aria-pressed", "true");
      });

      // 3. "+ Configurar Projeto" assigns an override to landing-page
      await user.click(
        within(projectsSection).getByRole("button", { name: /Configurar Projeto/i }),
      );
      const unconfiguredSelect = within(projectsSection).getByLabelText(
        "Selecionar projeto para configurar",
      );
      expect(unconfiguredSelect).toHaveValue("proj-landing-page");
      await user.selectOptions(
        within(projectsSection).getByLabelText("Selecionar preset para override"),
        "codex-squad",
      );
      await user.click(
        within(projectsSection).getByRole("button", { name: "Aplicar Override" }),
      );

      await waitFor(() => {
        expect(within(projectsSection).getByText("landing-page")).toBeInTheDocument();
      });
      expect(within(projectsSection).getByText("(4)")).toBeInTheDocument();

      // Filter overrides quickly and clear filter
      const filterInput = screen.getByLabelText("Filtrar projetos");
      await user.type(filterInput, "cabrito");
      expect(within(projectsSection).getByText("cabrito")).toBeInTheDocument();
      expect(
        within(projectsSection).queryByText("oh-my-t3code"),
      ).not.toBeInTheDocument();
      expect(
        within(projectsSection).queryByText("dashboard-meta"),
      ).not.toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: "Limpar filtro de projetos" }),
      );
      expect(within(projectsSection).getByText("oh-my-t3code")).toBeInTheDocument();

      // Change preset dropdown for cabrito and click Sync
      const cabritoSelect = screen.getByLabelText("Preset para cabrito");
      await user.selectOptions(cabritoSelect, "codex-squad");
      expect(cabritoSelect).toHaveValue("codex-squad");

      const syncBtn = screen.getByRole("button", { name: "Sync cabrito" });
      await user.click(syncBtn);

      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(
          /Sincronizado! cabrito atualizado com codex-squad/i,
        );
      });
      expect(screen.getByText("Sincronizado!")).toBeInTheDocument();

      // Click 1-click Swap Instance button on oh-my-t3code (Agy) and dashboard-meta (Codex)
      const swapBtn = screen.getByRole("button", {
        name: "Alternar instância Agy em oh-my-t3code",
      });
      await user.click(swapBtn);

      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(
          /Instância alternada em oh-my-t3code: Agy Veca/i,
        );
      });

      const codexSwapBtn = screen.getByRole("button", {
        name: "Alternar modelo Codex em dashboard-meta",
      });
      await user.click(codexSwapBtn);
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(
          /Modelo alternado em dashboard-meta: Codex \(gpt-6\.1-terra\)/i,
        );
      });

      // Press Escape to toggle/hide popover window
      await user.keyboard("{Escape}");
      expect(onTogglePopover).toHaveBeenCalledTimes(1);

      unsub();
    });
  });

  describe("Preset Studio View", () => {
    it("highlights Default Global, filters Projetos com Override, supports + Configurar Projeto, Remove Override, role templates, and Unified Diff preview", async () => {
      const user = userEvent.setup();
      setLocationSearch("?view=studio");

      render(<App />);

      // Sidebar renders logo, Global Presets with Default (OMOS Standard) first & highlighted, and ONLY override projects
      const sidebar = await screen.findByRole("complementary", {
        name: "Navegação de Presets e Projetos",
      });
      expect(within(sidebar).getByAltText("Oh My T3Code")).toHaveAttribute(
        "src",
        "/logo.png",
      );
      const globalPresetsSection = within(sidebar).getByRole("region", {
        name: /Presets Globais/i,
      });
      const presetItems = within(globalPresetsSection).getAllByRole("listitem");
      expect(presetItems).toHaveLength(4);
      expect(presetItems[0]).toHaveTextContent("Default (OMOS Standard)");
      expect(presetItems[0]).toHaveTextContent("Default · Ativo");
      expect(presetItems[0]).toHaveTextContent("Instalado por padrão");
      expect(presetItems[0]).toHaveTextContent("OMOS Standard");

      expect(
        within(sidebar).getByText("Agy Dual (Veca + Principal)"),
      ).toBeInTheDocument();
      expect(within(sidebar).getByText("Codex Squad (Sol + Terra)")).toBeInTheDocument();
      expect(within(sidebar).getByText("Hybrid (Agy + Codex)")).toBeInTheDocument();
      expect(within(sidebar).getByText("cabrito")).toBeInTheDocument();
      expect(within(sidebar).getByText("oh-my-t3code")).toBeInTheDocument();

      // landing-page (hasCustomOverride: false) is NOT in the sidebar override list
      const sidebarProjectsSection = within(sidebar).getByRole("region", {
        name: /Projetos com Override/i,
      });
      expect(
        within(sidebarProjectsSection).queryByText("landing-page"),
      ).not.toBeInTheDocument();

      // Use "+ Configurar Projeto" in sidebar to configure landing-page, then remove its override
      await user.click(
        within(sidebarProjectsSection).getByRole("button", {
          name: /Configurar Projeto/i,
        }),
      );
      expect(
        within(sidebarProjectsSection).getByLabelText("Selecionar projeto sem override"),
      ).toHaveValue("proj-landing-page");
      await user.click(
        within(sidebarProjectsSection).getByRole("button", { name: "Criar Override" }),
      );

      await waitFor(() => {
        expect(
          screen.getByRole("heading", { level: 1, name: "landing-page" }),
        ).toBeInTheDocument();
      });
      expect(
        within(sidebarProjectsSection).getByText("landing-page"),
      ).toBeInTheDocument();

      // Remove override to return landing-page to Global Default
      await user.click(
        screen.getByRole("button", {
          name: /Voltar ao Global \(Remover Override\)/i,
        }),
      );
      await waitFor(() => {
        expect(
          within(sidebarProjectsSection).queryByText("landing-page"),
        ).not.toBeInTheDocument();
      });

      // Switch to project 'cabrito' and toggle Active/Disabled in Studio Header
      await user.click(
        within(sidebarProjectsSection).getByRole("button", { name: /cabrito/i }),
      );
      await waitFor(() => {
        expect(
          screen.getByRole("heading", { level: 1, name: "cabrito" }),
        ).toBeInTheDocument();
      });

      const cabritoHeaderToggle = screen.getByRole("button", {
        name: "Alternar preset de cabrito",
      });
      expect(cabritoHeaderToggle).toHaveAttribute("aria-pressed", "true");
      await user.click(cabritoHeaderToggle);
      await waitFor(() => {
        expect(cabritoHeaderToggle).toHaveAttribute("aria-pressed", "false");
      });
      await user.click(cabritoHeaderToggle);
      await waitFor(() => {
        expect(cabritoHeaderToggle).toHaveAttribute("aria-pressed", "true");
      });

      // Navigate to Matriz de Papéis tab and add 'rust-core' role
      const rolesTab = screen.getByRole("tab", { name: /Matriz de Papéis/i });
      await user.click(rolesTab);
      expect(rolesTab).toHaveAttribute("aria-selected", "true");

      await user.click(screen.getByRole("button", { name: /Adicionar Papel/i }));
      const roleInput = screen.getByLabelText("ID do Novo Papel");
      await user.type(roleInput, "rust-core");
      await user.click(screen.getByRole("button", { name: "Criar" }));

      expect(
        screen.getByRole("heading", { level: 4, name: "Rust Core" }),
      ).toBeInTheDocument();

      // Navigate to Skills & MCPs tab, filter skills, and toggle a skill
      const skillsTab = screen.getByRole("tab", { name: /Skills & MCPs/i });
      await user.click(skillsTab);

      const skillSearch = screen.getByLabelText(
        "Buscar skills por nome ou descrição",
      );
      await user.type(skillSearch, "security-audit");

      const securityCheckbox = screen.getByRole("checkbox", {
        name: /security-audit/i,
      });
      expect(securityCheckbox).not.toBeChecked();
      await user.click(securityCheckbox);
      expect(securityCheckbox).toBeChecked();

      // Navigate to Contention tab and toggle singleTestDb
      await user.click(
        screen.getByRole("tab", { name: /Pontos de Contenção/i }),
      );
      const singleDbCheckbox = screen.getByRole("checkbox", {
        name: /Banco de Testes Único/i,
      });
      await user.click(singleDbCheckbox);
      expect(singleDbCheckbox).toBeChecked();

      // Navigate to Preview & Diff tab and verify compiled files + diff + sync
      await user.click(screen.getByRole("tab", { name: /Preview & Diff/i }));

      await waitFor(() => {
        expect(
          screen.getByRole("button", {
            name: /\.agents\/skills\/cabrito-squad\/SKILL\.md/i,
          }),
        ).toBeInTheDocument();
      });

      await user.click(
        screen.getByRole("button", {
          name: /\.agents\/skills\/cabrito-squad\/SKILL\.md/i,
        }),
      );
      expect(screen.getByRole("region", { name: "Unified Diff" })).toHaveTextContent(
        /\+\+\+ b\/\.agents\/skills\/cabrito-squad\/SKILL\.md/,
      );

      await user.click(
        screen.getByRole("button", { name: /Markdown Compilado/i }),
      );
      expect(
        screen.getByText(/# cabrito Squad — Playbook do Orquestrador/i),
      ).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: /Salvar & Sincronizar Projeto/i }),
      );
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(/Sincronizado!/i);
      });
    });

    it("supports canonical oh-my-opencode-slim role templates, Set as Global Default, 1-click model/thinking_level pills, and selected-skills filter", async () => {
      const user = userEvent.setup();
      setLocationSearch("?view=studio");

      render(<App />);

      // Wait for Studio header architecture summary strip (5 canonical roles)
      expect(await screen.findByText(/Topologia: Intra-Thread/i)).toBeInTheDocument();
      expect(screen.getByText(/Fallback: 3 níveis/i)).toBeInTheDocument();
      expect(screen.getByText(/Papéis: 5/i)).toBeInTheDocument();

      // Create an empty global preset to verify oh-my-opencode-slim role templates appear
      const sidebar = screen.getByRole("complementary", {
        name: "Navegação de Presets e Projetos",
      });
      await user.click(
        within(sidebar).getByRole("button", { name: /Novo Preset Global/i }),
      );
      await user.type(
        within(sidebar).getByLabelText(/ID do Preset/i),
        "slim-custom",
      );
      await user.selectOptions(
        within(sidebar).getByLabelText(/Herdar de/i),
        "",
      );
      await user.click(within(sidebar).getByRole("button", { name: "Criar" }));

      // Switch to Matriz de Papéis and verify canonical templates
      await user.click(screen.getByRole("tab", { name: /Matriz de Papéis/i }));
      await user.click(screen.getByRole("button", { name: /Adicionar Papel/i }));
      expect(screen.getByRole("button", { name: "+ explorer" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ oracle" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ designer" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ fixer" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ qa-reviewer" })).toBeInTheDocument();

      // Add designer role via 1-click template and test model/options pills
      await user.click(screen.getByRole("button", { name: "+ designer" }));
      expect(
        screen.getByRole("heading", { level: 4, name: "Designer" }),
      ).toBeInTheDocument();

      // Set this new preset as Global Default
      await user.click(
        screen.getByRole("button", { name: /Definir como Global Default/i }),
      );
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(
          /definido como Global Default/i,
        );
      });

      // 1-click thinking_level pill: click xhigh for active role
      const roleOptionsGroup = screen.getByRole("group", {
        name: /thinking_level para/i,
      });
      const xhighBtn = within(roleOptionsGroup).getByRole("button", {
        name: "xhigh",
      });
      await user.click(xhighBtn);
      expect(xhighBtn).toHaveAttribute("aria-pressed", "true");

      // Switch role instance to Codex via 1-click chip and verify reasoningEffort & serviceTier pills appear
      await user.click(screen.getByRole("button", { name: "Codex" }));
      expect(
        screen.getByRole("group", { name: /reasoningEffort para Codex/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("group", { name: /serviceTier para Codex/i }),
      ).toBeInTheDocument();

      // Switch to Skills & MCPs tab and test "Apenas Selecionadas" filter
      await user.click(screen.getByRole("tab", { name: /Skills & MCPs/i }));
      await user.click(
        screen.getByRole("button", { name: /Apenas Selecionadas/i }),
      );
      expect(
        screen.getByRole("checkbox", { name: /tailwind-v4-design/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("checkbox", { name: /rails-8-modern/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("Popover UX details", () => {
    it("displays semantic status pills, SQLite Read-Only footer, and focuses filter on Cmd+K", async () => {
      const user = userEvent.setup();
      setLocationSearch("?view=popover");

      render(<App />);

      expect(await screen.findByText("SQLite Read-Only")).toBeInTheDocument();
      expect(screen.getAllByText("Sincronizado").length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("Squad s/ preset")).toBeInTheDocument();

      await user.keyboard("{Meta>}k{/Meta}");
      expect(screen.getByLabelText("Filtrar projetos")).toHaveFocus();
    });
  });
});
