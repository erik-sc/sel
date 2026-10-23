# Release 0.8.0 — uma persona que te acompanha

Status: **aprovada** (A3 com memória automática) · 2026-10-22 · pedido do Érik: incrementar a persona e o contexto (com
onboarding de AI e a Hermine), trocar o painel lateral do Herman por um balão de conversa, fazer a persona rodar AI
ao longo do dia, um heatmap para entender fluxos, e mais dois épicos para consolidar o app.
Branch `release/0.8.0`, cortada de `release/0.7.2` (que já tem: o Council removido, o Refine corrigido, o Contexto
para o Claude e os MCPs por pedido, `feature/claude-context`). A 0.7.2 não sai sozinha: entra inteira na 0.8.0.

Substitui a proposta anterior "Herman no centro" (o arquivo não versionado que estava neste caminho no checkout
principal): as ideias de lá que cabem aqui foram trazidas para os itens abaixo e marcadas *(da proposta anterior)*.

**Princípios que valem para tudo.** Assistida, nunca autônoma: a AI propõe, você aplica. Nada vai para a AI sem
estar visível. Local-first: nenhum dado sai da máquina a não ser pelo Claude Code do próprio usuário. Sem placar,
sem streak, sem notificação que não foi pedida. Tudo que roda sozinho pode ser desligado e tem limite.

Formato de cada item: **Hoje · Escopo · Fora do escopo · Toca em · Pronto quando.** Números de linha são poucos de
propósito: o agente de cada item reconfere o código antes de mexer.

---

## Épico A — Persona e contexto

### A1. Onboarding de AI
**Hoje.** O Contexto (Settings → AI → Contexto) existe, mas é um campo em branco que ninguém descobre; ligar o
Claude Code é o `SetupSheet`; os MCPs ficam em Settings.
**Escopo.** Um onboarding curto, pela própria persona, num balão grande (ou folha) em 4–5 passos: (1) conferir o
Claude Code e o modelo; (2) escolher a persona (Herman ou Hermine, A2) e a roupa; (3) perguntas guiadas que montam o
contexto: quem é você, seu trabalho, seus projetos (com sugestão a partir dos projetos de Tasks), como gosta das
respostas (curta/detalhada, idioma, tom); o texto final fica editável antes de salvar em `ai.context`; (4) fixar
páginas como contexto (sugere as mais editadas); (5) ligar MCPs (opcional, em Só leitura). Pode pular qualquer passo
e refazer depois (Settings → AI → "Refazer apresentação" e comando na paleta). Aparece uma vez, na primeira vez que
a AI é usada ou ao ligar a AI.
**Fora do escopo.** Gerar o contexto com AI a partir do workspace (fica como botão opcional "Sugerir com AI", só se
der tempo).
**Toca em.** src/renderer/src/ai/ (SetupSheet, ClaudeSettings, novo Onboarding), src/shared/aiContext.ts, comandos.
**Pronto quando.** Um perfil novo passa pelo onboarding e sai com contexto salvo, persona escolhida e nada enviado à
AI sem o usuário ver; pular tudo deixa o app como hoje. Testes do fluxo (happy-dom) e da montagem do texto.

### A2. Hermine no app
**Hoje.** A Hermine 64 existe só no visualizador (https://claude.ai/artifact/Bm5HJFLEDycMEExhmp3j7M): rig, 12 roupas e
as 8 animações, num gerador fora do repo.
**Escopo.** `scripts/hermine64/` (rig e roupas, reaproveitando `scripts/herman64/ps1.mjs` e `palette.mjs`), sprites em
`src/renderer/src/herman/sprites/` (ou pasta irmã) gerados como os do Herman, com o teste de larguras. Setting
`persona` (`herman` | `hermine`, local) e `persona.skin`; o seletor de roupas mostra as da persona escolhida; as
sazonais (Bruxa em outubro, Inverno em dezembro) seguem a regra do Herman. Nome, pronome e falas: o texto do app que
diz "Herman" passa a vir da persona (copy em en e pt-BR, frases escritas à mão para os dois); o prompt do sistema usa
o nome da persona. O morro do "Até amanhã" mostra a persona escolhida.
**Fora do escopo.** Uma terceira persona; personalidades diferentes no prompt além do nome e do tom.
**Toca em.** scripts/, src/renderer/src/herman/, src/main/herman/lines.ts, src/main/ai/prompts.ts, sky/RestHill.tsx.
**Pronto quando.** Trocar a persona em Settings troca figura, roupas, nome e falas sem reiniciar; os testes de sprites
cobrem as duas; nenhuma tela ainda diz "Herman" com a Hermine escolhida (teste que varre a copy).

### A3. Memória da persona *(da proposta anterior, item 4)*
**Escopo.** ✅ Decidido pelo Érik: **automática**. Ao fim de cada conversa, a persona extrai fatos curtos e duráveis
("o projeto Auxiliadora é do banco X", "prefere respostas curtas") e os guarda sozinha, sem pedir; uma linha discreta
no balão diz "Lembrei: …" com "desfazer". Lista em Settings → AI → Memória: ver, editar, apagar um, apagar tudo, e
desligar a memória (desligada, nada novo é guardado e nada guardado vai junto). A memória é editável como o Contexto
(o mesmo lugar de edição). Vai junto como seção cercada no prompt, com teto de tamanho (os fatos mais antigos e menos
usados saem primeiro), e aparece no "Enviado junto". Nunca guarda nada de páginas marcadas "Nunca enviar" (A5) nem
segredos (senhas, tokens, números de documento: filtro antes de guardar).
**Fora do escopo.** Sincronizar a memória entre máquinas.
**Pronto quando.** Uma conversa gera fatos guardados sem confirmação, que aparecem no próximo pedido e no "Enviado
junto"; desligar para na hora; editar e apagar funcionam; o filtro de segredos tem teste.

### A4. Contexto por projeto
**Escopo.** Cada projeto de Tasks (e cada database) pode ter um contexto próprio (texto + páginas). Quando o pedido
parte de uma página/tarefa daquele projeto, o contexto dele vai junto, além do geral. Editável no menu do projeto.
**Pronto quando.** Pergunta feita numa página do projeto X leva o contexto de X e não o de Y (teste do prompt).

### A5. "Nunca enviar à AI" *(da proposta anterior, item 6)*
**Escopo.** Marcar uma página, database ou projeto como privado para a AI: nunca entra em contexto, busca de contexto,
ferramentas de leitura do workspace nem páginas fixadas. Um cadeado visível no título. As rotinas (C) respeitam.
**Pronto quando.** Teste: conteúdo marcado não aparece em nenhum prompt montado nem em resposta de ferramenta.

---

## Épico B — Conversa em balão (sem painel lateral)

### B1. O balão de conversa
**Hoje.** Clicar no Herman ou Ctrl+J abre o painel lateral `AssistantPanel` (src/renderer/src/ai/AssistantPanel.tsx,
`AssistantDock` em ai/Host.tsx); o Dock já tem um balão só para as falas sem AI.
**Escopo.** Tirar o painel lateral. Clicar na persona (ou Ctrl+J) abre um balão de conversa ancorado nela: no topo,
3–4 sugestões (B2) como botões; embaixo, um campo de texto livre; a resposta chega em streaming dentro do balão, em
Markdown; o balão cresce até um limite e rola por dentro; Esc fecha; pode ser expandido para uma folha maior quando a
conversa fica longa. As propostas (`sel-actions`) aparecem no balão com Aplicar/Descartar. O "Enviado junto" fica
embaixo de cada resposta. Mantém tudo que o painel fazia (contexto, ferramentas, cancelar, erro, setup).
**Fora do escopo.** Voz.
**Toca em.** src/renderer/src/ai/ (AssistantPanel vira BalloonChat ou similar), herman/Dock.tsx, ai/Host.tsx, shell.
**Pronto quando.** Não existe mais painel lateral; todos os testes do painel passam no balão; a11y: foco preso no
balão aberto, rótulos, axe sem nada sério; o balão nunca cobre o cursor de texto da página.

### B2. Sugestões no balão
**Escopo.** Sugestões calculadas sem AI a partir do momento: página aberta ("Resumir esta página", "Transformar em
tarefas"), tarefas atrasadas ("Replanejar 3 atrasadas"), reunião recente ("Escrever a ata"), manhã ("Planejar o dia",
C2), fim do dia ("Fechar o dia", C4). No máximo 4, as mais relevantes primeiro, cada uma vira um pedido pronto.
**Pronto quando.** Testes puros da escolha das sugestões por estado; clicar numa sugestão envia o pedido certo.

### B3. Conversas anteriores
**Escopo.** Sem painel, o histórico vai para dentro do balão: "Anteriores" lista as últimas conversas (título,
quando) e reabre uma. Guardadas localmente, com limite e "apagar todas".
**Pronto quando.** Fechar e reabrir o app mantém as últimas conversas; apagar some de vez.

### B4. Registro do que a AI fez, e desfazer *(da proposta anterior, item 3)*
**Escopo.** Cada Aplicar vira uma entrada num registro (quando, qual pedido, o que mudou, em quais páginas), com
"Desfazer tudo isto" que reverte aquele lote. Acesso pelo balão e por Settings → AI.
**Pronto quando.** Aplicar e depois desfazer deixa as páginas exatamente como antes (teste de ida e volta).

---

## Épico C — A persona ao longo do dia (AI de rotina)

### C1. Rotinas de AI
**Hoje.** O Herman já fala sozinho sem AI (src/main/herman/counsel.ts + scheduler.ts: poucas vezes por dia, nunca
digitando, nunca à noite).
**Escopo.** Um agendador de rotinas que roda AI em momentos do dia (manhã, meio do dia, fim do dia, e "quando uma
tarefa trava", C3), reusando a contenção do scheduler. O resultado não entra em lugar nenhum: chega como uma fala no
balão da persona ("Montei um plano para hoje, quer ver?") que abre a proposta. Desligado por padrão; liga no
onboarding (A1) ou em Settings → AI → Rotinas, rotina por rotina, com horários.
**Toca em.** src/main/herman/ (scheduler), src/main/ai/ (pedidos sem janela), src/shared/, Dock.
**Pronto quando.** Com a rotina da manhã ligada, a fala aparece uma vez no horário, nunca à noite nem digitando, e
nada muda no workspace sem Aplicar. Testes do agendador com relógio falso.

### C2. Planejar o dia *(da proposta anterior, item 9)*
**Escopo.** De manhã: lê agenda (calendários conectados e, se ligado, MCP como Veleiro/Google Calendar), tarefas de
hoje e atrasadas, e propõe um dia que cabe: 3 prioridades, o que adiar, blocos de tempo nos buracos da agenda.
Aplicar marca datas/prioridades nas tarefas.
**Pronto quando.** Proposta com tarefas reais e Aplicar que muda só o que foi mostrado.

### C3. Destravar o que está parado *(da proposta anterior, item 8)*
**Escopo.** Detecta tarefa adiada 3+ vezes ou parada há N dias e propõe: quebrar em passos (subtarefas), reescrever o
título como próxima ação, ou arquivar. Uma por vez, no máximo uma por dia.
**Pronto quando.** Teste da detecção; proposta aplicada cria as subtarefas certas.

### C4. Fechar o dia com a persona
**Hoje.** Fechar o dia (src/main/notebook, CloseDayScreen) é escrito à mão.
**Escopo.** No fim do dia, a persona oferece um rascunho: o que foi feito (tarefas concluídas, páginas editadas), o
que ficou, uma sugestão para amanhã. Entra na página do dia só com Aplicar; o "Até amanhã" continua igual.
**Pronto quando.** Rascunho com dados reais do dia; nada escrito sem Aplicar.

### C5. Uso, custo e limites *(da proposta anterior, item 6)*
**Escopo.** Contagem local de pedidos por dia e por origem (você, rotina), tempo e, quando o CLI informar, custo.
Limite diário para as rotinas (padrão baixo); atingido, elas param até amanhã e dizem isso uma vez.
**Pronto quando.** Settings → AI mostra o uso de hoje e da semana; o limite é respeitado (teste).

---

## Épico D — Heatmap para entender fluxos

### D1. Registro local de atividade
**Escopo.** Uma tabela local de eventos leves: tela/página aberta, edição (por página, agrupada por minuto), tarefa
criada/concluída/adiada, foco (pomodoro), pedido de AI. Só na máquina, nunca sincroniza, retenção de 12 meses,
desligável, "apagar histórico". Custo de escrita desprezível (em lote).
**Pronto quando.** Testes do registro e da retenção; desligar para de registrar na hora.

### D2. Heatmaps
**Escopo.** Uma tela "Fluxos" (na paleta e em Today): o ano em quadradinhos (atividade por dia, como um calendário) e
a semana × hora (quando você escreve, quando conclui tarefas, quando faz foco), com filtro por tipo e por projeto.
Visual do design system (tinta e pontos, sem cores de placar), sem números de streak nem "recorde".
**Pronto quando.** Desenha com dados reais e com zero dados (estado vazio); acessível (tabela alternativa).

### D3. Fluxos entre áreas
**Escopo.** De onde para onde você vai: as transições mais comuns entre telas e projetos (ex.: Today → Tasks →
página X), tempo por área por semana, e as páginas que mais puxam você de volta. Um diagrama simples (faixas ou
lista ordenada), não um painel de métricas.
**Pronto quando.** Mostra as 10 transições mais comuns da semana com dados reais.

### D4. A persona lê o seu ritmo
**Escopo.** Uma vez por semana, opcional: uma observação curta e gentil a partir do heatmap ("suas manhãs de terça
rendem; quer guardar a próxima para o projeto X?"). Sem julgamento, sem comparação com metas.
**Pronto quando.** Desligado por padrão; quando ligado, no máximo uma fala por semana.

---

## Épico E — Semana e agenda (novo)

### E1. Revisão da semana *(da proposta anterior, item 10)*
**Escopo.** Um ritual guiado no fim da semana: o que foi concluído, o que ficou, inbox a zerar, projetos sem próxima
ação, escolher as 3 coisas da semana que vem. Usa o heatmap (D2) como pano de fundo. Com AI opcional para o resumo.
**Pronto quando.** Percorrer a revisão deixa a inbox refinada e a semana com prioridades marcadas.

### E2. Blocos de tempo
**Hoje.** Há calendários conectados (CalendarScreen, `briefing.calendars`) e tarefas com data/hora.
**Escopo.** Arrastar uma tarefa para um horário livre da agenda do dia cria um bloco (a tarefa ganha hora e duração);
ver agenda + blocos lado a lado em Today; aviso suave quando o dia passa do que cabe.
**Pronto quando.** Arrastar, redimensionar e desfazer um bloco; dados na tarefa, nada escrito no calendário externo.

### E3. Projetos com rumo
**Escopo.** Cada projeto ganha um objetivo (uma frase), marcos com data e a "próxima ação" visível; projetos sem
próxima ação aparecem na revisão (E1) e no planejamento (C2).
**Pronto quando.** Criar marco, ver progresso pelo número de tarefas concluídas, sem porcentagem gamificada.

---

## Épico F — Levar e trazer, com confiança (novo)

### F1. Importar do Notion e do Obsidian
**Hoje.** Há "Import from Todoist" em Tasks e exportação Markdown (src/main/markdown.ts).
**Escopo.** Importar um export do Notion (zip Markdown/CSV: páginas, databases como databases do sel, anexos) e uma
pasta do Obsidian (.md com links `[[ ]]` virando links do sel). Prévia do que vai entrar, e tudo cai numa pasta
"Importado em …" que pode ser desfeita.
**Pronto quando.** Fixtures pequenas de cada formato importam com links e databases corretos (testes).

### F2. Exportar tudo
**Escopo.** Exportar o workspace inteiro em um zip: Markdown por página, CSV por database, anexos, e um índice; abre
bem no Obsidian. Também por pasta/projeto.
**Pronto quando.** Exportar e reimportar (F1, formato Obsidian) preserva títulos, hierarquia e links (teste de ida e
volta).

### F3. Restaurar com segurança
**Hoje.** Backups verificados existem (src/renderer/src/backup/, desde a 0.6.2).
**Escopo.** "Restaurar" guiado: escolher um backup, ver o que muda (páginas a mais/a menos), restaurar uma página só
ou tudo, com um backup automático antes. Checagem de integridade do banco na abertura, com mensagem clara se falhar.
**Pronto quando.** Restaurar uma página de um backup antigo sem tocar no resto (teste).

---

## Fechamento da release

- **README** atualizado no fim (persona, balão, rotinas, fluxos, semana, importar/exportar; Council fora).
- **docs/screens/** refeitas no visual novo (pendente desde a 0.7.1), incluindo a Hermine e o balão.
- **docs/codebase-knowledge** atualizada pelos agentes de cada item.
- Versão 0.8.0 em package.json, PR `release/0.8.0` → main, tag `v0.8.0` no commit do merge.

## Ondas (proposta)

1. **Paralelo, pouco conflito:** A2 Hermine · D1 registro de atividade · E2 blocos de tempo · F1+F2 importar/exportar
   · F3 restaurar · A5 nunca enviar.
2. **O balão (sozinho, mexe no centro da AI):** B1 + B2 + B3, depois B4.
3. **Em cima do balão:** A1 onboarding (usa A2) · A3 memória · A4 contexto por projeto · C1 rotinas → C2, C3, C4, C5.
4. **Em cima do registro:** D2, D3, D4 · E1 revisão (usa D2) · E3 projetos.
5. **Fechamento:** README, capturas, versão, PR, tag.

## Riscos

- B1 é o item maior e toca o que quase todo o resto usa: por isso vai sozinho na onda 2.
- Rotinas (C) gastam a conta do usuário: desligadas por padrão, com limite diário (C5).
- O registro de atividade (D1) é dado sensível: só local, desligável, apagável, nunca sincronizado nem enviado à AI
  sem o usuário pedir.
