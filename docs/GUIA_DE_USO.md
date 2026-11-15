# Guia completo de uso: Menu Bar Popover & Preset Studio

Este guia ensina passo a passo como operar todas as telas, botões, atalhos e fluxos do **Oh My T3Code**, tanto pelo **Menu Bar Popover** (`380×500px`) quanto pelo **Preset Studio** (`1120×760px`).

## 1. Menu Bar Popover (`380×500px`)

O **Popover** é o centro de controle rápido na barra de menus do macOS para alternar o preset global, gerenciar overrides por projeto e trocar contas ou modelos em 1 clique.

### Como acessar e atalhos de teclado

No modo nativo macOS (`bun run tauri:dev` ou app compilado), o `oh-my-t3code` roda como acessório na barra de menus superior sem ícone no Dock:

- **Clique esquerdo no ícone da barra de menus**: abre ou fecha o **Popover** alinhado abaixo do ícone.
- **Clique direito no ícone da barra de menus**: exibe o menu de contexto nativo com as ações **Alternar Popover**, **Abrir Preset Studio** e **Sair**.
- **Perda de foco**: clicar fora da janela do **Popover** oculta a janela automaticamente.

Com o **Popover** em foco, use os seguintes atalhos de teclado:

| Atalho | Ação |
| :--- | :--- |
| `⌘K` / `Ctrl+K` ou `/` | Foca o campo de filtro rápido de projetos com override (quando há 2 ou mais overrides) |
| `⌘,` / `Ctrl+,` | Oculta o Popover e abre o **Preset Studio** |
| `Esc` | Fecha o **Popover** |

> [!NOTE]
> O atalho `/` só foca o campo de busca quando o cursor não está dentro de um campo de texto (`input`, `textarea` ou `select`).

### Cabeçalho e seção `Preset Global (Default)`

O cabeçalho superior exibe o resumo de estado em tempo real (`Global Ativo` ou `Global Pausado · N override(s) · M presets`), o botão de atualização (**Atualizar dados do T3 Code**) e o botão **Studio** (`⌘,`).

Logo abaixo fica o card em destaque **Preset Global (Default)**, que controla o comportamento padrão aplicado a todos os projetos sem override local:

- **Badges de estado**: **Global Ativo** / **Global Pausado** no cabeçalho e **Instalado por padrão** (badge azul quando o preset ativo é o `default`).
- **Toggle `Ativo` / `Desativado`**: ativa ou pausa o Preset Global. Quando ativo, exibe `Padrão para todos os projetos · <modelo>` e sincroniza `defaultModelSelection` e `fallbackModelSelection` em `~/.t3/userdata/settings.json`. Quando desativado, exibe `Desativado — projetos sem override usam config padrão do T3 Code`.
- **Dropdown `Preset Global Default`**: escolhe qual preset global em `~/.config/oh-my-t3code/presets/*.jsonc` é o padrão (`default`, `agy-dual`, `codex-squad`, `hybrid-agy-codex` ou presets criados por você).
- **Botão Swap `⇄`**: alterna em 1 clique quando a cota aperta:
  - Em presets Antigravity (`antigravity` / `antigravity_2`): exibe `Agy Veca` ou `Agy Principal` e inverte entre as duas contas (`Inverter instância global (Agy Veca ⇄ Agy Principal)`).
  - Em presets Codex (`codex`): exibe `Codex · <modelo>` e alterna entre `gpt-6.1-sol` ⇄ `gpt-6.1-terra`.
  - Em outros provedores (`claudeAgent`, `opencode`, `grok`), exibe apenas uma pílula estática com o nome da instância.
- **Ícone de configurações (`Editar Preset Global no Studio`)**: abre o **Preset Studio** já posicionado no Preset Global ativo.

### Seção `Projetos com Override`

Projetos do T3 Code que não possuem customização ficam ocultos da lista principal porque seguem o **Preset Global (Default)** automaticamente. Apenas projetos com override local, squad detectada ou divergência em `settings.json` aparecem em **Projetos com Override (N)**.

Para criar um override em um projeto que hoje segue o Global Default:

1. Clique em **+ Configurar Projeto** no cabeçalho da seção.
2. Em **Projeto do T3 Code (seguindo Global Default)**, selecione o repositório desejado.
3. Em **Preset de Override**, escolha o preset inicial que servirá de base.
4. Clique em **Aplicar Override** (ou **Cancelar** para desistir).

Quando houver **2 ou mais** projetos com override, o campo **Filtrar overrides, preset ou instância…** (`⌘K`) é exibido automaticamente e busca por título do projeto, caminho (`workspaceRoot`), `id` ou `extends` do preset local, slug da squad detectada ou nome curto da instância (`Agy Veca`, `Agy Principal`, `Codex`).

Cada card na lista **Projetos com Override** exibe badges e ações dedicadas:

- **Badges e status do projeto**:
  - **Sincronizado** (verde): `<repo>/.t3code/preset.jsonc` existe e o override está ativo.
  - **Squad s/ preset** (âmbar): existe uma squad manual em `<repo>/.agents/skills/*-squad/` sem `<repo>/.t3code/preset.jsonc`.
  - **Override** (neutro): existe override em `settings.json` sem preset local em `.t3code/`.
  - **Seguindo Global Default (override pausado)** (âmbar): exibido quando o toggle individual do projeto está em `Desativado`.
- **Ações do card**:
  - **Toggle individual (`Ativo` / `Desativado`)**: pausa ou reativa o override do projeto sem apagar `.t3code/preset.jsonc`. Ao pausar, remove `projectSettingsOverrides[projectId]` de `settings.json`.
  - **Swap `⇄` em 1 clique**: alterna `Agy Veca` ⇄ `Agy Principal` (ou `gpt-6.1-sol` ⇄ `gpt-6.1-terra` no Codex), recompila a squad e atualiza `settings.json`.
  - **Botão `Global`**: remove o override (`.t3code/preset.jsonc` e `projectSettingsOverrides[projectId]`) e devolve o projeto ao **Global Default**.
  - **Dropdown de preset + botão `Sync`**: aplica o preset escolhido ao projeto (`Sync…` durante a gravação e `Sincronizado!` ao concluir).
  - **Ícone de configurações (`Editar no Preset Studio`)**: abre o **Preset Studio** diretamente no projeto selecionado.

### Rodapé e nota sobre subagentes

O rodapé do **Popover** confirma as garantias de segurança com o selo **SQLite Read-Only · ~/.t3** e o lembrete **Esc para fechar**.

> [!NOTE]
> A leitura de atividade de subagentes a partir de `~/.t3/userdata/statev2.sqlite` (`orchestration_v2_projection_subagents`, exposta em `activeSubagentCount` e `subagents` no `DashboardSnapshot`) já está implementada no backend Rust. Na versão atual da interface, o **Popover** foca exclusivamente na gestão de Presets e 1-Click Sync e não renderiza um painel visual de subagentes em execução.

---

## 2. Preset Studio (`1120×760px`)

O **Preset Studio** é o editor completo para criar presets globais, herdar configurações com `extends`, montar a matriz de papéis, vincular skills e MCPs, definir políticas de contenção e inspecionar o **Unified Diff** antes de gravar no disco.

Ao fechar a janela do **Preset Studio**, ela é apenas ocultada para preservar o app residente na barra de menus do macOS.

### Barra lateral (`StudioSidebar`)

A barra lateral esquerda divide a navegação em dois grupos:

1. **Presets Globais**:
   - Lista todos os presets de `~/.config/oh-my-t3code/presets/*.jsonc`, exibindo badges como **Default · Ativo** / **Default · Pausado**, **Desativado**, **Instalado por padrão**, família (`OMOS Standard`, `Dual Agy`, `Codex`, `Hybrid`, `Custom`), contagem de papéis (`N roles`) e herança (`↳ <parent>`).
   - Clique em **+ Novo Preset Global** para abrir o formulário de criação: informe o **ID do Preset (`~/.config/.../presets/*.jsonc`)** (letras, números, `-` ou `_`) e escolha em **Herdar de (`extends`)** a opção **Nenhum (Base)** para criar do zero ou um preset existente para clonar/estender suas configurações.
2. **Projetos com Override**:
   - Lista apenas os projetos com override ou squad detectada, mostrando badge **Ativo** / **Desativado** e a referência de herança (`extends: ...`, `preset: ...` ou `override local`).
   - Clique em **+ Configurar Projeto** para transformar um projeto que segue o Global Default em override local (ou importar sua squad diretamente pelo botão **Importar Squad**, caso exista).
   - **Reverse Importer (`Importar Squad Existente`)**: sempre que o backend detectar uma pasta `.agents/skills/*-squad/` no repositório, o card exibe o botão **Importar Squad Existente**. Ao clicar, o `oh-my-t3code` lê `SKILL.md` e `roles/*.md` existentes e converte a squad manual para `<repo>/.t3code/preset.jsonc`.

### Cabeçalho do Editor e faixa de arquitetura

O topo do editor adapta os badges e botões conforme o item selecionado na sidebar:

- **Em Modo Global**:
  - Exibe o badge **Preset Global** (além de **Default Global** e **Instalado por padrão**, quando aplicável) e o caminho `~/.config/oh-my-t3code/presets/<id>.jsonc`.
  - Ações: **StatusToggle** (`Ativo` / `Desativado`), **Definir como Global Default** (quando o preset selecionado ainda não for o Global Default) e **Salvar Preset Global**.
- **Em Modo Projeto**:
  - Exibe o badge **Projeto · Override Local** e o caminho `<repo>/.t3code/preset.jsonc`.
  - Ações: **StatusToggle** (`Ativo` / `Desativado`), **Voltar ao Global (Remover Override)**, **Salvar Override** e **Revisar Diff & Sincronizar** (leva diretamente à aba **Preview & Diff**).
- **Badge `Alterações não salvas`**: aparece em âmbar sempre que o rascunho atual difere do arquivo salvo em disco.
- **Faixa resumo de arquitetura**: mostra instantaneamente `Orquestrador`, `Topologia` (`Intra-Thread` ou `Issue-Thread`), `Fallback: N nível(is)` e `Papéis: N`.

### Navegação entre as 5 abas

A barra de abas (`Seções do Editor`) suporta navegação por teclado usando as setas `ArrowLeft` e `ArrowRight` entre os 5 painéis descritos a seguir.

#### Aba 1: `Visão Geral & Fallback`

Centraliza metadados, herança, modelo do orquestrador e cadeia de transbordo:

- **Identidade, Herança (`extends`) & Topologia**:
  - **Nome do Preset**: nome amigável exibido na sidebar e nos seletores.
  - **Identificador (`id`)**: campo somente leitura que corresponde ao nome do arquivo `.jsonc`.
  - **Herda de (`extends`)**: escolha **Nenhum (Base)** ou qualquer Preset Global pai para herdar papéis, fallback e contenção.
  - **Topologia da Squad**: escolha entre `intra-thread-squad (Workers via delegate_task)` (workers dentro da mesma thread) e `issue-thread-orchestrator (Orquestração por threads/issues)` (threads independentes por issue/worktree).
  - **Descrição**: resumo do propósito do preset.
- **Orquestrador Primário (`settings.json` Override)**:
  - Usa o componente `ModelRoutingFields` para definir o `defaultModelSelection` gravado no T3 Code:
  - **Instância (`providerInstanceId`)**: dropdown completo mais chips rápidos de 1 clique (`Agy Veca`, `Agy Principal`, `Codex`, etc.).
  - **Modelo (`model`)**: dropdown + chips rápidos de modelos conhecidos, além do botão **Custom** (que alterna para campo de texto livre; clique em **Usar lista** para voltar ao seletor).
  - **Opções do Orquestrador (1-clique)**: pílulas rápidas adaptadas ao provedor:
    - Antigravity (`antigravity`, `antigravity_2`): `thinking_level` (`low`, `medium`, `high`, `xhigh`).
    - Codex (`codex`): `reasoningEffort` (`low`, `medium`, `high`, `xhigh`) e `serviceTier` (`default`, `priority`).
  - **Avançado**: expande o editor de chave/valor (`Parâmetros personalizados (key / value)`) para adicionar ou ajustar qualquer opção extra; o rótulo muda para `Ocultar chave/valor` quando aberto.
- **Pipeline Visual de Fallback (`fallbackChain`)**:
  - Mostra o nó de origem (**Orquestrador Primário**) ligado a cada nível numerado (`Nível 1`, `Nível 2`, …).
  - Clique em **Adicionar Passo** para incluir um novo nível de fallback.
  - Em cada passo, use os botões de seta para subir/descer a prioridade na cadeia, o botão de lixeira para remover, os controles de **Instância**, **Modelo** e **Opções do Nível**, e o campo **Motivo / Regra de Acionamento** para documentar quando a squad deve acionar aquele transbordo.

#### Aba 2: `Matriz de Papéis`

Permite configurar cada worker especializado que será compilado em `<repo>/.agents/skills/<slug>-squad/roles/<id>.md`:

- **Coluna esquerda (`Papéis (roles/)`)**:
  - Lista todos os papéis em ordem alfabética, mostrando modelo, instância, opção principal e contagem de skills, MCPs e checks.
  - Clique em **+ Adicionar Papel** para criar um ID customizado (caracteres `[a-z0-9_-]`) ou clique em um dos **11 Templates rápidos** pré-configurados: `explorer`, `oracle`, `designer`, `fixer`, `qa-reviewer`, `backend`, `frontend`, `rust-core`, `crystal`, `meta-sync` e `delivery-manager`.
- **Coluna direita (4 cards do papel selecionado)**:
  1. **Identidade (`roles/<id>.md`)**: edite **Título do Papel**, **Quando Acionar (`whenToUse`)** e **Descrição do Papel**, ou clique em **Remover Papel**.
  2. **Roteamento de Modelo & Instância**: defina instância, modelo e opções (`thinking_level` / `reasoningEffort`) específicos desse papel sem afetar o orquestrador.
  3. **Escopo de Arquivos**: adicione padrões glob ou diretórios em **Caminhos Permitidos (`allowedPaths`)** (chips verdes) e **Caminhos Proibidos (`forbiddenPaths`)** (chips vermelhos) para evitar conflitos de edição paralela.
  4. **Invariantes & Verificação**: liste regras obrigatórias em **Invariantes do Papel (`invariants`)** e os comandos do **Gate de Qualidade** em **Comandos de Verificação (`verificationCommands`)** (exibidos em formato terminal `$ ...`, como `cargo test --manifest-path src-tauri/Cargo.toml` e `bun run typecheck`).

#### Aba 3: `Skills & MCPs`

Associa skills locais e servidores MCP a cada papel da squad:

- **Seletor superior (`Papel:`)**: alterne rapidamente entre os papéis existentes no preset sem sair da aba.
- **Skills Globais**:
  - Catálogo lido automaticamente de `~/.config/skillshare/skills` e `~/.gemini/config/skills`.
  - Alterne entre **Todas** e **Apenas Selecionadas**, busque por nome ou descrição em **Buscar skill (ex: tailwind, tdd, security)…** e filtre por origem (**Todas origens**, `skillshare`, `gemini`, etc.).
  - Marque ou desmarque o checkbox de cada skill; itens ativos recebem o badge **Ativa**.
- **MCPs Recomendados**:
  - Cards interativos para os 4 servidores MCP recomendados:
    - **`ai-memory`** (`Memória & Handoffs`): memória durável do projeto, decisões de arquitetura e handoffs entre sessões.
    - **`context7`** (`Docs Atualizadas`): documentação atualizada de bibliotecas e frameworks (Tauri, React, Tailwind).
    - **`playwright`** (`E2E & Visual`): automação de navegador, snapshots de acessibilidade e testes E2E visuais.
    - **`linear`** (`Issues & Status`): leitura e atualização de issues, projetos, ciclos e status no Linear.
  - Use **Adicionar MCP customizado** (botão **Add**) para incluir qualquer outro servidor MCP configurado no seu ambiente (marcado com badge `custom`).

#### Aba 4: `Pontos de Contenção`

Define regras de segurança operacional (`contention`) compiladas no `SKILL.md` da squad para evitar colisões entre workers:

- **Banco de Testes Único (`singleTestDb`)**: quando marcado, orienta a squad a serializar suítes de testes (ex.: RSpec/SQLite) para impedir locks entre workers paralelos.
- **Isolamento Padrão (`defaultIsolation`)**: selecione `shared — Ondas sequenciais no mesmo workspace` ou `worktree — Git worktrees isolados para frentes paralelas`.
- **Variáveis de Ambiente Obrigatórias (`envVars`)**: pares chave/valor como `PARALLEL_WORKERS=1`.
- **Artefatos de Build Fora do Git (`gitIgnoredBuilds`)**: diretórios de build não versionados (ex.: `target/`, `dist/`, `tmp/`).
- **Arquivos de Alta Contenção (`conflictFiles`)**: manifestos ou arquivos compartilhados (chips vermelhos, ex.: `package.json`, `Cargo.toml`, `tauri.conf.json`, `db/schema.rb`) que não devem ser editados em paralelo.

#### Aba 5: `Preview & Diff`

Gera e exibe o resultado determinístico da compilação antes de qualquer escrita em disco:

- **Simular no projeto** (visível em Modo Global): escolha qualquer projeto do T3 Code para simular como o Preset Global compilaria naquele repositório.
- **Botão `Atualizar Diff`**: recalcula o preview determinístico (`SKILL.md`, `roles/*.md`, `.t3code/preset.jsonc` e `settings.json`).
- **Lista `Arquivos Alvo`**:
  - Exibe `settings.json (override)` (`projectSettingsOverrides`) seguido por `.t3code/preset.jsonc`, `.agents/skills/<slug>-squad/SKILL.md` e cada `roles/<id>.md`.
  - Cada item recebe um badge de estado: **Novo** (verde), **Modificado** (âmbar) ou **Idêntico** (neutro), além do badge global **Alterações pendentes** ou **Em dia**.
- **Visualizador à direita**:
  - Mostra o caminho completo do arquivo selecionado, o botão **Copiar Conteúdo** (`Copiado` após copiar) e o seletor de modo entre **Unified Diff** e **Markdown Compilado**.
- **Gravação**:
  - Em Modo Global, clique em **Salvar Preset Global** para persistir o arquivo em `~/.config/oh-my-t3code/presets/<id>.jsonc`.
  - Para gravar e sincronizar no projeto selecionado, clique em **Salvar & Sincronizar Projeto**: o backend cria o backup `settings.json.bak`, atualiza `settings.json` de forma atômica e escreve apenas os arquivos alterados no repositório.

---

## 3. Workflows recomendados do dia a dia

Os quatro fluxos abaixo cobrem as situações mais comuns ao trabalhar com múltiplas contas e projetos no T3 Code.

### Cenário 1: Primeiro setup com o T3 Code

1. Abra o `oh-my-t3code` (`bun run tauri:dev` ou app instalado) para inicializar os 4 presets seed em `~/.config/oh-my-t3code/presets/`.
2. Clique no ícone da barra de menus para abrir o **Popover**.
3. Em **Preset Global (Default)**, escolha o preset padrão da sua rotina (por exemplo `agy-dual` se usar duas contas Antigravity, ou mantenha `default` para Codex) e garanta que o toggle está em **Ativo**.
4. A partir desse momento, todos os projetos sem override passam a seguir esse padrão global em `~/.t3/userdata/settings.json`.

### Cenário 2: Projeto com squad manual existente (`.agents/skills/*-squad/`)

1. Abra o **Preset Studio** (`⌘,`).
2. Na barra lateral, localize o projeto marcado com squad detectada (ou clique em **+ Configurar Projeto** caso ele ainda não esteja na lista de overrides) e clique em **Importar Squad Existente**.
3. O **Reverse Importer** extrai papéis, modelos, skills, MCPs, escopo de arquivos e comandos de verificação para `<repo>/.t3code/preset.jsonc`.
4. Ajuste papéis, `extends` ou pontos de contenção nas abas do Studio.
5. Abra a aba **Preview & Diff**, confira o **Unified Diff** de `SKILL.md`, `roles/*.md` e `settings.json`, e clique em **Salvar & Sincronizar Projeto**.

### Cenário 3: Atingiu rate limit ou cota durante uma sessão

1. Abra o **Popover** na barra de menus com um clique esquerdo.
2. Se o problema afetou um projeto com override específico, clique diretamente no pill **⇄** do card desse projeto (ex.: `Agy Veca` ⇄ `Agy Principal` ou `Codex · gpt-6.1-sol` ⇄ `gpt-6.1-terra`).
3. Se o projeto segue o padrão global, clique no pill **⇄** dentro do card **Preset Global (Default)**.
4. Em segundos o `settings.json` é atualizado com backup `.bak` e a squad do projeto passa a usar a instância ou modelo alternativo.

### Cenário 4: Testar alterações de preset sem risco via Browser Preview

1. No diretório do projeto, execute `bun run dev` para subir o frontend na porta `1420` com `MockIpcStore` ativo (nenhum arquivo real em `~/.t3` ou `~/.config/oh-my-t3code` é tocado).
2. Acesse `http://localhost:1420` (ou diretamente `http://localhost:1420/?view=studio` e `http://localhost:1420/?view=popover`).
3. Experimente criar novos presets com `extends`, montar `fallbackChain`, testar filtros e inspecionar o **Unified Diff** gerado contra os 4 projetos simulados (`oh-my-t3code`, `cabrito`, `dashboard-meta`, `landing-page`).
4. Quando estiver satisfeito com a estrutura, reproduza ou aplique no app nativo (`bun run tauri:dev`).
