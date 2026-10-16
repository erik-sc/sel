# Release 0.6.0 — specs

Status: **onda 1 decidida** (1–5) · Jardim em design numa sessão própria · 2026-10-15 ·
branch `release/0.6.0` (de main @ 5591a5a, v0.5.0)

Cada feature vira uma branch própria, cortada de `release/0.6.0`, com PR para `release/0.6.0`.
Cada seção abaixo é o brief do agente que vai implementá-la: tem que se sustentar sozinha.
Marcadores: **❓** = decisão pendente do Érik · **✅** = decidido.

## Ondas

| Onda | Features | Por quê |
|---|---|---|
| 1 (paralelo) | 1 Arquivar · 2 Home · 3 Notificações · 4 Meditações · 5 Pomodoro | independentes entre si |
| 2 | 6 Jardim | lê Meditações (4) e escuta o fim de pomodoro (5) |
| 3 | 7 README | descreve o app depois de tudo integrado |

**Registros compartilhados** (conflitos esperados, resolver mantendo os dois lados):
`src/shared/api.ts` (INVOKE, MenuCommand), `src/preload/index.test.ts` (INVOKE_CHANNELS),
`src/main/validate.ts` (WRITABLE_SETTINGS, settingValueFor), `src/renderer/src/commands/builtin.ts` (SETTINGS e
comandos), `src/shared/shortcuts.ts`, `src/main/menu.ts`, `src/renderer/src/shell/menuCommands.ts`,
`src/renderer/src/shell/Sidebar.tsx`, `src/renderer/src/store/tabs.ts` (rotas), `src/renderer/src/shell/SettingsDialog.tsx`.

**Atalhos livres reservados:** Ctrl+Alt+H (home), Ctrl+Alt+P (pomodoro), Ctrl+Alt+G (jardim).

**Regras gerais para todos os agentes**
- Textos visíveis em pt-BR e en no padrão de tabela de cópia por feature (como `src/renderer/src/notebook/copy.ts`);
  não existe framework de i18n.
- Nova chamada IPC: `INVOKE` em `src/shared/api.ts` + handler + canal em `INVOKE_CHANNELS` (`src/preload/index.test.ts`).
- `npm run typecheck` e `npm test` (Node 24) verdes antes do PR. UI: conferir na tela com o app buildado
  (ver memória "selida-test-and-edit-gotchas": `--user-data-dir` de rascunho, porta de debug única).

---

## 1. Arquivar páginas

**Hoje.** Só existe a lixeira. `deleteOne` (src/main/db/repository.ts:793-815) tira a página do `content` do pai e
seta `trashed_at`; restaurar recoloca sob o pai (:955-973). Não há conceito de arquivo nos dados nem na UI.
Favoritos são o molde de uma flag em `props`: toggle por `applyOps update props {favorite: true|null}`
(src/renderer/src/shell/actions.ts:50-53), consulta por `json_extract` (repository.ts:1091-1100), merge do sync
já trata props chave a chave (src/main/sync/merge.ts:10, :521) — **prop nova não exige mudança no sync**.

**Escopo.**
- Nova prop `archivedAt?: number` em `BlockProps` (src/shared/types.ts:49-50). Arquivar = setar; desarquivar = `null`.
  A página **continua no lugar** (pai e `content` intactos), então desarquivar devolve à mesma posição.
- Só páginas e databases de árvore. Linhas de database, linked views e blocos de sistema (`assertNotSystem`)
  não arquivam.
- `listRoot`/`listChildren`/`listFavorites` deixam de retornar arquivadas (os descendentes somem junto porque o
  pai some). Nova `pages.listArchived` (IPC).
- Sidebar: seção/popover **"Arquivo"** ao lado da Lixeira (molde: TrashList.tsx / TrashPopover.tsx), com
  "Desarquivar" e "Abrir".
- Menu de contexto da página (src/renderer/src/shell/pageMenu.tsx, sidebar e top bar): "Arquivar" / "Desarquivar".
  Comando na paleta.
- Página arquivada aberta mostra faixa "Esta página está arquivada · Desarquivar" (molde: banner da lixeira,
  PageHost.tsx:40-55, :174).
- Lixeira tem precedência: mandar arquivada para a lixeira funciona; restaurar mantém `archivedAt`.
- Duplicar não copia a flag; snapshots de versão a removem (como `favorite`, versions.ts:93-97).
- Abas abertas de páginas arquivadas continuam na restauração de abas.
- Tarefas de databases arquivadas saem do Today/Calendar (briefing/service.ts:345, :379).
- **✅ Busca:** arquivadas aparecem no QuickFind/paleta/busca FTS com um selo "Arquivada"; fora dos recentes.
- **✅ IA/MCP/Herman:** arquivadas só aparecem na busca explícita das ferramentas (ai/tools.ts search, MCP search);
  ficam fora do contexto automático (ai/context.ts:63), das listagens de árvore das ferramentas e das sugestões
  do Herman (herman/index.ts:29).
- **✅ Edição:** arquivada continua editável; a faixa é só aviso.

**Fora do escopo.** Arquivamento automático; arquivar linhas de database.

**Toca em.** types.ts, repository.ts, tree store, Sidebar.tsx, pageMenu.tsx, PageHost.tsx, api.ts/INVOKE_CHANNELS,
builtin.ts, search.ts/ai/tools.ts (conforme ❓).

**Pronto quando.** Testes de repositório: arquivar some de root/children/favorites e aparece em listArchived;
desarquivar volta à posição original; lixeira+restauração preserva a flag; sistema/linked view recusam.
Teste de sync: arquivar num lado e editar no outro funde. Checagem na tela: menu, seção Arquivo, faixa.

---

## 2. Definir uma home

**Hoje.** Não existe home. No startup `restoreTabs` (src/renderer/src/store/tabs.ts:249-300) reabre as abas de
`shell.tabs`; sem abas, cai no `EmptyState` (src/renderer/src/shell/Shell.tsx:74-88). Configurações `shell.*` são
graváveis pelo renderer e ficam **só no dispositivo** (src/main/validate.ts:42, :145-149); só `appearance`,
`rootOrder` e (em repo cifrado) calendários sincronizam.

**Escopo.**
- Setting `home`: `{ kind: 'page', id } | { kind: 'screen', route: '_today' | '_tasks' | '_calendar' | '_notebook' } | null`,
  com validador em validate.ts. A home pode ser uma página ou uma das telas (Today é candidata natural).
- **✅ Sincroniza entre dispositivos.** Novo arquivo de sync `settings/home.json` no molde de `appearance`
  (`{format, updatedAt, value}`, merge de três vias, mudança mais nova ganha — src/main/sync/format.ts:425-485,
  engine.ts:131/142, :236-250, :618/657-658, :816-822, :925-948). Não é segredo: vai em repo com ou sem cifra.
  Atualizar o comentário de arquivos (format.ts:10-19) e o README que o sync escreve no repo (:55-72).
  Ids de página são iguais em todos os dispositivos; se a página ainda não chegou ao outro dispositivo, o botão
  fica desabilitado até ela chegar.
- "Definir como home" no menu de contexto da página e em Settings → Geral → Páginas (seletor de página/tela,
  com "Nenhuma").
- Botão **Home** no topo do Sidebar (src/renderer/src/shell/Sidebar.tsx:122-151), comando `go-home` na paleta e
  no menu Exibir, atalho **Ctrl+Alt+H**. Abre a home na aba ativa se ela estiver vazia, senão em nova aba
  (ou foca a aba que já a mostra).
- `EmptyState` passa a abrir a home quando houver uma.
- Home na lixeira ou apagada: botão desabilitado com dica "A home foi para a lixeira"; restaurar volta a funcionar.
  Arquivada continua abrindo.
- **✅ Startup:** opção em Settings "Ao abrir o sel: restaurar abas | abrir a home | os dois (home primeiro)",
  padrão "restaurar abas". Esta opção é **por dispositivo** (`shell.startup`, local).

**Fora do escopo.** Página "dashboard" especial; várias homes.

**Toca em.** tabs.ts, Shell.tsx/EmptyState, Sidebar.tsx, pageMenu.tsx, SettingsDialog.tsx, shortcuts.ts, menu.ts,
menuCommands.ts, builtin.ts, api.ts (MenuCommand), validate.ts, src/main/sync/format.ts e engine.ts.

**Pronto quando.** Testes de tabs: restaurar com cada opção de startup; home lixeira → fallback; `?page=` ignora
home. Teste do validador de `home`. Testes de sync (sync.flows.test.ts): A define home → B recebe; mudanças dos
dois lados → a mais nova ganha; limpar (`null`) propaga. Checagem na tela: botão, atalho, menu de contexto, Settings.

---

## 3. Notificações (tasks e calendário) + perguntar se grava a reunião

**Hoje.**
- Lembretes de task já existem (fase 4): `AlarmsService` (src/main/alarms/service.ts:86-126) agenda pelo
  `tasks.remind` ou prazo com hora; `AlarmsBridge.deliver` (src/main/alarms/index.ts:81-112) traz a janela, pisca,
  mostra `Notification` silenciosa se a janela não está focada e manda `alarms:announce` → balão do Herman ou toast,
  com chime e voz. Nada toca durante gravação. Sem adiar, sem antecedência configurável.
- Eventos do calendário **não** notificam. Só há o nudge `event-soon` do Herman (2–15 min antes, sujeito a
  frequência/ociosidade/horário silencioso — src/main/herman/counsel.ts:48-49, :157-164), dentro da janela.
- Calendário só atualiza quando alguém lê o briefing (src/main/briefing/service.ts:115-116); eventos não guardam
  participantes nem link de reunião (`BriefingEvent`, src/shared/briefing.ts:81-93).
- Gravar só começa pela `RecordingBar` numa página de reunião, depois do diálogo de consentimento
  (src/renderer/src/meetings/RecordingBar.tsx:274-280). A página de reunião não guarda o id do evento.
- Com `alarms.tray` desligado (padrão), fechar a janela encerra o app e nada toca.

**Escopo.**
- **Eventos como fonte de alarme** no `AlarmsService`: avisa `alarms.eventLead` minutos antes (padrão 5;
  opções 0/5/10/15). Ignora dia inteiro, recusados e `TRANSP:TRANSPARENT`. Mesma entrega dos lembretes
  (Notification + janela + chime), mesma regra "não toca durante gravação", mesmo registro `alarms.fired`.
- O serviço de alarmes **atualiza os calendários em segundo plano** quando o cache está velho (mesmo intervalo de
  15 min; não é rede nova, é a exceção já existente do calendário).
- O nudge `event-soon` do Herman é **removido** para não avisar duas vezes.
- **Adiar:** o balão/toast ganha "Adiar 10 min" para lembretes e eventos.
- **Pergunta de gravação:** quando o evento é uma reunião, o aviso vira "Reunião em 5 min: <título>" com
  **[Gravar] [Só notas] [Agora não]**.
  - Gravar → `meetings:create` com o contexto do evento → abre a página → inicia a gravação (o diálogo de
    consentimento continua, salvo se `meetings.consentReminder` estiver desligado).
  - Só notas → cria/abre a página sem gravar.
  - A página guarda `props.meetingEvent = { uid, start }`; se já existir página para aquele evento, reusa.
- ical.ts passa a guardar participantes (contagem) e extrair link de reunião (Meet/Teams/Zoom) de
  LOCATION/DESCRIPTION/URL/X-GOOGLE-CONFERENCE.
- **✅ O que é "reunião":** evento com ≥1 outro participante ou link de reunião (Meet/Teams/Zoom), com opção
  "perguntar em todos os eventos com horário".
- Settings: nova seção **Notificações** (sai de dentro do Herman): lembretes de tasks, eventos (+ antecedência),
  perguntar se grava reunião, som, manter na bandeja. Os horários do briefing ficam no Herman. Se a bandeja está
  desligada, aviso: "Com a janela fechada nada toca — ative 'Manter na bandeja'".
- **✅ Bandeja:** `alarms.tray` continua desligado por padrão; só o aviso acima.

**Fora do escopo.** Botões de ação dentro do toast do Windows (`toastXml`); notificação no celular;
gravação automática sem perguntar.

**Toca em.** src/main/alarms/*, src/shared/alarms.ts, src/main/briefing/ical.ts e calendars.ts, src/shared/briefing.ts,
src/main/herman/counsel.ts, src/main/meetings/service.ts, RecordingBar/recorder, Dock.tsx, AlarmSettings.tsx,
SettingsDialog.tsx, validate.ts, builtin.ts.

**Pronto quando.** Testes puros do schedule: evento entra no plano com antecedência; dia inteiro/recusado/transparente
fora; adiar re-agenda; nada durante gravação. ical: participantes e link extraídos. Meetings: reuso da página pelo
`uid`. Checagem na tela com um ICS de fixture: aviso aparece, Gravar abre página e inicia gravação.

---

## 4. Ink notebook → Meditations / Meditações

**Hoje.** Página de sistema `sel-notebook` (`props.system:'notebook'`), um bloco por dia `sel-notebook-YYYY-MM-DD`,
dias passados imutáveis; Fechar o dia escreve a linha do dia. Sincroniza como páginas comuns.
~485 ocorrências em 50 arquivos, em três classes:
(a) texto visível — `NOTEBOOK_TITLES` (src/shared/notebook.ts:37), copy.ts (:29-58, :134, :149, :166, :181),
route.ts:9, Sidebar.tsx:141, menu.ts:99, builtin.ts:79, catalog.ts:74, herman/lines.ts:127/:223, mensagens de erro em
repository.ts e notebook/service.ts, README; (b) identificadores internos — diretórios `notebook/`, tipos, IPC
`notebook:*`, `open-notebook`, classes `.notebook-*`; (c) persistidos/sincronizados — ids `sel-notebook*`,
`props.system:'notebook'`, título gravado na página, setting `notebook.bell`, rota `_notebook` em `shell.tabs`.

**Escopo.**
- Todo texto visível (a) vira **Meditations** (en) / **Meditações** (pt-BR). Revisar a metáfora "tinta" nas
  cópias (kicker, inkNote, ajuda do Fechar o dia) para o novo nome, mantendo o comportamento (dia passado não muda).
- Paleta: "Meditações" com keywords antigas preservadas ("caderno", "diário", "notebook", "ink").
- **Migração do título:** na abertura, se a página `sel-notebook` tem exatamente o título padrão antigo
  ("Ink notebook"/"Caderno de tinta"), reescreve para o novo; se o usuário renomeou, não toca. Os dois
  dispositivos produzem o mesmo valor, então o merge não conflita.
- (c) **não muda**: ids, `system`, setting e rota ficam como estão.
- **✅ Identificadores internos (b) ficam como estão** (evita um diff de centenas de linhas que conflita com o
  Jardim e o Fechar o dia). Só um comentário em shared/notebook.ts: "notebook = Meditations / Meditações na UI".
- Atalho Ctrl+Alt+N mantido.

**Fora do escopo.** README (feature 7). Mudar o comportamento das Meditações.

**Toca em.** shared/notebook.ts, renderer/src/notebook/copy.ts e route.ts, Sidebar.tsx, menu.ts, builtin.ts,
catalog.ts, herman/lines.ts, main/notebook/service.ts, repository.ts (mensagens), testes.

**Pronto quando.** Nenhum texto visível com "notebook/caderno/tinta" (grep na UI); teste da migração do título
(padrão antigo → novo; título customizado intacto; idempotente); testes existentes do notebook verdes.

---

## 5. Pomodoro

**Hoje.** Não existe timer. Molde de widget sempre visível: `RecordingIndicator` (src/renderer/src/meetings/slot.tsx:56-75),
montado na TopBar (TopBar.tsx:144) e em `.focus-indicators` (Shell.tsx:67-71) para aparecer no modo foco.
Sons são sintetizados (Web Audio; CSP não permite mídia): `chime()` (src/renderer/src/alarms/play.ts:11),
`ringBell()` (notebook/bell.ts:16). Notification só em alarms/index.ts:99-111.

**Escopo.**
- Estado do timer no **main** (`{phase: 'focus'|'short'|'long', endsAt, paused, cycle}`), para sobreviver a reload e
  aparecer igual em todas as janelas; push de mudança para o renderer. Fechar o app perde o timer (ok).
- **✅ Fica no canto inferior direito** da área de conteúdo, como um widget flutuante discreto (fase + tempo
  restante; clique abre popover com pausar/retomar/pular/parar). Visível também no modo foco. Só aparece com um
  pomodoro ativo. Convivência no canto:
  - O Herman mora por padrão no canto inferior direito (`.herman-dock.is-bottom-right`, right 22px / bottom 18px,
    src/renderer/src/herman/herman.css:149-153; posição configurável). Quando o Herman está nesse canto, o pomodoro
    fica **à esquerda dele, na mesma linha de base**, sem sobrepor o balão de fala; com o Herman em outro canto ou
    desligado, o pomodoro ocupa o canto.
  - O aviso de atualização fica no inferior esquerdo (src/renderer/src/updates/updates.css:3-8) — sem conflito.
  - Toasts: conferir onde aparecem e não cobrir.
- Iniciar: comando `start-pomodoro` na paleta, menu Exibir, atalho **Ctrl+Alt+P**; botão no popover.
- Padrões 25 / 5 / 15, pausa longa a cada 4 ciclos, configuráveis em Settings (`pomodoro.*`).
- Fim de fase: som curto sintetizado + Notification se a janela não está focada; **não** começa a próxima fase
  sozinho — o aviso pergunta "Pausa de 5 min?" / "Voltar ao foco?".
- Opção "Entrar no modo foco ao iniciar" (padrão desligada).
- Emite um evento `pomodoro:completed` (fim de uma fase de foco) que o Jardim (6) vai consumir; guarda o histórico
  mínimo necessário — ver decisão de dados no item 6.
- Não toca nada durante gravação de reunião (mesma regra dos alarmes).
**Fora do escopo.** ✅ Vincular a uma task ("focando em: X") fica para depois. Estatísticas de pomodoro; som customizado.

**Toca em.** novo src/main/pomodoro/*, src/shared/pomodoro.ts, novo renderer/src/pomodoro/*, Shell.tsx, herman.css (só se precisar de uma variável de offset),
validate.ts, SettingsDialog.tsx, shortcuts.ts, menu.ts, menuCommands.ts, builtin.ts, api.ts/INVOKE_CHANNELS.
Notificação feita no próprio módulo (não mexer em alarms/index.ts para não conflitar com a feature 3).

**Pronto quando.** Testes puros da máquina de estados (ciclos, pausa longa, pausar/retomar mantém o restante,
pular). Checagem na tela: iniciar pelo atalho, widget no canto inferior direito ao lado do Herman (e sozinho com o
Herman desligado), visível no modo foco, aviso ao fim.

---

## 6. Jardim — EM REFINAMENTO

**Em andamento:** sessão própria desenhando o layout com o Érik (protótipos visuais primeiro). O resultado dela
substitui as perguntas abaixo por um Escopo decidido, em `docs/plans/garden.md`, antes da implementação (onda 2).

**Hoje / material disponível.**
- **Tensão de princípio:** o README diz que Fechar o dia tem "No streaks, no scores" (README.md:25) e o cabeçalho de
  CloseDayScreen.tsx:4 diz "No streaks, no scores, no counts". Um jardim que cresce por ações contadas precisa
  respeitar isso — proposta: **cresce, nunca murcha, nunca mostra números**.
- **Estilo pronto:** Herman é SVG de linha única animado por CSS (src/renderer/src/herman/poses.ts, Figure.tsx);
  `ui/lineIcons.ts:29-39` já tem um grupo "the garden" (enso, pedras, folha, broto, lótus, bambu, árvore) no mesmo
  traço. Sem libs de canvas/animação; tudo SVG à mão.
- **Eventos de conclusão hoje:**

| Evento | Tem data? | Sincroniza? | Dá para preencher o passado? |
|---|---|---|---|
| Linha das Meditações | sim (id do bloco = dia) | sim | **sim, histórico completo** |
| Task concluída (DB de Tasks) | `tasks.completedAt`, mas recorrente sobrescreve | sim | parcial |
| Checkbox de outras DBs / to-do em página | só `updatedAt` | sim | não |
| Fechar o dia | não é gravado | — | não (só a linha que ele escreve) |
| Reunião gravada | manifesto local | não | parcial (linha da DB) |
| Pomodoro (5) | novo | — | não |

- Duas formas de guardar: **derivar** dos dados existentes (zero armazenamento novo, sincroniza de graça, histórico
  das Meditações vem junto) ou um **diário de eventos** como página de sistema `sel-garden` (molde do notebook:
  sincroniza como blocos, sem mexer no engine).

**Perguntas para refinar** (respondidas na conversa, depois viram Escopo):
1. **Metáfora:** (a) um jardim único que evolui como cena; (b) cada dia com Meditação planta algo e o jardim é o
   histórico em canteiros; (c) uma árvore/bonsai que ganha galhos e folhas.
2. **O que faz crescer:** Meditação, task concluída, Fechar o dia, pomodoro, reunião registrada… quais e com que peso?
3. **Pode murchar?** (proposta: nunca; dias vazios deixam só terra/pedras)
4. **Números visíveis?** (proposta: nenhum)
5. **Interação:** só contemplar, ou o usuário escolhe/planta/arranja?
6. **Estações:** seguir o calendário real (folhas no outono etc.)?
7. **Onde vive:** tela própria `_garden` (Ctrl+Alt+G), vislumbre no fim do Fechar o dia, rodapé do Today, ao lado do Herman?
8. **Passado:** o jardim nasce já com o histórico das Meditações ou começa vazio hoje?
9. **Herman:** comenta o jardim?

---

## 7. README

**Escopo.** Último passo da release, depois de 1–6 integradas na `release/0.6.0`. Nesta versão, revisão completa:
o README tem que descrever o app inteiro como ele é na 0.6.0 (Today, Tasks, Calendar, Meditações, Fechar o dia,
Reuniões, Herman, MCP, sync, arquivo, home, notificações, pomodoro, jardim, atalhos, princípios). Conferir cada
afirmação contra o código; atualizar capturas de tela em `docs/` se a UI mudou. A partir daqui, toda release
atualiza o README com o que mudou.

**Pronto quando.** Nenhuma afirmação desatualizada (ex.: "Ink notebook" em README.md:23, :25, :122); seções novas
para as features desta release.
