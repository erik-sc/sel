# Tarefas: capturar, refinar, agendar — spec (release 0.7.0, item 9)

Status: **decidido** · 2026-10-20 (Q1–Q4 aprovadas pelo Érik) · pedido do Érik: "editar tarefas mais facilmente pela visão de Hoje/Inbox;
criar a tarefa e deixar no Inbox para ir pontuando; o app me lembra de refinar e eu tenho visibilidade; facilitar
calendário e recorrência". Entra na 0.7.0 (que era só consolidação) a pedido dele, **depois do item 2** (registros por
feature), porque toca nos mesmos registros.
Marcadores: **❓** = decisão pendente · **✅** = decidido.

Levantamento em `release/0.7.0` @ e2b3e72. O agente reconfere os números de linha antes de mexer.

## Hoje

- **Modelo.** Uma database de sistema `TASKS_DATABASE_ID` (src/shared/tasks/index.ts:13) com propriedades de id fixo
  (`TASK_PROPS`, :15-30): título, done, due (`YYYY-MM-DD` ou `YYYY-MM-DDTHH:mm`), priority (p1–p4; **P4 e "sem
  prioridade" se confundem**, lists.ts:63), project, labels, recurrence (JSON `{rule, from, text}`), completedAt,
  remind, parent (subtarefas). **Inbox = aberta e sem projeto** (lists.ts:162).
- **Criar** é bom: `parseTask` (shared/tasks/parse.ts:557) entende pt e en de uma vez, com destaques clicáveis no
  QuickAdd; Ctrl+Alt+A; atalho global opcional que sempre cai no Inbox.
- **Editar é ruim fora da grade da database.** Na tela Tarefas, no Hoje e no Calendário, clicar abre a página da
  linha; o círculo conclui; e só. Nenhum editor inline de data, prioridade, projeto, rótulos, recorrência ou lembrete,
  nenhum menu de contexto, nenhum atalho por linha além de recuar/avançar (TasksScreen.tsx:134-216, briefing/parts.tsx:188-219,
  CalendarScreen.tsx:110, :446-453). As linhas do Hoje/Calendário nem recebem projeto, rótulos ou recorrência
  (`BriefingTask`, shared/briefing.ts:136-148).
- **Datas.** O DatePicker (database/DatePicker.tsx) tem grade do mês, "Hoje" que só move o mês (:89), hora e fim;
  **sem atalhos** (hoje/amanhã/próxima semana) e **sem texto livre** — o parser só existe no QuickAdd.
- **Recorrência sem interface.** Só nasce digitada no QuickAdd; na página da linha aparece como **JSON cru**
  (RowProperties.tsx:27); nada transforma uma RRULE em palavras.
- **Lembrete** é uma data absoluta solta (`tasks.remind`), sem "15 min antes".
- **Calendário** (tela): tarefas só por dia (a hora some, main/briefing/tasks.ts:227), na semana ficam no cabeçalho do
  dia e não nos horários; **não arrasta** para reagendar (CalendarScreen.tsx:3-4).
- **Refino não existe.** Nada marca uma tarefa como "a refinar"; briefing (alarms/compose.ts:107-133), Herman
  (herman/counsel.ts:151-223), Hoje e Fechar o dia nunca falam do Inbox; o item Tarefas da barra lateral não tem marca.

## Escopo

Três partes, uma branch cada, nesta ordem (a seguinte usa os componentes da anterior):

### 9a. Datas e recorrência fáceis (vale para todas as databases)

- **DatePicker** ganha, no topo: um campo de texto que entende o mesmo português/inglês do QuickAdd ("sex 15h",
  "amanhã", "daqui 3 dias", "dia 5", "next monday") com prévia da data; e atalhos **Hoje · Amanhã · Fim de semana ·
  Próxima semana · Sem data**. "Hoje" passa a escolher hoje. Hora com campo digitável e passos de 15 min.
  O parser de datas é extraído de parse.ts para um módulo puro reaproveitado pelos dois.
- **Seletor de recorrência** (`RecurrencePicker`, componente compartilhado): presets **Todo dia · Dias úteis · Toda
  semana em <dia> · Todo mês no dia <N> · Todo ano em <data>**, "Personalizado" (a cada N dias/semanas/meses/anos,
  dias da semana, fim: nunca/até data/N vezes) e **"Repetir a partir da: data / conclusão"**; campo de texto com o
  parser ("toda segunda e quarta", "quinzenal"). Mostra a regra **em palavras** pt/en (`ruleText(rule, locale)`
  novo em src/shared/rrule, com testes de ida e volta). A página da linha mostra esse seletor em vez do JSON.
- **Lembrete relativo**: atalhos "Na hora · 15 min antes · 1 h antes · 1 dia antes às 9h" calculados a partir do
  prazo; continua gravado como data absoluta (alarms não muda).
- **Tela Calendário**: arrastar uma tarefa para outro dia (mês) ou horário (semana) reagenda; tarefas com hora entram
  nos horários da semana; clicar num dia/horário vazio abre o QuickAdd já com aquela data. Desfazer com Ctrl+Z.

### 9b. Edição rápida nas listas (Tarefas, Hoje, Calendário)

- **Linha com chips**: data (com ↻ se repete), prioridade, projeto, rótulos. Clicar num chip abre o editor daquele
  campo (DatePicker e RecurrencePicker de 9a, seletores de prioridade/projeto/rótulos com criar novo).
- **Título editável na linha** (duplo clique ou F2), com o mesmo parser e destaques do QuickAdd: digitar "amanhã p1"
  ao editar aplica data e prioridade.
- **Menu de contexto** (clique direito ou ⋯): Data, Repetir, Prioridade, Projeto, Rótulos, Lembrete, Renomear,
  Abrir página, Abrir em nova aba, Apagar.
- **Teclado** numa linha focada (↑↓ navegam): `Enter` abre, `F2` renomeia, `D` data, `R` repetir, `1–4` prioridade,
  `#` projeto, `@` rótulos, `L` lembrete, `Espaço` conclui, `Del` apaga (com Desfazer). Listados em Ctrl+/.
- **✅ Clique na linha** abre um **painel de tarefa** à direita (todos os campos, notas =
  conteúdo da página, subtarefas, "Abrir como página"), e Ctrl+clique abre a página como hoje.
- Hoje e Calendário passam a receber projeto, rótulos e recorrência das tarefas da database de sistema
  (`BriefingTask` ganha campos opcionais; outras databases de tarefas continuam como hoje).
- **Prioridade "não definida" ≠ P4**: vazio continua vazio; P4 só quando escolhido.

### 9c. Inbox e refino

- **✅ Refinada:** uma tarefa está refinada quando tem **data, prioridade e projeto**
  (nenhum é obrigatório para existir). O que falta aparece na linha como **chip vazio** ("+ data", "+ prioridade",
  "+ projeto"): é a visibilidade do que ainda está por pontuar.
- **Lista "A refinar"** na tela Tarefas (abaixo do Inbox), com as tarefas abertas não refinadas, mais antigas primeiro.
- **Modo Refinar**: botão "Refinar" no Inbox/"A refinar" passa pelas tarefas uma a uma num cartão só de teclado —
  título editável, atalhos de data, `1–4`, projeto, rótulos, repetir; `Enter` próxima, `S` pular, `Del` apagar,
  `Esc` sai. Ao fim: "Inbox em dia." (sem placar).
- **✅ Lembrar de refinar, pelos quatro caminhos** (cada um com seu interruptor em Settings → Notificações):
  - uma linha no briefing agendado quando há tarefas por refinar ("Há 4 tarefas esperando refino");
  - Herman, no máximo uma vez por dia, quando há tarefa parada no Inbox há 2+ dias, com o botão "Refinar agora"
    (nudge `inbox` novo + comando `refine-inbox`);
  - um horário fixo de refino em Settings → Notificações (padrão: dias úteis 17h, ligado só se houver o que refinar
    naquela hora), com notificação "Hora de refinar" que abre o modo Refinar;
  - uma marca discreta no item Tarefas da barra lateral enquanto houver o que refinar.
- **✅ No Hoje:** uma linha quieta no Hoje, abaixo das tarefas, "4 para refinar ·
  Refinar", só quando houver; dentro de Tarefas a contagem fica ao lado de "A refinar", como as outras listas.
- Nada disso entra no Céu nem no Fechar o dia (sem números ali).

**Como ficou (9c, 2026-10-22).** Branch `claude/tasks-refine`:
- A regra é `src/shared/tasks/refine.ts` (pura, testada): `missingFields`, `needsRefining`, `refineList` (mais antigas
  primeiro pela criação da linha), `refineSummary` (o main lê as linhas guardadas) e os quatro settings
  `tasks.refine*` (locais, não sincronizam, como os alarmes). **Decisão do agente:** subtarefa se refina com a tarefa
  mãe — fica fora de "A refinar", das contagens, dos lembretes e dos chips vazios.
- Lista "A refinar" e chips vazios (`+ data`, `+ prioridade`, `+ projeto`) na tela Tarefas e no Hoje; contagem no
  main por `tasks:refining` (renderer/src/tasks/refining.ts), que a marca da barra lateral e a linha do Hoje leem.
- Modo Refinar: `tasks/Refine.tsx` (cartão) + `tasks/refineWalk.ts` (fila, teclas e passos, puros); `S` e `→`
  pulam, `←` volta. Ao fim: "Inbox em dia." quando nada da fila ficou por refinar, senão "Por ora, é isso.".
- Lembretes: linha no briefing (também depois do texto da IA), nudge `inbox` (último na ordem, uma vez por dia,
  dentro dos limites do Herman, botão "Refinar agora" → `refine-inbox`), hora de refinar no relógio dos alarmes
  (anúncio `refine`; o botão e o clique na notificação do sistema abrem o modo Refinar pelo comando
  `refine-tasks`, também na paleta) e a marca (um ponto, sem número) no item Tarefas.

## Fora do escopo

- Estimativas de tempo, dependências entre tarefas, tarefas atribuídas a outras pessoas.
- Sincronizar com Todoist/Google Tasks (só a importação CSV que já existe).
- Notificação com botões de ação no Windows (toastXml).
- Mudar o significado de `tasks.completedAt` (o Céu depende dele).

## Toca em

- 9a: database/DatePicker.tsx, novo database/RecurrencePicker.tsx, shared/tasks/parse.ts (extrair datas),
  shared/rrule (ruleText), database/RowProperties.tsx, briefing/CalendarScreen.tsx, main/briefing/tasks.ts (manter a
  hora), testes.
- 9b: tasks/TasksScreen.tsx e lists.ts, briefing/parts.tsx e TodayScreen.tsx, novo tasks/TaskRow + TaskPanel,
  shared/briefing.ts (`BriefingTask`), main/briefing/service.ts, shortcuts/catalog.ts, testes.
- 9c: tasks/lists.ts (lista "A refinar", regra de refinada em shared/tasks), novo tasks/Refine.tsx, alarms/compose.ts,
  herman (counsel.ts, lines.ts, shared/herman.ts), Settings → Notificações, sidebarItems.tsx (marca), testes.
- Registros (comandos, atalhos, settings, IPC) pelo caminho que o item 2 deixar.
- Conflito previsível com o item 4 (teclado e leitor de tela) nas listas de tarefas: 9b segue as regras de foco e
  `aria-*` que o item 4 estabelecer; se o item 4 ainda não entrou, o orquestrador junta.

## Pronto quando

- Testes puros: parser de datas extraído (as suítes atuais passam sem mudança); `ruleText` pt/en com ida e volta para
  todos os presets; atalhos de lembrete relativo; regra de "refinada"; ordem da lista "A refinar"; teclado do modo
  Refinar (máquina de estados).
- Testes do main: `BriefingTask` com os campos novos; linha do briefing; nudge `inbox` respeita uma vez por dia e
  os limites do Herman; horário de refino no plano dos alarmes.
- `npm run lint`, `npm run typecheck`, `npm test` verdes.
- Na tela (app buildado, perfil de rascunho): criar "comprar pão" pelo atalho → aparece no Inbox com chips vazios →
  modo Refinar dá data "sex 15h", P2, projeto Casa, "toda semana" → sai de "A refinar"; editar a data de uma tarefa
  pelo chip no Hoje; arrastar uma tarefa no Calendário para outro dia; a página da linha mostra a recorrência em
  palavras; lembretes conforme Q3.
