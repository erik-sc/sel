# Release 0.7.0 — consolidação

Status: **decidido** · 2026-10-19 — o Érik aprovou as seis recomendações (formatar tudo de uma vez; item 2 nesta release; sem assinatura de código; happy-dom + axe-core em dev; medir o backup antes de mover; mínimos de texto 10/12px ajustados na leitura) · branch `release/0.7.0` (de main @ dbe8df5, v0.6.3)

Nenhuma feature nova. Em seis dias o sel foi da 0.3 à 0.6.3; esta release paga o que ficou para trás:
desempenho com workspaces grandes, teclado e leitor de tela, falhas que hoje somem no console,
ferramentas do repositório, e os registros compartilhados que fazem toda release paralela conflitar.
O que o usuário vê muda pouco: avisos quando algo não salva, zoom lembrado, tudo alcançável pelo teclado,
databases grandes que respondem, um log para anexar ao feedback.

Cada item vira uma branch própria, cortada de `release/0.7.0`, com PR para `release/0.7.0`.
Cada seção é o brief do agente que vai implementá-la: tem que se sustentar sozinha.
Marcadores: **✅** = decidido.

Os números de linha abaixo foram levantados em main @ dbe8df5 e conferidos por amostragem; o agente
reconfere antes de mexer.

## Ondas

| Onda | Itens | Por quê |
|---|---|---|
| 0a (sozinha) | 1 Higiene do repositório | formatar e normalizar fins de linha toca todos os arquivos: tem que entrar antes de qualquer outra branch ser cortada |
| 0b (sozinha) | 2 Uma feature, uma pasta | reescreve os registros que todas as outras branches tocam |
| 1 (paralelo) | 3 Desempenho no processo principal · 4 Teclado e leitor de tela · 5 Falhas que aparecem · 6 Binário mais fechado | arquivos disjuntos entre si (ver "Toca em") |
| 2 | 7 Desempenho no renderer | mexe nas mesmas views de database que o item 4 (janelamento × navegação por teclado) |
| 1–2 | 9 Tarefas: capturar, refinar, agendar (9a → 9b → 9c) — **a pedido do Érik, a única feature nova da 0.7.0**; spec em  | 9a (datas e recorrência) quase não toca registros e pode correr junto do item 2; 9b depois do item 4 (mesmas listas, foco e aria); 9c depois de 9b |
| 2–3 | 10 Design system e Herman 64 — **a pedido do Érik (2026-10-22), aprovado no artefato** | toca o CSS de quase todas as telas e a pasta do Herman: entra depois do item 7 e antes do 8 |
| 3 | 8 Documentação e README | descreve o app e o código depois de tudo integrado |

**Disco.** Em 2026-10-19 o C: tinha **5,3 GB livres (99%)**, e cada worktree pediu ~5,4 GB na 0.6.x (memória
"selida-test-and-edit-gotchas"). Hoje não cabe nem uma worktree completa. As ondas 0a e 0b correm uma de cada vez
(cabem na cópia principal); antes da onda 1 (quatro sessões) é preciso liberar espaço ou rodá-la em sequência.

**Regras gerais para todos os agentes**
- Textos visíveis em pt-BR e en no padrão de tabela de cópia por feature; não existe framework de i18n.
- Nova chamada IPC segue o caminho que existir depois do item 2 (antes dele: `INVOKE` em `src/shared/api.ts` +
  handler + canal em `INVOKE_CHANNELS` de `src/preload/index.test.ts`).
- Depois do item 1: `npm run lint` verde também.
- `npm run typecheck` e `npm test` (Node 24) verdes antes do PR. UI: conferir na tela com o app buildado
  (`--user-data-dir` de rascunho, porta de debug única, fechar com `window.close()` pelo CDP).
- Itens de desempenho mostram no PR o antes e o depois, medidos do mesmo jeito.

---

## Decisões

1. **✅ Formatar o código inteiro de uma vez (item 1)?** **Sim**: um commit só de formatação,
   listado em `.git-blame-ignore-revs`, na onda 0a, com nenhuma outra branch aberta. A alternativa (formatar só
   arquivos tocados) deixa o estilo misturado por meses e cada PR com ruído de formatação.
2. **✅ O item 2 (registros por feature) entra nesta release?** **Sim**, logo depois do item 1: é o
   único momento em que nenhuma branch está em voo, e é o que torna as próximas releases paralelas baratas.
   Fazê-lo depois exige outra janela sem branches abertas.
3. **✅ Assinatura de código do instalador.** Pede comprar um certificado ou contratar um serviço de assinatura
   (custo recorrente, decisão sua). **Fica fora** desta release; só os fuses do Electron (item 6).
4. **✅ Dependências de desenvolvimento para acessibilidade (item 4).** **Sim** para `happy-dom` +
   `axe-core` só em dev (não entram no instalador). O teste de contraste dos presets é puro e não precisa de nada.
5. **✅ Backups fora do processo principal (item 3).** `VACUUM INTO` + `quick_check` trava o IPC uma vez por dia.
   **Medir primeiro** e só mover para um `utilityProcess` se passar de ~300 ms num arquivo de 200 MB.
6. **✅ Tamanho mínimo de texto (item 4).** Hoje Tiny vai a 6px e Body a 11px. Subir os mínimos
   para 10/12px e **ajustar na leitura** quem já tem um valor menor salvo, sem reescrever o setting.

---

## 1. Higiene do repositório

**Hoje.**
- Nenhum lint ou formatador: sem ESLint/Biome/Prettier, sem `.editorconfig`, sem script `lint` (package.json:8-17).
  Mesmo assim o código tem 36 comentários `eslint-disable` que nada lê (29 `no-control-regex`, 7
  `react-hooks/exhaustive-deps`, ex. src/main/security.ts, src/renderer/src/ui/Menu.tsx).
- O estilo é consistente por costume: aspas simples, sem ponto e vírgula, 2 espaços. Linhas longas: 1206 acima
  de 140 colunas, a maior com 899 (src/renderer/src/sky/SkyChart.tsx:118).
- Sem `.gitattributes`. O índice guarda LF; com `core.autocrlf=true` local, 573 de 683 arquivos de `src` estão
  em CRLF na cópia de trabalho. Edições por script tropeçam nisso (memória "mixed CRLF").
- `.claude/worktrees/` só é ignorado em `.git/info/exclude:7`, não no `.gitignore`. Há um cache solto em
  `src/renderer/src/node_modules/.vite`.
- TypeScript: só `strict: true` (tsconfig.node.json:7, tsconfig.web.json:9). As válvulas de escape são raras:
  3 `any` (todos em src/main/db/driver.ts:7-9), ~16 `!`, ~30 `as unknown as` fora dos testes.
- Dependências: nenhum Dependabot/Renovate; toda instalação usa `--no-audit` e nada roda `npm audit`.
  Actions fixadas por tag maior (`@v7`), não por SHA.

**Escopo.**
- `.gitattributes` (`* text=auto eol=lf`; `*.png *.webp *.ico *.woff2` binários) e `.editorconfig` (LF, UTF-8,
  2 espaços). Renormalizar (`git add --renormalize .`) num commit próprio.
- **Biome** como lint e formatador: uma dependência de dev só, coerente com "Light". Fixar o estilo que já
  existe (aspas simples, sem ponto e vírgula, 2 espaços, largura ~140). Regras ligadas: `noControlCharactersInRegex`,
  hooks do React (`useExhaustiveDependencies`), `noUnusedImports`, `noUnusedVariables`. Converter os 36
  `eslint-disable` em `biome-ignore` com o motivo, ou apagá-los quando a regra não se aplicar.
- ✅ Formatar tudo num commit só e listá-lo em `.git-blame-ignore-revs`.
- Scripts `lint` e `format`; job `lint` no ci.yml (Ubuntu, junto do typecheck).
- tsconfig, em passos: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`,
  `noImplicitOverride` agora. `noUncheckedIndexedAccess` fica para depois (anotar em 90-questions).
- `.github/dependabot.yml` semanal e agrupado, para npm e github-actions. Electron, electron-vite e os alvos de
  build de electron.vite.config.ts:15-17 num mesmo grupo (o build falha de propósito se o Electron não for 44).
- Job `audit` no CI: `npm audit --omit=dev --audit-level=high` (são 18 pacotes de produção).
- `.claude/worktrees/` no `.gitignore`; apagar o cache `.vite` solto.

**Fora do escopo.** Mudar o estilo do código (só fixar o que existe). `noUncheckedIndexedAccess`.
`exactOptionalPropertyTypes`. Fixar actions por SHA (o Dependabot passa a cuidar das versões).

**Toca em.** package.json, biome.json (novo), .gitattributes, .editorconfig, .git-blame-ignore-revs, .gitignore,
tsconfig.*.json, .github/workflows/ci.yml, .github/dependabot.yml, e todos os arquivos de `src` (formatação).

**Pronto quando.** `npm run lint`, `npm run typecheck` e `npm test` verdes. CI com os jobs lint e audit.
`git ls-files --eol src` mostra só `i/lf w/lf` depois de um checkout limpo. O commit de formatação não muda
comportamento: os testes passam sem alteração.

---

## 2. Uma feature, uma pasta

**Hoje.** Toda feature edita uns quinze arquivos centrais. Pomodoro tocou 14 arquivos fora da própria pasta
(5b4f2c9), o Céu ~20 (57c3449). Nos últimos 120 merges, os arquivos que mais mudaram dos dois lados foram:
README.md (17), src/shared/api.ts (16), src/main/ipc.ts (14), src/renderer/src/commands/builtin.ts (8),
src/preload/index.test.ts (8), Sidebar.tsx (6), menu.ts (5), main.tsx (5). O commit 556f4a3 descreve o conflito
típico: "writable settings, setting cleaners, IPC channel list and Settings palette entries".

Pontos quentes:
- `WRITABLE_SETTINGS` é **uma linha só** com 17 spreads (src/main/validate.ts:44); `settingValueFor` é uma
  cadeia de 13 `if` (validate.ts:170-189) e há nove funções `xSettingValue` quase iguais (196-306).
- `INVOKE` (api.ts:357-517) e `INVOKE_CHANNELS` (index.test.ts:118-259): toda feature acrescenta no mesmo lugar.
- Rótulos de comando em três listas: menu.ts, builtin.ts e shortcuts/catalog.ts. O switch de menuCommands.ts
  (35-144) não é exaustivo.
- Rotas em cadeias de ternários (Shell.tsx:78-94, briefing/route.ts:25-26) e numa lista `alive.add` (tabs.ts:402-407).
- Seções de Settings em `SECTIONS` (SettingsDialog.tsx:33-47) e de novo em `SETTINGS` (builtin.ts:59-72).
- Init do renderer numa lista de 11 chamadas (main.tsx:59-81).
- O processo principal importa código do renderer: `src/main/markdown.ts:20-29` e `src/main/ai/writes.ts:4-5`
  importam de `src/renderer/src/database/logic/` (90-questions #16). Esses 19 arquivos não usam `@/`, React nem `window`.

**Escopo.** Migrar **um registro por commit**, com os testes verdes em cada um:
1. **Settings.** Cada feature declara em `src/shared/<f>` um spec `{ keys | namespace, clean, dialogOnly?,
   syncedAt?, onChanged? }`. `WRITABLE_SETTINGS`, `settingValueFor` e os efeitos de `app:setSetting`
   (ipc.ts:222-256) viram um laço sobre os specs, com um helper genérico null/clean/throw no lugar das nove funções.
   Chaves do núcleo (theme, appearance, history, startup) num spec do núcleo.
2. **IPC.** Cada feature exporta seu fragmento de `INVOKE`, cada um com seu próprio `satisfies` (spread não pega
   propriedade sobrando). `INVOKE` junta núcleo + fragmentos e mantém o `satisfies` de cima. `INVOKE_CHANNELS`
   vira listas **literais** por namespace em `src/preload/reviewed/<ns>.ts`: a revisão humana da ponte continua
   explícita (index.test.ts:88). Apagar os 12 `vi.mock('@shared/*')` (index.test.ts:29-40) se os aliases do
   vitest.config.ts já os dispensarem.
3. **Handlers do main.** Cada `register.ts` exporta `{ namespace, register(ctx) }`; `ctx` dá `repo`, `ready`,
   `changes(origin)`, `noteLocalChange()`, `recording()` e `feature<'briefing'>()` (acesso preguiçoso entre
   features, porque ipc.ts:313-410 tem dependências reais entre elas). `src/main/features.ts` é a única lista.
   Uma checagem de tipo garante que todo namespace tem handler.
4. **Comandos.** Um spec por comando em shared: `{ id, accelerator, menu?: { submenu, label, order },
   palette: { title, keywords }, catalog: { group, label } }`. `MenuCommand`, `APP_SHORTCUTS`, os submenus de
   menu.ts, as linhas `menu(...)` de builtin.ts e o catálogo saem dele. No renderer, `menuHandlers` por feature,
   juntados num `Record<MenuCommand, …>` completo: o switch passa a ser exaustivo por tipo.
5. **Telas.** Ids de rota num módulo folha (sem imports de feature) que tabs.ts e as features importam; descritores
   `{ route, title, alias?, Host: lazy(() => import('…')) }` no lugar dos ternários e do `alive.add`.
6. **Seções de Settings.** `{ id, label, keywords, order, Section: lazy(() => import('…')) }` por feature;
   SettingsDialog e a paleta leem a mesma lista; `SettingsSection` (store/ui.ts:33) derivado dela.
7. **Hosts e init do renderer.** `src/renderer/src/features.ts` dá `init()` na ordem declarada e os overlays do
   Shell (Shell.tsx:95-112).
8. **#16.** Mover `src/renderer/src/database/logic` para `src/shared/database` e apontar os dois lados para `@shared`.
   Tirar a exceção de tsconfig.node.json:15.

Regras: registros são dados folha, nunca importam Hosts ou componentes de Settings de forma estática (quebraria o
code splitting). Ordens globais persistidas ficam centrais e não mudam: `SIDEBAR_ITEMS` (src/shared/sidebar.ts:16-34),
`PATHS` e chaves `STATE_*` do sync.

**Fora do escopo.** Os arquivos de settings sincronizados (format.ts/engine.ts mudam pouco e cada um tem merge
próprio). Os itens da barra lateral (sidebarItems.tsx já é um registro). Os blocos sob medida da preload
(`ai.onEvent`, envios binários de meetings). Mudar qualquer comportamento.

**Toca em.** src/shared/api.ts, src/preload/index.ts e index.test.ts, src/main/validate.ts, src/main/ipc.ts,
src/main/menu.ts, src/shared/shortcuts.ts, src/renderer/src/shell/{menuCommands.ts,Shell.tsx,SettingsDialog.tsx},
src/renderer/src/commands/builtin.ts, src/renderer/src/shortcuts/catalog.ts, src/renderer/src/store/{tabs.ts,ui.ts},
src/renderer/src/main.tsx, src/renderer/src/briefing/route.ts, e um arquivo novo por feature.

**Pronto quando.** Typecheck, lint e testes verdes em **cada** commit. Os testes de lista que já existem continuam
valendo (ipc.test.ts:70 compara com `INVOKE`, shortcuts.test.ts:24 colisão de teclas, catalog.test.ts:31 cobertura).
Um teste com uma feature de mentira mostra que acrescentar uma feature com uma chamada IPC, um setting, um comando e
uma tela toca só a pasta dela mais uma linha em cada lista de features. O app buildado abre todas as telas, Settings
e comandos como antes (conferir na tela). `docs/codebase-knowledge/50-conventions.md` ganha "Adicionar uma feature".

---

## 3. Desempenho no processo principal

**Hoje.** Não há números de base registrados; existem as ferramentas para medir: `SEL_BENCH=1` em
src/main/db/bench.test.ts (workspace de 50k blocos) e `--sel-trace-startup` (src/main/trace.ts:10-28).
- **Sync ocioso refaz tudo.** Cada upload, inclusive o ciclo de 5 min sem mudanças, lê todas as linhas
  (`syncRows`, repository.ts:1640-1643), calcula SHA-1 de todas (`fingerprintPages`, sync/format.ts:350-394) e
  faz parse de `props` e `content` de cada linha (`workspaceFromRows`, format.ts:397-409) **antes** de ver que
  nada mudou (sync/engine.ts:975-979 contra :1018).
- **Backlinks varrem tudo a cada mudança.** "Linked from" roda `instr(props, link)` sobre todos os blocos vivos
  (db/search.ts:147-151) 800 ms depois de **qualquer** evento de mudança, inclusive a própria digitação
  (editor/Backlinks.tsx:31-34).
- **Snapshot da database inteira.** Editar as props de uma linha suja a database pai (repository.ts:783-785), e o
  snapshot dela leva todas as linhas (db/versions.ts:665-690): o primeiro toque numa linha, por sessão, é O(linhas),
  dentro da transação de escrita. `flushVersions` no fechamento faz o mesmo para tudo que estiver sujo.
- **Consultas sem índice em JSON.** `listFavorites` (repository.ts:1165-1172), `listArchived` (:1206-1212),
  `listDatabases` (:1238-1244), `linkedViewsOf` (:419-425). Como linhas de database são `type='page'`, crescem
  com o número de linhas.
- **Backup diário síncrono.** `VACUUM INTO` + `quick_check` + contagem no processo principal (data/backups.ts:228-245).

**Escopo.**
- **Base primeiro.** Rodar o bench e anotar os números no PR antes de mudar. Acrescentar ao bench: ciclo de sync
  ocioso e com uma edição a 50k blocos, backlinks, primeira edição de linha numa database de 5k linhas, e `takeBackup`.
- **Sync:** calcular só as impressões digitais primeiro; montar o workspace só das páginas cuja impressão difere de
  `sync_state`; sair cedo quando nenhuma difere. Melhor ainda: um conjunto de páginas sujas mantido pelo repositório
  (de `drainChanges`/`containerOf`), que pula `syncRows` quando está vazio. O formato no repositório não muda.
- **Backlinks:** tabela `page_links(from_block, to_page)` mantida na escrita (migração com `user_version`, preenchida
  uma vez). O renderer só recarrega quando o evento de mudança traz ids com marcas de link, ou vem de outra origem.
- **Snapshot da database:** o snapshot próprio da database guarda schema e views, não os corpos das linhas (cada
  linha é uma página com histórico próprio). Restaurar uma versão antiga de database continua funcionando: conferir
  e testar o que acontece com as linhas.
- **Índices de expressão** (ou colunas geradas) para `$.sourceId`, `$.favorite`, `$.archivedAt`.
- ✅ Backup: medir; mover para `utilityProcess` só se passar do limite.

**Fora do escopo.** Paginar as linhas de database no IPC (fica para quando o item 7 mostrar que precisa). Trocar o
formato do sync. Mudar a política de versões (intervalos, limites).

**Toca em.** src/main/sync/{engine.ts,format.ts}, src/main/db/{repository.ts,schema.ts,search.ts,versions.ts},
src/main/data/backups.ts, src/main/db/bench.test.ts, src/main/sync/sync.scale.test.ts,
src/renderer/src/editor/Backlinks.tsx (só o gatilho de recarga).

**Pronto quando.** Antes e depois no PR, mesma máquina, mesmo bench. Metas: ciclo de sync ocioso a 50k blocos sem
parse de JSON (contagem zero de `workspaceFromRows` num teste); backlinks a 50k blocos ≥10× mais rápido; primeira
edição de linha numa database de 5k linhas sem custo proporcional às linhas. Testes de migração (`user_version`
anterior → novo, `page_links` preenchida igual à varredura antiga), de sync (sem mudanças → nenhum arquivo escrito) e
de versões (restaurar database antiga).

---

## 4. Teclado e leitor de tela

**Hoje.** A base é boa: um `Modal` compartilhado com trap de foco e devolução (ui/Modal.tsx:36-85), `Menu` com
setas e `aria-activedescendant` (ui/Menu.tsx:81-129), paleta e QuickFind como combobox corretos, `:focus-visible`
global com token (styles/global.css:227-240), `prefers-reduced-motion` respeitado em CSS e JS (sky/motion.ts:6-15,
herman/Figure.tsx:31). O que falta:
- **Board e calendário da database só funcionam com o mouse.** Cartões são `div` sem `tabIndex` nem tecla
  (database/views/BoardView.tsx:273-287); dias e eventos idem (CalendarView.tsx:89-138).
- **Grade da tabela muda.** Um container `role="grid"` com navegação completa (TableView.tsx:272-302, :357), mas
  linhas e células sem `row`/`gridcell` nem `aria-activedescendant` (TableRow.tsx:92-97): a célula focada é só visual.
  Opções de select são `div` sem `option` (SelectEditor.tsx:216-258).
- **Diálogos sem nome visível.** `Modal` usa `aria-label` em string, nunca `aria-labelledby` (Modal.tsx:102);
  `Popover` sempre `role="dialog"` sem rótulo (Popover.tsx:158); a tela de descanso do Fechar o dia é `aria-modal`
  sem trap nem devolução de foco (notebook/CloseDayScreen.tsx:48-69).
- **Editor mudo.** Cada bloco é `role="textbox"` sem rótulo; títulos não expõem nível, listas não são `listitem`
  (editor/EditableText.tsx:247-253, BlockView.tsx:69-77). O menu `/` é listbox sem ids nem `aria-activedescendant`
  (editor/menus.tsx:48-70). Mover, indentar e apagar blocos pelo teclado já funciona (editor/keyboard.ts:46-49,
  PageEditor.tsx:239-278), mas nada é anunciado. Os menus de IA da barra de seleção não têm teclado
  (SelectionToolbar.tsx:276-309).
- **Árvore e abas pela metade.** A árvore tem Enter/Esquerda/Direita/F2 mas não Cima/Baixo/Home/End, e cada linha é
  uma parada de Tab (shell/PageTree.tsx:179-214); mover página só arrastando. Nenhum lugar trata a tecla Menu nem
  Shift+F10. As abas não têm Home/End nem reordenar pelo teclado (TabBar.tsx:83-95).
- **Contraste não checado.** Nenhum cálculo de contraste no código. `--text-tertiary` padrão fica abaixo de 4,5:1
  nos dois temas (#7c766a sobre #faf8f4 ≈ 4,25:1, tokens.css:142/:116; #7f7a70 sobre #1d1c1a ≈ 4,0:1, :224/:200;
  cálculo, não medição). Os presets retrô nunca foram checados (appearance/presets.ts).
- **Zoom esquecido.** Ctrl+Plus/−/0 funcionam pelos papéis do menu (src/main/menu.ts:122-124), mas o nível não é salvo
  e não há atalho explícito Ctrl+= (layouts que não o geram).
- **Imagens:** `alt` é a legenda, vazio sem legenda (editor/blocks.tsx:244).
- Nenhum teste de acessibilidade; o vitest roda sem DOM (vitest.config.ts:11).

**Escopo.**
- Board: tabIndex móvel por coluna, Enter abre, tecla Menu/Shift+F10 abre o menu da linha, Ctrl+Alt+setas move o
  cartão de grupo (reaproveitando a ação que o arrastar já chama). Calendário da database: o mesmo por dia.
- Tabela: `row`/`gridcell` + `aria-activedescendant` (ou foco móvel); select com `listbox`/`option` e ids.
- `Modal` aceita `labelledBy` e passa a apontar para o título visível; `Popover` aceita papel e rótulo (nenhum quando
  contém um `menu`); tela de descanso com trap e devolução de foco ao botão Fechar.
- Editor: `aria-roledescription` com o tipo do bloco, `aria-level` nos títulos, `aria-placeholder`; ids nas opções do
  `/` com `aria-controls` + `aria-activedescendant` no bloco ativo; uma região `polite` que anuncia "Movido para cima",
  "Indentado", "3 blocos apagados". Teclado nos menus de IA da barra de seleção.
- Árvore: Cima/Baixo/Home/End com tabIndex móvel (uma parada de Tab), tecla Menu/Shift+F10, Alt+Shift+setas move a
  página. Abas: Home/End, tecla Menu, Ctrl+Shift+PageUp/PageDown reordena.
- Contraste: `contrastRatio()` em appearance/color.ts e um teste que exige ≥4,5:1 para text/secondary/tertiary sobre os
  fundos e ≥3:1 para `--focus-ring`, em **todo preset, claro e escuro**. Ajustar os tokens que falharem, começando pelo
  `--text-tertiary` padrão. Presets retrô podem ganhar exceção documentada só se a fidelidade ao original exigir.
- ✅ Mínimos de tamanho de texto: 10px (Tiny) e 12px (Body), aplicados na leitura; o setting salvo não é reescrito.
- Zoom salvo por dispositivo (`webContents.setZoomFactor` na abertura, lido de um setting local) e Ctrl+= explícito.
- Imagem: campo "Texto alternativo" no menu do bloco, separado da legenda.
- ✅ Teste com axe (happy-dom) para Modal, Menu, QuickFind, Settings e a tabela.
- Atalhos novos conferidos em src/shared/shortcuts.ts e no teste de colisão.

**Fora do escopo.** Modo de alto contraste do Windows (`forced-colors`). Ajuste de movimento ou transparência dentro do
app (seguem o sistema). Reordenar colunas e redimensionar pelo teclado.

**Toca em.** src/renderer/src/database/views/{BoardView,CalendarView,TableView,TableRow}.tsx,
database/SelectEditor.tsx, ui/{Modal,Popover}.tsx, notebook/CloseDayScreen.tsx, editor/{EditableText,BlockView,menus,
SelectionToolbar,blocks}.tsx, shell/{PageTree,TabBar}.tsx, appearance/{color.ts,presets.ts,schema.ts},
styles/tokens.css, src/main/menu.ts e src/main/index.ts (zoom).

**Pronto quando.** Na tela, só com o teclado: abrir e mover um cartão do board e um evento do calendário; mudar uma
página de pai e de posição na árvore; reordenar uma aba. Com o Narrador: a tabela lê "linha N, coluna X, valor"; um
título lê o nível; o `/` lê a opção destacada; Ctrl+Shift+Cima anuncia. Teste de contraste verde para todos os presets.
Zoom volta ao reabrir. Axe sem violações sérias nos componentes listados.

---

## 5. Falhas que aparecem

**Hoje.**
- **Escrita de database falha calada.** `run()` em src/renderer/src/database/actions.ts:37-40 faz
  `applyOps(ops).catch((error) => console.error(...))`: toda célula, schema e view que não salva some no console.
  O editor já avisa e desfaz desde 8af8f3b (editor/controller.ts:212-227). (A linha #21 de 90-questions.md voltou a
  dizer "No" num merge posterior: corrigir.)
- **Erros do processo principal se perdem.** `unhandledRejection` e `uncaughtException` só vão para `console.error`
  (src/main/index.ts:384-385); no app instalado ninguém vê. Não há arquivo de log.
- **Renderer:** `unhandledrejection` vira toast (main.tsx:35-37), mas não há `window.onerror`, e o único
  ErrorBoundary está no PageHost (shell/PageHost.tsx:24-35): Shell e a janela de quick add não têm.
- **Apply do Herman não se desfaz.** É uma transação só (ai/applyActions.ts:23), mas fica fora do histórico do editor
  e a UI não oferece Desfazer. Um bloco `sel-actions` malformado é descartado e só os testes sabem (`rejected`,
  src/shared/actions.ts:232-273; AssistantPanel.tsx:470-487) — #24.
- **`addView` devolve id fantasma** quando a database não está pronta (database/actions.ts:226-232; #27).
- **Seed da primeira vez falha calado:** workspace vazio sem explicação (src/main/index.ts:360-368; #28).
- **Estados que mentem:** a gravação do manifesto `failed` de uma reunião é engolida (meetings/service.ts:800); falhas de
  parar/pausar/retomar a gravação também (renderer meetings/recorder.ts:165, 175, 183) — a UI pode dizer "pausado"
  com o main gravando. Ler os settings de alarmes disparados/adiados devolve `{}`/`[]` em erro (alarms/service.ts:92, 119),
  o que pode disparar tudo de novo. `listBackups` devolve `[]` se o `readdir` falha (data/backups.ts:77), e a recuperação
  na abertura não distingue "sem backups" de "pasta ilegível".
- **Sem teste:** `src/main/data/startup.ts` (recuperação na abertura), `renderer/meetings/recorder.ts`,
  `renderer/ai/applyActions.ts`, `renderer/store/tree.ts`, e a pasta `renderer/feedback` inteira.
- **Testes instáveis:** sleeps fixos seguidos de asserção (ai/tools.test.ts:167, meetings/whisper/whisper.test.ts:689).
  As suítes de sync pulam caladas sem git (sync/harness.ts:24, sync/security.test.ts:333).
- **Código morto:** `ROLLUP_FUNCTIONS` (database/logic/rollup.ts:19), `sameHome` (shared/home.ts:56),
  `figureById` (shared/sky/figures.ts:84).

**Escopo.**
- `run()` passa pelo mesmo `notifyError` limitado do editor e reverte o estado otimista.
- **Log local.** Arquivo rotativo em `<userData>/logs` (ex. 1 MB × 3), escrito pelos handlers globais e pelos
  `console.error` do main; nunca conteúdo de página nem URL de calendário. Settings → Geral → Dados: "Abrir pasta de
  logs". O diálogo de Feedback oferece anexar as últimas linhas ao item salvo (o app continua sem enviar nada).
  Depois de `uncaughtException`, avisar a janela: "Algo deu errado. Salve e reinicie o sel".
- `window.onerror` no renderer; ErrorBoundary na raiz do Shell e na janela de quick add, com "Recarregar".
- **Apply desfazível:** snapshot de versão das páginas tocadas antes de aplicar, toast "Aplicado · Desfazer" (molde de
  database/actions.ts:735). Linha de status quando `rejected > 0`: "Herman propôs mudanças que não consegui ler (n)".
- `addView` com a guarda de `ready` (como `duplicateView`, :241-246), retorno `string | undefined`, chamador protegido.
- Seed: manter a nova tentativa e mostrar um aviso único ao renderer.
- Distinguir "ilegível" de "vazio" em alarms/service.ts, alarms/gate.ts:44 e data/backups.ts:77; avisar ou registrar no
  log. Repetir ou registrar a gravação do manifesto `failed`; o recorder avisa quando parar/pausar/retomar falha.
- Testes novos: data/startup.ts, recorder.ts, applyActions.ts, store/tree.ts, feedback. Trocar sleeps por `until()`.
  No CI, as suítes de sync **falham** sem git em vez de pular (variável `CI`).
- Apagar os três exports mortos.

**Fora do escopo.** Mandar relatórios de erro para fora da máquina (princípio "Still"). crashReporter. Revisar os
outros ~85 `.catch(() => undefined)` inofensivos (parse de URL, limpeza de temporários, pré-carga de chunks).

**Toca em.** src/main/index.ts, src/main/log.ts (novo), src/renderer/src/main.tsx, shell/Shell.tsx,
src/renderer/src/tasks (raiz do quick add), database/actions.ts, ai/{applyActions.ts,AssistantPanel.tsx},
src/main/meetings/service.ts, renderer/meetings/recorder.ts, src/main/alarms/service.ts, renderer/alarms/gate.ts,
src/main/data/{backups.ts,startup.ts}, renderer/backup/DataSettings.tsx, feedback/, os testes citados.

**Pronto quando.** Testes: escrita de database recusada mostra o aviso e reverte; `addView` sem `ready` não devolve id;
Apply + Desfazer volta ao estado anterior; `rejected > 0` aparece; settings ilegíveis de alarme não disparam de novo;
`startup.ts` com backup bom, ruim e pasta ilegível; o log gira e nunca contém texto de página (teste com conteúdo
marcado). Na tela: forçar uma falha de escrita e ver o aviso; abrir a pasta de logs.

---

## 6. Binário mais fechado

**Hoje.** A postura de segurança da janela é forte (sandbox, contextIsolation, CSP `default-src 'none'`, guardas de
navegação, IPC com remetente checado — src/main/index.ts:113-262, src/renderer/index.html:17-20). Faltam os **fuses do
Electron**: nada em electron-builder.yml, então `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`,
`EnableEmbeddedAsarIntegrityValidation` e `OnlyLoadAppFromAsar` estão no padrão. `RunAsNode` não pode sair: o app usa
`ELECTRON_RUN_AS_NODE` para a IA, o host de ferramentas, o whisper e o MCP externo (src/main/ai/command.ts:161,
ai/toolhost.ts:154, meetings/whisper/run.ts:194/274, external/snippets.ts:13-14). O instalador não é assinado
(electron-builder.yml:2).

**Escopo.**
- Fuses via electron-builder (ou hook `afterPack` com `@electron/fuses`): `EnableNodeOptionsEnvironmentVariable` off,
  `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on,
  `EnableCookieEncryption` on. `RunAsNode` fica ligado, com um comentário dizendo por quê.
- Conferir que os processos filhos que dependem de `ELECTRON_RUN_AS_NODE` não usam `NODE_OPTIONS` nem `--inspect`.
- ✅ Assinatura de código fica fora desta release.

**Fora do escopo.** Servir a página por protocolo próprio em vez de `file://` (mudança grande, anotar em 90-questions).
Tirar `'unsafe-inline'` de `style-src`.

**Toca em.** electron-builder.yml, package.json (se `@electron/fuses` entrar), build/ (hook), README (seção de segurança
do código, se houver).

**Pronto quando.** `npm run pack`, depois `npx @electron/fuses read --app release/win-unpacked/sel.exe` mostra os fuses
esperados. O app empacotado abre, o Herman responde (fake CLI), uma transcrição de teste roda, e o MCP externo conecta
(conferir na tela).

---

## 7. Desempenho no renderer

Depende do item 4 (mesmas views) e se beneficia do 3 (bench com base).

**Hoje.**
- **Toda escrita copia o cache inteiro.** `putBlocks` (store/blocks.ts:65), `dropBlocks` (:82-83) e `applyOpsToMap`
  (store/ops.ts:32) copiam o mapa todo; `useBlocks(rowIds)` mapeia todos os ids a cada atualização do store
  (blocks.ts:217-226). O contexto das células relacionadas percorre todas as linhas relacionadas a cada tick
  (database/related.tsx:55-80).
- **Só a tabela é janelada,** e só acima de 200 linhas (views/tableWindow.ts:10-14). Board (BoardView.tsx:196), galeria
  (GalleryView.tsx:98), lista (ListView.tsx:57) e calendário (CalendarView.tsx:121) desenham todas.
- **Rollups não têm memo:** `computeRollup` roda a cada `readCell` (logic/rollup.ts:259-271, logic/cell.ts:27), ou seja,
  em filtro, ordenação e render. O memo das fórmulas cai sempre que o contexto relacionado muda (formula.ts:354).
- **Editar o título de uma linha recarrega a árvore inteira:** linhas são páginas, e `refreshTree` recarrega a raiz e
  todas as listas filhas carregadas (store/tree.ts:109-120).
- As linhas de uma database chegam todas num só IPC (database/resolved.ts:42-44, repository.ts:693-696).

**Escopo.**
- Bench novo (vitest, sem DOM) com uma database de 5k linhas: custo de um `applyOps` de uma célula + avaliação dos
  seletores. Medir antes.
- Store: contador de versão por id (ou `Map` com conjunto de mudanças) em vez de copiar o mapa; seletor da lista de
  linhas por database.
- Janelar lista, galeria e colunas do board, mantendo a navegação por teclado do item 4 (o item focado nunca sai do DOM).
- Memo de rollup por (linha, contexto); memo de fórmula que não cai com mudança irrelevante do contexto.
- `refreshTree` ignora mudanças em linhas de database (elas não aparecem na árvore, PageTree.tsx:120).
- Medir de novo; paginar o IPC das linhas só se, depois disso, abrir uma database de 5k linhas ainda passar de ~500 ms.

**Fora do escopo.** Janelar o editor de páginas. Trocar zustand.

**Toca em.** src/renderer/src/store/{blocks.ts,ops.ts,tree.ts}, database/{related.tsx,DatabaseView.tsx,resolved.ts},
database/views/{ListView,GalleryView,BoardView}.tsx, database/logic (ou src/shared/database depois do item 2)/{rollup.ts,
formula.ts,cell.ts}.

**Pronto quando.** Antes e depois no PR: uma edição de célula numa database de 5k linhas ≥5× mais barata no bench; rolar
um board e uma galeria de 5k linhas sem quadros acima de 50 ms (Performance do DevTools pelo CDP, no app buildado).
Os testes de fórmula/rollup a 5k linhas (formula.test.ts:660-706) com rollups e relações incluídos. A navegação por
teclado do item 4 continua funcionando nas views janeladas.

---

## 10. Design system e Herman 64

Status: **aprovado** · 2026-10-22 — o Érik aprovou o design system do artefato
(https://claude.ai/artifact/DAe7kc5iFdEnhrNqroUmYs), pediu para entrar na 0.7.0 e autorizou baixar as fontes.
Branch `claude/design-system-herman`, de `release/0.7.0`.

**Hoje.** Visual "Zen" (papel quente, índigo, serifa nos títulos, cantos 4–18px, sombras difusas e blur nos
overlays), sete "estilos de janela" (skins retrô) em Settings → Aparência, o título "sel" no canto superior
esquerdo, e o Herman como figura de uma linha só (src/renderer/src/herman/Figure.tsx + poses.ts).

**Escopo.**
- **Estilos de janela saem** (feito): skins.ts, skins/*.css, os 7 presets que os usavam, o seletor "Window style";
  aparências salvas com `skin` carregam sem ele.
- **Tokens** (tokens.css, espelhados em appearance/schema.ts): cantos 0 (2px em checkbox e código, pílula em
  toggles), sombra "carimbo" (3px 3px, sem desfoque) + moldura de 1px em tinta em tudo que flutua, sem blur;
  cores novas `frame`, `paper-sunk`, `grid-dot`, `night`, `night-ink`; o resto da paleta fica.
- **Fontes empacotadas** (OFL, sem rede): Newsreader para título e texto da página, IBM Plex Mono para interface,
  rótulos, metadados e atalhos. Sans do sistema só em frases longas de interface.
- **Componentes**: botões como palavra entre colchetes; barra lateral em mono com glifos e a árvore `├─ └─`;
  item escolhido com fio de 2px em `accent`; chão com grade de pontos; menus e diálogos com moldura + carimbo e
  `>` na linha ativa; tarefas `[ ]`/`[x]`; toasts com `[ok]`/`[erro]`; rótulos de grupo em CAIXA ALTA mono.
- **O título "sel" no canto superior esquerdo sai** (pedido do Érik, 2026-10-22).
- **Herman 64**: o Herman em 3D low-poly estilo PS1, em tiras de quadros PNG (84 px, ampliadas 2×/3× com
  `image-rendering: pixelated`), oito animações (respirando, girando, acenando, pensando, falando, dormindo,
  aparecendo, comemorando) no lugar das poses do Figure, nos mesmos lugares (canto, painel, Hoje, Settings).
  O gerador (renderizador PS1 + rig + skins) entra em `scripts/herman64/` para refazer as tiras.
- **Skins do Herman**: 12 (Clássico, Mago das estrelas, Monge zen, Hacker, Jardineiro, Astronauta, Pirata,
  Detetive, Escriba, **Pedra**; Papai Noel em dezembro e Abóbora em outubro). A Pedra (três pedras empilhadas
  com olhos, pedido do Érik em 2026-10-22) não usa o corpo do Herman: tem rig e animações próprias com os mesmos
  oito nomes (as pedras respiram, a de cima balança para dizer olá, pensa girando devagar, cai uma por uma ao
  aparecer, pulam em sequência ao comemorar). Setting `herman.skin`, **local como as outras preferências
  do Herman** (sincronizar pediria um arquivo novo no motor de sync: fica para depois); escolha em
  Settings → Herman com as miniaturas. As sazonais só aparecem no mês delas (✅ desligadas por
  padrão: um interruptor "Skins da estação" as libera).
- Com "reduzir movimento", o Herman fica no primeiro quadro.

**Fora do escopo.** Tokenizar o espaçamento solto do CSS (fica para depois, ver item 8). WebGL ao vivo para o
Herman (as tiras bastam). Redesenhar os presets de cor além do que os tokens novos pedem.

**Como ficou (2026-10-22).** Feito na branch `claude/design-system-herman`:
- Tokens: cantos 0 (2px no xs), `--radius-pill` 0 (interruptores e chips quadrados), sombra carimbo em
  popover/menu/diálogo/toast, sem blur; novos `--frame`, `--bg-sunk`, `--grid-dot`. Os presets Glass e
  derivados recebem de volta sans do sistema, mono antigo, 14px, blur e pílula (bloco GLASS).
- Fontes: Newsreader e IBM Plex Mono, latin, woff2, em `src/renderer/src/styles/fonts/` com as licenças OFL;
  `@fontsource/*` só em devDependencies, como origem dos arquivos.
- Botões entre colchetes, primário com carimbo; menus com `>` e separadores tracejados; toasts com `[ok]`/`[!]`;
  caixas de tarefa quadradas (editor, databases, Hoje); callout em `--bg-sunk`; texto da página em serifa.
- Barra lateral: sem o título "sel", grade de pontos, item escolhido com fio índigo, rótulos em caixa alta.
- Herman 64: `herman/Herman64.tsx` (poses → animações), 12 skins × 9 PNGs gerados por
  `node scripts/herman64/generate.mjs`, `herman.skin` + `herman.seasonalSkins`, seletor em Settings → Herman.
- **Ficou para depois:** a árvore `├─ └─` em ASCII na barra lateral (pede mudar o componente da árvore) e os
  botões de janela (minimizar/maximizar/fechar), que continuam redondos.

**Toca em.** src/renderer/src/styles/*, appearance/schema.ts, presets.ts e testes de contraste; CSS das telas
(shell, editor, database, menus, dialogs, toasts); shell/Sidebar (título); herman/* (Figure → Herman64);
src/shared/settings.ts (`herman.skin`, `herman.seasonalSkins`); HermanSettings.tsx; package.json (@fontsource).

**Pronto quando.** Lint, typecheck e testes verdes; o teste de contraste passa nos dois temas; o app buildado
mostra o visual novo nas telas principais (página, Hoje, Tarefas, painel do Herman, Settings), o Herman 64
animado e a troca de skin funcionando e sincronizando.

---

## 8. Documentação e README

**Hoje.** O README diz "All style values live in one file, tokens.css" (README.md:158), mas há ~2264 `px` soltos no CSS
fora de tokens.css (database.css 341, editor.css 199, shell.css 162) — #20. `90-questions.md` tem a #21 revertida e
números de linha velhos (#25 cita repository.ts:829-853, hoje :1001-1003 e :254-270). `50-conventions.md` ainda diz que
os aliases do vitest não resolvem, embora vitest.config.ts:16-20 resolva desde 258f7b9. README.md é o arquivo com mais
conflitos em merges (17 nos últimos 120).

**Escopo.** Último passo, depois de 1–7 integradas.
- README: reescrever a frase dos tokens ("cores, fontes e raios ficam em tokens.css; o layout usa medidas próprias");
  "Work on it" com `npm run lint`; seção curta de segurança (fuses, sandbox) e onde ficam os logs; mencionar o teclado
  e o zoom lembrado onde couber.
- codebase-knowledge: atualizar 00-overview (lint, CI), 50-conventions ("Adicionar uma feature", depois do item 2),
  90-questions (#16, #20, #21, #24, #25, #27, #28 fechados ou atualizados; novas perguntas abertas: `noUncheckedIndexedAccess`,
  protocolo próprio, assinatura de código), 30-flows/startup.md se o item 3 mexer na abertura.
- Descrever o visual novo (item 10): o design system zen/digital/ASCII/brutalista, as fontes empacotadas,
  o Herman 64 e as skins; tirar a menção aos estilos de janela.
- Versão 0.7.0 em package.json.

**Fora do escopo.** Quebrar o README em fragmentos por feature (resolveria os conflitos de README, mas muda o jeito de
escrever o README: discutir numa release futura). Tokenizar o espaçamento do CSS.

**Pronto quando.** Cada afirmação nova do README confere com o app buildado. O agente `verifier` não encontra citação
quebrada em docs/codebase-knowledge.
