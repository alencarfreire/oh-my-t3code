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
    it("renders active subagents, T3 projects, supports 1-click preset sync, instance swap, and Escape close", async () => {
      const user = userEvent.setup();
      setLocationSearch("?view=popover");

      const onTogglePopover = vi.fn();
      const unsub = subscribeMockPopoverToggle(onTogglePopover);

      render(<App />);

      // Header live status badge & subagent list
      expect(await screen.findByText("Oh My T3Code")).toBeInTheDocument();
      expect(screen.getByText("2 ativos")).toBeInTheDocument();
      expect(
        screen.getByText("Implementar Popover & Preset Studio (Onda 2)"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Otimizar queries de conciliação financeira"),
      ).toBeInTheDocument();

      // Projects section
      const projectsSection = screen.getByRole("region", {
        name: /Projetos & 1-Click Sync/i,
      });
      expect(within(projectsSection).getByText("oh-my-t3code")).toBeInTheDocument();
      expect(within(projectsSection).getByText("cabrito")).toBeInTheDocument();
      expect(within(projectsSection).getByText("dashboard-meta")).toBeInTheDocument();

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

      // Sidebar renders Global Presets and T3 Code Projects
      const sidebar = await screen.findByRole("complementary", {
        name: "Navegação de Presets e Projetos",
      });
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
  });
});
