#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const ASSETS_DIR = path.join(REPO_ROOT, "docs", "assets");
const DEV_URL = "http://localhost:1420";

async function resolvePlaywright() {
  const candidates = [];

  if (process.env.PLAYWRIGHT_PATH) {
    candidates.push(process.env.PLAYWRIGHT_PATH);
  }

  // 1. Standard package resolution (if installed locally or globally)
  try {
    const mod = await import("playwright");
    if (mod?.chromium) {
      return mod;
    }
  } catch {
    // Continue searching npx cache
  }

  // 2. Dynamic lookup in ~/.npm/_npx/*/node_modules/playwright
  const npxRoot = path.join(os.homedir(), ".npm", "_npx");
  if (fs.existsSync(npxRoot)) {
    const dirs = fs.readdirSync(npxRoot, { withFileTypes: true });
    const pwPaths = [];
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue;
      const pwDir = path.join(npxRoot, entry.name, "node_modules", "playwright");
      const pwEntry = path.join(pwDir, "index.mjs");
      if (fs.existsSync(pwEntry)) {
        const stat = fs.statSync(pwDir);
        pwPaths.push({ pwEntry, mtimeMs: stat.mtimeMs });
      }
    }
    // Prefer newest cache entries first
    pwPaths.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const item of pwPaths) {
      candidates.push(item.pwEntry);
    }
  }

  let fallbackMod = null;
  for (const candidate of candidates) {
    try {
      const target = candidate.endsWith(".mjs") || candidate.endsWith(".js")
        ? pathToFileURL(candidate).href
        : candidate;
      const mod = await import(target);
      if (mod?.chromium) {
        const execPath = mod.chromium.executablePath?.();
        if (execPath && fs.existsSync(execPath)) {
          return mod;
        }
        fallbackMod ??= mod;
      }
    } catch {
      // Try next candidate
    }
  }

  if (fallbackMod) {
    return fallbackMod;
  }

  throw new Error(
    "Playwright não encontrado. Defina PLAYWRIGHT_PATH ou instale em cache via `npx playwright install chromium`.",
  );
}

async function isServerReady(url) {
  try {
    const res = await fetch(url, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerReady(url)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timeout aguardando Vite responder em ${url} após ${timeoutMs}ms.`);
}

async function startDevServerIfNeeded() {
  if (await isServerReady(DEV_URL)) {
    console.log(`[screenshots] Reutilizando servidor Vite já ativo em ${DEV_URL}`);
    return { spawned: false, stop: async () => {} };
  }

  console.log(`[screenshots] Subindo \`bun run dev\` em ${DEV_URL}...`);
  const child = spawn("bun", ["run", "dev"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  let stderrLog = "";
  child.stderr?.on("data", (chunk) => {
    stderrLog += chunk.toString();
  });

  const earlyExitPromise = new Promise((_, reject) => {
    child.once("exit", (code) => {
      reject(
        new Error(
          `\`bun run dev\` encerrou prematuramente com código ${code}.\n${stderrLog}`,
        ),
      );
    });
  });

  const stop = async () => {
    if (child.killed || child.exitCode !== null) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore
      }
    }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Ignore
        }
        resolve();
      }, 2000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  try {
    await Promise.race([waitForServer(DEV_URL, 30_000), earlyExitPromise]);
  } catch (err) {
    await stop();
    throw err;
  }

  return { spawned: true, stop };
}

async function waitForStableRender(page, extraWaitMs = 200) {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await page.waitForTimeout(extraWaitMs);
}

async function main() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  const { chromium } = await resolvePlaywright();
  const server = await startDevServerIfNeeded();

  let browser;
  try {
    browser = await chromium.launch({ headless: true });

    // -------------------------------------------------------------------------
    // 1 & 2. Popover Views (380x500 @2x)
    // -------------------------------------------------------------------------
    const popoverContext = await browser.newContext({
      viewport: { width: 380, height: 500 },
      deviceScaleFactor: 2,
      colorScheme: "dark",
    });
    const popoverPage = await popoverContext.newPage();

    await popoverPage.goto(`${DEV_URL}/?view=popover`, {
      waitUntil: "networkidle",
    });
    await popoverPage
      .getByRole("region", { name: "Saúde global da sessão e RAM" })
      .waitFor({ state: "visible" });
    await popoverPage
      .getByRole("heading", { name: "Preset Global (Default)" })
      .waitFor({ state: "visible" });
    await waitForStableRender(popoverPage, 250);

    const popoverOverviewPath = path.join(ASSETS_DIR, "popover-overview.png");
    await popoverPage.screenshot({ path: popoverOverviewPath });
    console.log(`[screenshots] Capturado: ${popoverOverviewPath}`);

    // Expand Monitor de Subagentes and frame subagent cards + SQLite Read-Only footer
    const subagentsToggle = popoverPage.getByRole("button", {
      name: /Monitor de Subagentes/i,
    });
    await subagentsToggle.click();
    await popoverPage.locator("#popover-subagents-panel").waitFor({
      state: "visible",
    });
    await popoverPage.evaluate(() => {
      const main = document.querySelector("main");
      if (main) {
        main.scrollTop = main.scrollHeight;
      }
    });
    await waitForStableRender(popoverPage, 250);

    const popoverSubagentsPath = path.join(ASSETS_DIR, "popover-subagents.png");
    await popoverPage.screenshot({ path: popoverSubagentsPath });
    console.log(`[screenshots] Capturado: ${popoverSubagentsPath}`);

    await popoverContext.close();

    // -------------------------------------------------------------------------
    // 3, 4 & 5. Studio Views (1120x760 @2x)
    // -------------------------------------------------------------------------
    const studioContext = await browser.newContext({
      viewport: { width: 1120, height: 760 },
      deviceScaleFactor: 2,
      colorScheme: "dark",
    });
    const studioPage = await studioContext.newPage();

    await studioPage.goto(`${DEV_URL}/?view=studio`, {
      waitUntil: "networkidle",
    });
    await studioPage
      .getByRole("complementary", { name: "Navegação de Presets e Projetos" })
      .waitFor({ state: "visible" });

    // Select `agy-dual` preset for rich Dual-Agy visual context
    await studioPage
      .getByRole("button", { name: /Agy Dual \(Veca \+ Principal\)/i })
      .click();

    // 3. Studio Roles Matrix
    await studioPage.getByRole("tab", { name: /Matriz de Papéis/i }).click();
    await studioPage
      .getByRole("heading", { name: /Roteamento de Modelo & Instância/i })
      .waitFor({ state: "visible" });
    await waitForStableRender(studioPage, 250);

    const studioRolesPath = path.join(ASSETS_DIR, "studio-roles-matrix.png");
    await studioPage.screenshot({ path: studioRolesPath });
    console.log(`[screenshots] Capturado: ${studioRolesPath}`);

    // 4. Studio Session Policy (ContentionTab -> SessionPolicySection)
    await studioPage.getByRole("tab", { name: /Pontos de Contenção/i }).click();
    await studioPage
      .getByRole("heading", { name: /Sessão e hardware/i })
      .waitFor({ state: "visible" });
    await studioPage.evaluate(() => {
      const panel = document.querySelector('main[role="tabpanel"]');
      if (panel) {
        panel.scrollTop = 0;
      }
    });
    await waitForStableRender(studioPage, 250);

    const studioSessionPolicyPath = path.join(
      ASSETS_DIR,
      "studio-session-policy.png",
    );
    await studioPage.screenshot({ path: studioSessionPolicyPath });
    console.log(`[screenshots] Capturado: ${studioSessionPolicyPath}`);

    // 5. Studio Preview & Diff (SKILL.md Unified Diff with Section 5 changes)
    // Select project `oh-my-t3code` (which has baseline SKILL.md seeded in MockIpcStore)
    await studioPage
      .getByRole("button", { name: /oh-my-t3code/i })
      .first()
      .click();
    await studioPage
      .getByRole("heading", { name: /Sessão e hardware/i })
      .waitFor({ state: "visible" });

    // Adjust sessionPolicy fields so Preview & Diff generates a crisp real diff in Section 5
    const maxAgyInput = studioPage.locator("#session-max-agy-workers");
    await maxAgyInput.fill("1");
    await maxAgyInput.blur();
    const maxTurnsInput = studioPage.locator("#session-parent-max-turns");
    await maxTurnsInput.fill("12");
    await maxTurnsInput.blur();

    await studioPage.getByRole("tab", { name: /Preview & Diff/i }).click();
    const skillFileBtn = studioPage.getByRole("button", {
      name: /\.agents\/skills\/oh-my-t3code-squad\/SKILL\.md/i,
    });
    await skillFileBtn.waitFor({ state: "visible" });
    await skillFileBtn.click();

    const diffRegion = studioPage.getByRole("region", { name: "Unified Diff" });
    await diffRegion.waitFor({ state: "visible" });

    // Reset main tabpanel scroll to top, ensure Preview & Diff tab is fully visible,
    // and scroll DiffViewer accurately to Section 5 (`## 5. Gestão de sessão e concorrência`)
    await studioPage.evaluate(() => {
      const panel = document.querySelector('main[role="tabpanel"]');
      if (panel) {
        panel.scrollTop = 0;
      }
      const tabList = document.querySelector('nav [role="tablist"]');
      if (tabList) {
        tabList.scrollLeft = tabList.scrollWidth;
      }
      const diffEl = document.querySelector('[role="region"][aria-label="Unified Diff"]');
      if (diffEl && diffEl.firstElementChild) {
        const rows = Array.from(diffEl.firstElementChild.children);
        const section5 = rows.find((el) =>
          el.textContent?.includes("5. Gestão de sessão e concorrência"),
        );
        if (section5) {
          const diffRect = diffEl.getBoundingClientRect();
          const rowRect = section5.getBoundingClientRect();
          diffEl.scrollTop += rowRect.top - diffRect.top - 8;
        }
      }
    });
    await waitForStableRender(studioPage, 250);

    const studioPreviewDiffPath = path.join(
      ASSETS_DIR,
      "studio-preview-diff.png",
    );
    await studioPage.screenshot({ path: studioPreviewDiffPath });
    console.log(`[screenshots] Capturado: ${studioPreviewDiffPath}`);

    await studioContext.close();
  } finally {
    if (browser) {
      await browser.close();
    }
    await server.stop();
  }
}

main().catch((err) => {
  console.error("[screenshots] Erro:", err);
  process.exit(1);
});
