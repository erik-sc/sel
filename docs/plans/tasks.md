# Plano: Tasks (estilo Todoist) sobre as databases do sel

Status: fases 0–3 implementadas (datas com hora, `date_is`, `props.system`; DB de sistema, tela Tasks; parser e quick add; recorrência) · 2026-10-15

## O que já existe e vamos reaproveitar

| Peça | Onde | Como ajuda |
|---|---|---|
| Database = bloco `database`, linhas = páginas com `props.values` | src/shared/types.ts:49-59 | A database de tasks é uma database normal: views, filtros, linked views e sync vêm de graça |
| Linked views (`props.sourceId`) | src/shared/types.ts:52-57, src/shared/linked.ts | "Faço views de tarefas como faço normalmente": qualquer página pode embutir uma view da DB de tasks |
| Detecção de tasks do Today | src/main/briefing/tasks.ts (`detectSignal`) | Já reconhece "Done", "Due"/"Prazo", "Priority"/"Prioridade" em pt/en. Se a DB de tasks usar esses nomes, Today e Calendar a enxergam sem mudança |
| `briefing:completeTask` com undo token | src/main/briefing/register.ts:41 | Ponto único de "concluir"; é aqui que entra a recorrência |
| Rotas `_today` / `_calendar` + botões no Sidebar | src/renderer/src/store/tabs.ts:30-32, src/renderer/src/briefing/route.ts, src/renderer/src/shell/Sidebar.tsx:124-130 | Molde exato para a rota `_tasks` |
| Parser de RRULE (DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, BYDAY, BYMONTHDAY…) | src/main/briefing/ical.ts:511+ | Motor de recorrência já testado em 5 fusos; só precisa sair do main para `src/shared` |
| Herman: scheduler puro, poses `speaking`/`speaking2`, push `herman:nudge`, falas pt-BR/en | src/main/herman/scheduler.ts, src/renderer/src/herman/poses.ts:13, src/shared/herman.ts | Base do briefing agendado |
| Fold sem acento ("Situação" = "situacao") | src/main/briefing/tasks.ts (`fold`) | Mesmo normalizador para as keywords do parser |

## Lacunas no motor de databases (valem para todas as DBs)

1. **Data com hora.** Hoje `DateValue.start` é só `YYYY-MM-DD` e `normalizeDateValue` descarta hora
   (src/renderer/src/database/logic/dates.ts:128). Precisa aceitar `YYYY-MM-DDTHH:mm` (hora local,
   sem fuso, igual ao Todoist "floating time"). Afeta: normalize, format, DatePicker, calendar view,
   ordenação, markdown export, sync merge.
2. **Filtros relativos de data.** `FilterOperator` não tem "hoje", "atrasado", "próximos 7 dias".
   Proposta: operador `date_is` com valor `{ relative: 'today' | 'overdue' | 'tomorrow' | 'next_7_days' | 'this_week' | 'no_date' }`.
   Sem isso as views "Hoje" / "Em breve" não podem ser views comuns.
3. **Bloco protegido.** A DB de sistema não pode ir para o trash nem perder as propriedades
   essenciais (hoje só linked views são não-trasháveis, src/shared/linked.ts:34-36).

## Modelo de dados

**Uma única database de sistema, sempre a mesma.**

- Bloco `database` com **id fixo** (uma constante UUID). Motivo: o sync carrega páginas, não settings;
  com id fixo, dois dispositivos que criem a DB "ao mesmo tempo" produzem o mesmo bloco e o merge
  resolve, em vez de duas DBs de tasks. Criada no primeiro uso (seed idempotente).
- Marcada com `props.system = 'tasks'` (novo campo em `BlockProps`). Fica na raiz, **fora da árvore do
  Sidebar** (aparece só pela barra Tasks) e é não-trashável.
- Schema "travado" (o usuário pode acrescentar propriedades próprias, mas não apagar/mudar o tipo destas):

| Propriedade | Tipo | Nota |
|---|---|---|
| Título | title | texto já limpo das keywords |
| Done / Feito | checkbox | sinal de conclusão que `detectSignal` já entende |
| Due / Prazo | date (com hora) | |
| Priority / Prioridade | select P1–P4 | P1 alta… P4 sem prioridade |
| Project / Projeto | select | Inbox = vazio. Alternativa: relation com páginas de projeto (o tipo relation já existe) |
| Labels | multi_select | `@label` |
| Recurrence | text, oculta | JSON `{ rule: 'FREQ=WEEKLY;BYDAY=MO', from: 'due' \| 'completion', text: 'toda segunda' }` |
| Completed at | date, oculta | para "concluídas hoje" e histórico |

Os nomes exibidos seguem o idioma do app; os ids das propriedades são fixos (`tasks.done`, `tasks.due`…),
então o código nunca depende do nome.

**Subtarefas:** v1 sem. Uma task é uma página, então to-dos dentro dela já funcionam. Depois:
propriedade `parent` (id de outra linha).

## Barra Tasks (rota `_tasks`)

- `TASKS_ROUTE = '_tasks'` ao lado das outras rotas, botão no Sidebar junto de Today/Calendar,
  `routeTitle` devolve "Tasks". Feature nova em `src/renderer/src/tasks/` (gate + Host + chunks lazy,
  como briefing).
- Tela com navegação lateral própria, estilo Todoist:
  - **Fixas (calculadas no código):** Inbox, Hoje (inclui atrasadas), Em breve (agrupado por dia), Concluídas.
  - **Projetos e Labels:** geradas a partir das opções dos selects.
  - **Minhas views:** as `views` da própria DB (tabela, board, calendar…), editáveis como hoje.
- Cada lista é o mesmo componente: linha com checkbox redondo colorido pela prioridade, título,
  data relativa ("amanhã 9h", vermelho se atrasada), ícone de recorrência, projeto e labels.
  Clicar abre a task como página (peek ou aba).
- **Quick add** no topo e por atalho (Ctrl+K já é quick find? escolher, ex. `Q` sem foco em texto, ou
  `Ctrl+Shift+A`). Opcional depois: atalho global do sistema (`globalShortcut`) abrindo uma janelinha.

## Parser de quick add (pt-BR + en)

Módulo puro `src/shared/tasks/parse.ts`, com muito teste (tabela de casos pt e en, e testes por fuso
como os de ical). Sempre aceita os dois idiomas ao mesmo tempo.

Saída: `{ title, due?, recurrence?, priority?, project?, labels[], tokens[] }`, onde `tokens` são os
trechos reconhecidos (início, fim, tipo) para **destacar no input enquanto digita**. Clicar num destaque
(ou Backspace logo depois dele) desfaz o reconhecimento daquele trecho — é isso que torna seguro
reconhecer palavras como "segunda" ("comprar tinta de segunda mão").

| Tipo | pt-BR | en |
|---|---|---|
| Dia | hoje, amanhã, depois de amanhã, seg/segunda, sexta que vem, próxima terça, dia 15, 15/10, 15 out, em 3 dias, fim de semana, semana que vem, mês que vem | today, tomorrow, mon/monday, next friday, the 15th, Oct 15, 10/15 (ordem pelo locale), in 3 days, weekend, next week, next month |
| Hora | 9h, 9h30, às 14, 14:00, ao meio-dia, à noite (=19h) | 9am, 2:30pm, at 14, 14:00, noon, tonight |
| Recorrência | todo dia, toda segunda, toda seg e qua, dias úteis, a cada 2 semanas, todo dia 5, todo mês, todo ano, todo! (= a partir da conclusão) | every day, every monday, every mon, wed, every weekday, every 2 weeks, every 5th, monthly, yearly, every! |
| Prioridade | p1–p4 | p1–p4 |
| Projeto | #Projeto (autocomplete; cria se não existir) | idem |
| Label | @label | idem |

Recorrência vira um RRULE (subset do que ical.ts já expande) + o texto original para exibir.

## Recorrência

- Função pura `nextOccurrence(rule, from: 'due' | 'completion', due, completedAt)` em `src/shared`,
  reaproveitando a expansão de RRULE de ical.ts (movida para shared).
- **Concluir uma task recorrente** não marca Done: avança o Due para a próxima ocorrência, preserva a hora,
  grava `Completed at` (e opcionalmente uma linha de log) — comportamento do Todoist.
- Um único ponto que gera os ops: `completeTaskOps(row, now)` em shared, usado por
  `briefing:completeTask` (Today), pela tela Tasks e pela célula checkbox quando a DB é a de sistema.
  Undo continua funcionando porque são ops normais.

## Briefing agendado (som + Herman)

### Configuração
- Setting `tasks.briefing`: lista de horários `{ time: 'HH:mm', days: [1..7], enabled }`
  (ex. 08:30 seg–sex). Na tela de settings do Today. Entra no allow-list (src/main/validate.ts:35-37)
  com um `cleanTasksSetting` em shared, como `cleanHermanSetting`.

### Disparo (main process)
- Função pura `nextBriefingAt(config, lastFiredAt, now)` testada por fuso (inclui troca de horário de
  verão), no estilo de herman/scheduler.ts.
- `setTimeout` até o próximo horário, rearmado em `powerMonitor` `resume`/`unlock` e quando o setting muda.
- Horário perdido (PC dormindo): dispara ao acordar se atrasou ≤ 30 min, senão pula. Guarda
  `tasks.briefingLastFired` para não disparar duas vezes (inclusive com várias janelas).
- **Ignora a contenção do Herman** (gap, limite por dia, quiet hours): foi o usuário que marcou a hora.
  Só adia se estiver gravando reunião (`busy`), e dispara quando a gravação acabar.

### Entrega (renderer)
1. Main manda push `herman:briefing` para a janela em foco (ou a última usada); se estiver minimizada,
   `restore()` + `flashFrame`; com a janela fora de foco, também uma `Notification` do sistema.
2. **Som:** carrilhão sintetizado com Web Audio (`OscillatorNode`), que não precisa de arquivo nem de
   mudança na CSP (hoje `media-src` só aceita `sel-file:`). Se quiser um som gravado, acrescentar
   `'self'` a `media-src` e empacotar o `.ogg`.
3. **Herman:** pose `speaking`, balão com o briefing, botão "Abrir Today".
4. **Voz (opcional):** `speechSynthesis` com a voz pt-BR do Windows ("Microsoft Maria"/"Francisca"),
   offline, sem rede. Boca do Herman alterna `speaking`/`speaking2` nos eventos `boundary`.

### Conteúdo
- **v1, local (sem IA):** template na voz do Herman, em pt-BR/en, como lines.ts. Instantâneo e offline.
  > "Bom dia, Érik. Três reuniões hoje, a primeira às 10h com o time. Cinco tarefas para hoje e duas
  > atrasadas — eu começaria por *Enviar proposta*."
  Dados: o mesmo `day()` que o Herman já usa (tasks + agenda) + "primeira P1" como sugestão.
- **v2, IA (opt-in):** o Claude CLI com a persona Herman gera o texto ~3 min antes do horário,
  para estar pronto na hora; timeout/erro cai no template. Isso abre uma exceção à regra de
  src/shared/herman.ts ("nudges nunca chamam modelo") — aceitável porque é agendado pelo usuário,
  mas deve ficar explícito e desligável.

## Fases

| Fase | Entrega | Depende de |
|---|---|---|
| 0 | Data com hora; filtro `date_is` relativo; `props.system` + proteção | — |
| 1 | DB de sistema (seed, id fixo), rota `_tasks`, tela com Inbox/Hoje/Em breve/Projetos/Labels/views, concluir | 0 |
| 2 | Parser pt/en + quick add com destaques e autocomplete de #projeto/@label | 1 |
| 3 | Recorrência (RRULE para shared, `completeTaskOps`, Today usa o mesmo caminho) | 1, 2 |
| 4 | Briefing agendado: setting, timer no main, som, Herman falando (texto + voz) | 1 |
| 5 | Depois: briefing por IA, lembretes por task ("lembrar 30 min antes"), subtarefas, importar CSV do Todoist, atalho global, tray | — |

A fase 4 só depende da 1: dá para fazer em paralelo com 2–3.

## Decisões em aberto

1. **App fechado.** Hoje o sel encerra quando a última janela fecha (src/main/index.ts:377) e não tem
   tray. Para o briefing tocar com o app "fechado" seria preciso ficar na bandeja e/ou iniciar com o
   Windows. Sugestão: v1 só com o app aberto (mesmo minimizado); tray como opção depois.
2. **Voz de verdade ou só balão?** Sugestão: balão + som sempre; voz como opção ligada por padrão.
3. **Projetos:** select (simples) ou páginas reais ligadas por relation (o tipo já existe na base).
4. **Migração:** importar tasks de DBs existentes para a DB de sistema, ou deixar o Today continuar
   lendo as outras DBs também (já faz, via `briefing.databases`)?
5. **Atalho do quick add** dentro do app, e se queremos atalho global já na fase 2.
