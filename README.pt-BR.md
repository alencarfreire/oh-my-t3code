<div align="center">
  <img src="assets/logo.png" alt="oh-my-t3code logo" width="96" height="96" />
  <h1>oh-my-t3code</h1>
  <p><strong>Companion nativo para macOS, Preset Studio e Compiler determinístico de squads para o T3 Code</strong></p>
  <p>Inspirado no <code>oh-my-opencode-slim</code> e no <code>oh-my-opencode-companion</code>.</p>
</div>

<p align="center">🌐 <a href="README.md">English</a> | <strong>Português (Brasil)</strong></p>

**Oh My T3Code** adiciona presets declarativos globais, overrides por projeto e compilação determinística de squads ao **T3 Code** (`~/.t3`), sem alterar o binário nem o banco de dados do T3 Code.

Construído com **Tauri v2 (Rust)** no backend e **React 19 + TypeScript + Tailwind CSS v4** na interface, o aplicativo opera discretamente na barra de menus do macOS (`ActivationPolicy::Accessory`) e sincroniza modelos, contas e playbooks de agentes em segundos.

## O que é o oh-my-t3code

O `oh-my-t3code` resolve quatro dores recorrentes no uso diário de múltiplos agentes e projetos no T3 Code:

- **Gestão centralizada de Presets Globais**: defina um preset padrão em `~/.config/oh-my-t3code/presets/*.jsonc` para aplicar o mesmo orquestrador (`defaultModelSelection`) e fallback (`fallbackModelSelection`) em todos os projetos sem override.
- **Overrides por repositório com herança (`extends`)**: personalize apenas o que muda em um projeto específico via `<repo>/.t3code/preset.jsonc`, mantendo herança limpa de um preset global.
- **Swap de instância em 1 clique (`⇄`) e compilação determinística**: alterne instantaneamente entre instâncias configuradas no T3 Code (como instâncias primária e secundária do mesmo provedor, ex.: `antigravity` ⇄ `antigravity_2`) ou entre modelos configurados (como `gpt-6.1-sol` ⇄ `gpt-6.1-terra` no `codex`) quando a cota aperta, e compile `.agents/skills/<slug>-squad/{SKILL.md, roles/*.md}` com preview de Unified Diff antes de gravar.
- **Gestão Inteligente de Sessão, Concorrência e Saúde (`sessionPolicy`)**:
  - **Perfis de hardware (`laptop-8gb`, `desktop-16gb`, `desktop-32gb-plus`)**: aplica rebaixamento automático de `parentThinkingLevel` para `medium` em `laptop-8gb`, nunca emitindo `high`/`xhigh` para o orquestrador no `settings.json` nem no `SKILL.md`.
  - **Regras determinísticas na Seção 5 do `SKILL.md`**: compila `## 5. Gestão de sessão e concorrência (oh-my-t3code)` com limites de workers Antigravity/totais, thinking por tipo de worker (`workerThinkingByKind`) e handoff preventivo.
  - **Monitoramento em tempo real no Menu Bar Popover**: exibe badges de saúde ao vivo (`OK`, `Pai gordo`, `ACP morto`, `Muitos workers` e `Alerta de RAM (8 GB)`) além do botão **`Abrir thread pai novo`** para copiar o prompt de handoff — sem escrever no `statev2.sqlite` nem reiniciar processos do T3 Code.

## Visão visual da interface

### Menu Bar Popover (`380×500`)

<table>
  <tr>
    <td align="center" valign="top">
      <img src="docs/assets/popover-overview.png" width="380" alt="Menu Bar Popover exibindo saúde global da sessão (OK, Agy 2/2, 2/3 workers, laptop-8gb), card Preset Global (Default) com swap do Codex e lista de projetos com override" />
      <br />
      <sub><strong>Visão Geral &amp; Saúde da Sessão</strong>: faixa de concorrência e RAM (<code>OK</code>, <code>Agy 2/2 · 2/3 workers</code>, <code>laptop-8gb</code>), swap no Preset Global e projetos com override.</sub>
    </td>
    <td align="center" valign="top">
      <img src="docs/assets/popover-subagents.png" width="380" alt="Menu Bar Popover com o painel Monitor de Subagentes expandido mostrando workers ativos e concluídos lidos do statev2.sqlite" />
      <br />
      <sub><strong>Monitor de Subagentes</strong>: leitura em tempo real (read-only) de workers ativos e recentes (<code>Agy Principal</code>, <code>Agy Veca</code>, <code>Codex</code>) no <code>statev2.sqlite</code>.</sub>
    </td>
  </tr>
</table>

### Preset Studio (`1120×760`)

![Preset Studio na aba Matriz de Papéis exibindo barra lateral com presets globais, projetos com override e roteamento do papel Designer](docs/assets/studio-roles-matrix.png)

*Matriz de Papéis: barra lateral com Presets Globais e Projetos com Override ao lado da edição de identidade, roteamento de modelo/instância, escopo de arquivos e comandos de verificação.*

![Preset Studio na aba Pontos de Contenção exibindo Sessão e hardware (sessionPolicy) com hardwareProfile, parentThinkingLevel e limites de workers](docs/assets/studio-session-policy.png)

*Sessão e hardware (`sessionPolicy`): configure perfis de hardware (`laptop-8gb`, `desktop-16gb`, `desktop-32gb-plus`), thinking do thread pai, limites de workers Antigravity/totais e limiares de handoff.*

![Preset Studio na aba Preview & Diff exibindo Unified Diff na Seção 5 do SKILL.md antes da gravação em disco](docs/assets/studio-preview-diff.png)

*Preview & Unified Diff: revise alterações determinísticas na Seção 5 do `SKILL.md`, `roles/*.md`, `.t3code/preset.jsonc` e `settings.json` antes de gravar no disco.*

## Visão geral da arquitetura

O diagrama abaixo mostra o fluxo de leitura e escrita entre a interface, o backend Rust/Tauri v2, os arquivos locais do T3 Code e o repositório alvo:

```mermaid
flowchart LR
    User["Usuário (macOS Menu Bar)"] --> Popover["Menu Bar Popover (380×500)"]
    User --> Studio["Preset Studio (1120×760)"]

    Popover -->|15 comandos IPC| Tauri["Backend Rust / Tauri v2"]
    Studio -->|15 comandos IPC| Tauri

    Tauri -->|Read-Only SQLITE_OPEN_READ_ONLY + PRAGMA query_only| SQLite["~/.t3/userdata/statev2.sqlite (subagentes e saúde sessão/ACP: orchestration_v2_projection_*)"]
    Tauri -->|Backup .bak + Escrita Atômica| Settings["~/.t3/userdata/settings.json"]
    Tauri -->|Leitura e Escrita| GlobalPresets["~/.config/oh-my-t3code/ (config.jsonc + presets/*.jsonc)"]
    Tauri -->|Catálogo Read-Only| GlobalSkills["~/.config/skillshare/skills e ~/.gemini/config/skills"]

    Tauri -->|Salva Override + Compila Squad| RepoPreset["<repo>/.t3code/preset.jsonc"]
    Tauri -->|Geração Determinística BTreeMap| RepoSquad["<repo>/.agents/skills/<slug>-squad/ (SKILL.md + roles/*.md)"]
```

## Pré-requisitos

Verifique o ambiente antes de rodar ou empacotar o aplicativo nativo:

- **macOS**: sistema operacional alvo principal do MVP nativo (configurado com `ActivationPolicy::Accessory` e `macOSPrivateApi` em `src-tauri/tauri.conf.json`).
- **Bun**: gerenciador de pacotes e executor de scripts do projeto (`bun.lock`, `bun run ...`).
- **Rust & Cargo (Edition 2021)** e **Xcode Command Line Tools** (`xcode-select --install`): obrigatórios para compilar e executar o backend Tauri v2 (`src-tauri/Cargo.toml`).
- **T3 Code (`~/.t3`)**: instalado e inicializado com projetos e provedores configurados. É obrigatório para dados reais em produção, mas opcional se você quiser testar apenas a interface no modo Browser Preview com `MockIpcStore`.

## Instalar aplicativo macOS pré-compilado (sem conta paga Apple)

Os releases são gerados como `.dmg` Universal (Apple Silicon + Intel) com assinatura *ad-hoc* (`"signingIdentity": "-"` em `src-tauri/tauri.conf.json`). Como o app não possui notarização paga da Apple, o macOS aplica a flag de quarentena (`com.apple.quarantine`) em downloads manuais.

### Opção A: Instalador em um comando (`curl`)

Baixa o `.dmg` Universal mais recente do GitHub Releases, instala `Oh My T3Code.app` em `/Applications` e remove `com.apple.quarantine` automaticamente:

```bash
curl -fsSL https://raw.githubusercontent.com/alencarfreire/oh-my-t3code/main/install.sh | bash
```

Para instalar uma tag específica (ou rodar a partir de um clone local):

```bash
curl -fsSL https://raw.githubusercontent.com/alencarfreire/oh-my-t3code/main/install.sh | bash -s -- v0.2.0
# ou no clone local: ./install.sh v0.2.0
```

### Opção B: Homebrew Cask

```bash
brew tap alencarfreire/oh-my-t3code https://github.com/alencarfreire/oh-my-t3code.git
brew trust alencarfreire/oh-my-t3code
brew install --cask alencarfreire/oh-my-t3code/oh-my-t3code
```

O Cask (`Casks/oh-my-t3code.rb`) já inclui `postflight_steps` para limpar `com.apple.quarantine` automaticamente em `/Applications/Oh My T3Code.app`.

### Opção C: Download manual do `.dmg`

1. Baixe `Oh.My.T3Code_<version>_universal.dmg` em [GitHub Releases](https://github.com/alencarfreire/oh-my-t3code/releases) e arraste `Oh My T3Code.app` para `Applications`.
2. Remova a quarentena uma única vez:

```bash
xattr -dr com.apple.quarantine "/Applications/Oh My T3Code.app"
```

*(Ou tente abrir uma vez, feche o aviso e clique em **Abrir Mesmo Assim** em **Ajustes do Sistema → Privacidade e Segurança**.)*

## Instalação e execução rápida (build local)

Clone o repositório e instale as dependências de frontend com o Bun:

```bash
git clone https://github.com/alencarfreire/oh-my-t3code.git oh-my-t3code
cd oh-my-t3code
bun install
```

Depois de instalar as dependências, escolha o modo de execução adequado ao seu objetivo.

### Opção 1: Modo App Nativo macOS (Desenvolvimento)

Inicia o servidor Vite na porta `1420` e abre o aplicativo nativo Tauri v2 em modo acessório:

```bash
bun run tauri:dev
```

O aplicativo sobe sem ícone no Dock e adiciona o ícone do `oh-my-t3code` na barra de menus superior do macOS. Clique com o botão esquerdo no ícone para abrir o **Popover** ou com o botão direito para abrir o menu de contexto (`Alternar Popover`, `Abrir Preset Studio`, `Sair`).

### Opção 2: Gerar executável e instalador macOS (`.app` e `.dmg`)

Compila o frontend (`tsc -b && vite build`), o binário Rust em release e empacota o aplicativo macOS:

```bash
bun run tauri:build
```

Ao final do build, os artefatos são gerados dentro de `src-tauri/target/release/bundle/` (incluindo o pacote `.app` em `macos/` e a imagem de instalação em `dmg/`).

### Opção 3: Modo Browser Preview (sem T3 Code e sem compilar Rust)

Inicia apenas a interface web via Vite na porta `1420` (`strictPort: true`), ativando automaticamente o `MockIpcStore` em memória:

```bash
bun run dev
```

Quando aberto fora do runtime Tauri em `http://localhost:1420`, o aplicativo exibe a barra superior `Browser Preview (Mock IPC ativo)` para alternar entre `Popover (380×500)` e `Preset Studio (1120×760)` usando projetos de exemplo em memória (`in-memory sample projects`). Você também pode abrir cada janela diretamente pelas URLs `http://localhost:1420/?view=popover` e `http://localhost:1420/?view=studio` (com suporte opcional aos parâmetros `projectId` e `presetId` no Studio).

## Primeiros passos em 5 minutos

No primeiro boot do backend nativo (ou no carregamento do mock em memória), a rotina `ensure_seed_presets` inicializa `~/.config/oh-my-t3code/config.jsonc` com `activeGlobalPresetId: "default"` e `enabled: true`, e cria o preset padrão **`default` (`Default (OMOS Standard)`)** em `~/.config/oh-my-t3code/presets/`:

- **`default` (`Default (OMOS Standard)`)**: preset padrão de instalação com os 5 papéis canônicos do `oh-my-opencode-slim` (`explorer`, `oracle`, `designer`, `fixer` e `qa-reviewer`) no provedor universal `codex`, com orquestrador, `oracle` e `fixer` em `gpt-6.1-sol`, `explorer` e `designer` em `gpt-6-luna` e `qa-reviewer` em `gpt-6-astra`.

A partir dele, você pode criar seus próprios presets globais no **Preset Studio** (**`+ Novo Preset Global`**) e overrides por projeto com os provedores e modelos configurados no seu ambiente T3 Code. Para começar a operar no dia a dia:

1. **Defina o Preset Global**: abra o **Popover** na barra de menus, selecione `default` ou um preset criado por você em **Preset Global Default** e confirme que o toggle está em **Ativo**.
2. **Adicione um Override apenas onde precisar**: projetos sem override seguem o Global Default automaticamente e ficam ocultos da lista principal; clique em **+ Configurar Projeto** para criar um override em um repositório específico.
3. **Use o Swap rápido (`⇄`) quando a cota apertar**: clique no pill de instância/modelo no card global ou no card do projeto para alternar entre instâncias configuradas do mesmo provedor (como instância primária ⇄ secundária, ex.: `antigravity` ⇄ `antigravity_2`) ou alternar modelos configurados (como `gpt-6.1-sol` ⇄ `gpt-6.1-terra` no `codex`) em 1 clique.
4. **Personalize no Preset Studio (`⌘,`)**: pressione `⌘,` (ou clique em **Studio**) para criar presets globais (**`+ Novo Preset Global`**), editar papéis, cadeias de fallback, skills opcionais, MCPs, regras de contenção e revisar o Unified Diff antes de gravar no disco.

## Mapa da documentação

Consulte os guias detalhados para operação da UI, sintaxe JSONC e arquitetura interna:

- [Guia Completo de Uso (Popover & Preset Studio)](docs/GUIA_DE_USO.md): passo a passo visual de todas as telas, botões, badges, abas e fluxos diários.
- [Referência Técnica de Presets JSONC, Herança & Compiler](docs/REFERENCIA_PRESETS_JSONC.md): esquema completo de presets, resolução de `extends`, normalização de opções e formato dos arquivos compilados.
- [Arquitetura, Segurança, IPC & Solução de Problemas (FAQ)](docs/ARQUITETURA_E_TROUBLESHOOTING.md): detalhes dos módulos Rust, mapa dos 15 comandos IPC e diagnóstico de erros comuns.
- [Máquinas de Estado & Invariantes (Técnico)](docs/STATE_MACHINES.md): catálogo formal de estados, transições e invariantes entre UI, Rust e arquivos em disco.

## Segurança e garantias

Todas as operações de leitura e gravação obedecem a quatro invariantes arquiteturais estritas:

- **Acesso estritamente Read-Only ao `statev2.sqlite`**: `~/.t3/userdata/statev2.sqlite` é aberto exclusivamente com as flags `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX` e `PRAGMA query_only = true` para leitura de projetos, subagentes e saúde de sessão/ACP (`orchestration_v2_projection_*`), eliminando locks de escrita e qualquer risco de corrupção do estado do T3 Code — sem nunca gravar no banco, criar threads ou encerrar processos `agy_acp_server`.
- **Backup obrigatório e escrita atômica em `settings.json`**: antes de gravar qualquer alteração em `~/.t3/userdata/settings.json`, o backend gera um backup em `~/.t3/userdata/settings.json.bak` e grava a nova versão via arquivo temporário único + `sync_all()` + `rename`, preservando 100% das chaves não relacionadas.
- **Compilação determinística e cache-safe**: `<repo>/.agents/skills/<slug>-squad/SKILL.md` e `roles/*.md` são gerados em ordem determinística com `BTreeMap`, sem timestamps aleatórios ou UUIDs efêmeros, e com preview obrigatório de Unified Diff no Studio antes da gravação.
- **Paridade estrita de contrato IPC**: todos os 15 comandos Tauri expostos em `src-tauri/src/lib.rs` possuem espelhamento exato de nome, argumentos e retorno em `src/types/ipc.ts` (`IPC_COMMANDS`).

## Comandos de verificação

Execute a suíte abaixo sempre que alterar código Rust ou TypeScript para validar tipagem, compilação e testes unitários:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
bun run typecheck
bun run test
bun run build
```
