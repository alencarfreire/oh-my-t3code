<div align="center">
  <img src="assets/icon.svg" alt="oh-my-t3code icon" width="72" height="72" />
  <h1>oh-my-t3code</h1>
  <p><strong>Native macOS Menu Bar Companion, Preset Studio & Deterministic Squad Compiler for T3 Code</strong></p>
  <p>Inspired by <code>oh-my-opencode-slim</code> and <code>oh-my-opencode-companion</code>.</p>
</div>

---

## Overview

**Oh My T3Code** is an external companion app and visual Preset Studio for **T3 Code** (`~/.t3`), built with **Tauri v2 (Rust)** and **React 19 + TypeScript + Tailwind CSS v4**.

It brings `oh-my-opencode-slim`-style declarative **Global Presets** (`~/.config/oh-my-t3code/presets/*.jsonc`) and **Project Overrides** (`<repo>/.t3code/preset.jsonc`) with `extends` inheritance to T3 Code projects (`cabrito`, `dashboard-meta`, `oh-my-t3code`, etc.).

### Key Features (macOS MVP)

1. **macOS Menu Bar Popover (`~380×500px`, `ActivationPolicy::Accessory`):**
   - **Live Subagents Monitor:** Real-time visibility into active and recent `delegate_task` runs from `~/.t3/userdata/statev2.sqlite` (`orchestration_v2_projection_subagents`).
   - **1-Click Preset Switch & Sync:** Switch any T3 Code project between global presets (`agy-dual`, `codex-squad`, `hybrid-agy-codex`) and immediately compile `<repo>/.agents/skills/<project>-squad/` + update `~/.t3/userdata/settings.json`.
   - **Quick Instance Swap (`⇄`):** Toggle primary Antigravity instance (`antigravity` Agy Veca ⇄ `antigravity_2` Agy Principal) with 1 click when quota gets tight.
2. **Preset Studio Window (`1120×760px`):**
   - Visual editor for **Global Presets** and **Project Overrides** (`extends` inheritance, topology `intra-thread-squad` vs `issue-thread-orchestrator`, contention rules, and ordered **Fallback Chains**).
   - **Role × Model Matrix:** Configure roles (`backend`, `frontend`, `rust-core`, `crystal`, `meta-sync`, `fixer`, `qa-reviewer`, `delivery-manager`) with provider instances, models, and reasoning/thinking options.
   - **Global Skills & MCP Selector:** Search and assign installed skills from `~/.config/skillshare/skills` and MCP servers (`ai-memory`, `context7`, `playwright`, `linear`) per role.
   - **Reverse Importer:** Import existing manual `.agents/skills/*-squad/` setups into structured `.t3code/preset.jsonc` files.
   - **Unified Diff & Markdown Preview:** Inspect exact file diffs (`SKILL.md`, `roles/*.md`, and `settings.json` overrides) before writing to disk.

---

## Safety Invariants

- **Strictly Read-Only SQLite:** `~/.t3/userdata/statev2.sqlite` is opened exclusively with `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX` and `PRAGMA query_only = true`.
- **Backup + Atomic Settings Sync:** `~/.t3/userdata/settings.json` is backed up to `settings.json.bak` and updated via temp-file + `fsync` + atomic `rename`, preserving all unrelated keys.
- **Deterministic & Cache-Safe Compilation:** Generated `SKILL.md` and `roles/*.md` files use `BTreeMap` ordering with zero random timestamps or UUIDs.

---

## Development & Verification

```bash
# Install frontend dependencies
bun install

# Run frontend in browser (with built-in mock store fallback)
bun run dev

# Run native macOS Menu Bar app via Tauri v2
bun run tauri:dev

# Full verification suite
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
bun run typecheck
bun run test
bun run build
```
