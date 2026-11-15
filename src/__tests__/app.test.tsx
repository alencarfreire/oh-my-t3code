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
    it("renders synced/presets summary, filters T3 projects, supports 1-click preset sync, instance swap, and Escape close without subagent monitor", async () => {
      const user = userEvent.setup();
      setLocationSearch("?view=popover");

      const onTogglePopover = vi.fn();
      const unsub = subscribeMockPopoverToggle(onTogglePopover);

      render(<App />);

      // Header logo & synced/presets summary (no redundant subagents badge or list)
      expect(await screen.findByText("Oh My T3Code")).toBeInTheDocument();
      expect(screen.getByAltText("Oh My T3Code")).toHaveAttribute("src", "/logo.png");
      expect(screen.getByText("2/3 sincronizados · 3 presets")).toBeInTheDocument();
      expect(screen.queryByText("2 ativos")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: /Subagentes/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Implementar Popover & Preset Studio (Onda 2)"),
      ).not.toBeInTheDocument();

      // Projects section
      const projectsSection = screen.getByRole("region", {
        name: /Projetos & 1-Click Sync/i,
      });
      expect(within(projectsSection).getByText("oh-my-t3code")).toBeInTheDocument();
      expect(within(projectsSection).getByText("cabrito")).toBeInTheDocument();
      expect(within(projectsSection).getByText("dashboard-meta")).toBeInTheDocument();

      // Filter projects quickly and clear filter
      const filterInput = screen.getByLabelText("Filtrar projetos");
      await user.type(filterInput, "cabrito");
      expect(within(projectsSection).getByText("1 de 3")).toBeInTheDocument();
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
      expect(within(projectsSection).getByText("3 projetos")).toBeInTheDocument();
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
      expect(screen.getByText("3/3 sincronizados · 3 presets")).toBeInTheDocument();

      // Click 1-click Swap Instance button on oh-my-t3code
      const swapBtn = screen.getByRole("button", {
        name: "Alternar instância Agy em oh-my-t3code",
      });
      await user.click(swapBtn);

      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(
          /Instância alternada em oh-my-t3code: Agy Veca/i,
        );
      });

      // Press Escape to toggle/hide popover window
      await user.keyboard("{Escape}");
      expect(onTogglePopover).toHaveBeenCalledTimes(1);

      unsub();
    });
  });

  describe("Preset Studio View", () => {
    it("navigates between Global Presets and Projects, edits roles/skills, and previews Unified Diff before syncing", async () => {
      const user = userEvent.setup();
      setLocationSearch("?view=studio");

      render(<App />);

      // Sidebar renders logo, Global Presets and T3 Code Projects
      const sidebar = await screen.findByRole("complementary", {
        name: "Navegação de Presets e Projetos",
      });
      expect(within(sidebar).getByAltText("Oh My T3Code")).toHaveAttribute(
        "src",
        "/logo.png",
      );
      expect(
        within(sidebar).getByText("Agy Dual (Veca + Principal)"),
      ).toBeInTheDocument();
      expect(within(sidebar).getByText("Codex Squad (Sol + Terra)")).toBeInTheDocument();
      expect(within(sidebar).getByText("cabrito")).toBeInTheDocument();
      expect(within(sidebar).getByText("oh-my-t3code")).toBeInTheDocument();

      // Switch to project 'cabrito'
      await user.click(within(sidebar).getByRole("button", { name: /cabrito/i }));
      await waitFor(() => {
        expect(
          screen.getByRole("heading", { level: 1, name: "cabrito" }),
        ).toBeInTheDocument();
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

      // Select SKILL.md to inspect its unified diff and compiled Markdown
      await user.click(
        screen.getByRole("button", {
          name: /\.agents\/skills\/cabrito-squad\/SKILL\.md/i,
        }),
      );
      expect(screen.getByRole("region", { name: "Unified Diff" })).toHaveTextContent(
        /\+\+\+ b\/\.agents\/skills\/cabrito-squad\/SKILL\.md/,
      );

      // Toggle to Compiled Markdown view
      await user.click(
        screen.getByRole("button", { name: /Markdown Compilado/i }),
      );
      expect(
        screen.getByText(/# cabrito Squad — Playbook do Orquestrador/i),
      ).toBeInTheDocument();

      // Save & Sync project
      await user.click(
        screen.getByRole("button", { name: /Salvar & Sincronizar Projeto/i }),
      );
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(/Sincronizado!/i);
      });
    });

    it("supports 1-click model/thinking_level pills, Codex reasoningEffort pills, architecture summary, and selected-skills filter", async () => {
      const user = userEvent.setup();
      setLocationSearch("?view=studio");

      render(<App />);

      // Wait for Studio header architecture summary strip
      expect(await screen.findByText(/Topologia: Intra-Thread/i)).toBeInTheDocument();
      expect(screen.getByText(/Fallback: 3 níveis/i)).toBeInTheDocument();
      expect(screen.getByText(/Papéis: 3/i)).toBeInTheDocument();

      // Switch to Matriz de Papéis tab
      await user.click(screen.getByRole("tab", { name: /Matriz de Papéis/i }));

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
        screen.getByRole("checkbox", { name: /tdd-and-testing/i }),
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
