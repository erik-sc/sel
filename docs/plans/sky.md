# Céu / Sky — spec (release 0.6.0, feature 6)

Status: **decidido** com o Érik em 2026-10-15 · substitui a seção 6 ("Jardim") de `docs/plans/release-0.6.0.md` ·
onda 2 (depois de Meditações e Pomodoro) · branch própria cortada de `release/0.6.0`, PR para `release/0.6.0`.

Material de referência, nesta pasta:
- `docs/plans/sky/animations.html` — **a referência visual**: as 8 animações decididas, as 45 figuras e as 13 noites
  raras, com tempos e versões de movimento reduzido. Abrir no navegador.
- `docs/plans/sky/figures.js` — **os dados das 45 figuras** (estrelas e linhas). Portar como estão.
- `docs/plans/sky/directions.html` — histórico: as quatro direções (cena, canteiros, árvore, constelações) e os
  extras experimentados. O layout do céu está lá (direção D, extra "Roda do ano").

Marcadores: **✅** = decidido.

---

## Hoje

- **Meditações** (antes "Ink notebook"; ids internos continuam `notebook`): página de sistema `sel-notebook`
  (`props.system: 'notebook'`), um bloco por dia com id `sel-notebook-YYYY-MM-DD` (`entryId`, `dayOfEntryId`,
  `readEntry` em `src/shared/notebook.ts`). Sincroniza como qualquer página. Dias passados são imutáveis. O
  `NotebookService` (`src/main/notebook/service.ts`) cria a página com `ensure()` e é o molde para um serviço de
  página de sistema.
- **Fechar o dia** (`src/renderer/src/notebook/CloseDayScreen.tsx`): quatro passos e, no fim, o `Rest`
  (`:36-70`), uma tela escurecida com "Until tomorrow" / "Até amanhã" (`close.css:195+`). Nada do dia fechado é
  gravado além da linha e dos planos.
- **Tasks**: a DB de sistema guarda `tasks.completedAt` (`src/shared/tasks/index.ts:25`). Uma task recorrente
  sobrescreve esse campo. To-dos em páginas são blocos `to_do` com `props.checked` e só têm `updatedAt`.
- **Pomodoro** (feature 5, PR #42, branch `claude/pomodoro-81bbd6`): a fase de foco que chega ao fim emite
  `pomodoro:completed` com `{ at, minutes }` (`src/shared/pomodoro.ts`, `POMODORO_CHANNELS.completed`) no main e em
  todas as janelas, e guarda um histórico **local** em `pomodoro.completed` (até 2000, não sincroniza).
- **Sistema**: `SYSTEM_KINDS = ['tasks', 'notebook']` (`src/shared/system.ts:12`). Uma página de sistema fica na
  raiz e não pode ser apagada, movida nem duplicada.
- **Rotas**: telas são rotas `_today`, `_calendar`, `_tasks`, `_notebook` (`src/renderer/src/store/tabs.ts:30-36`),
  abertas por `openScreen`. Botões na barra lateral em `src/renderer/src/shell/Sidebar.tsx:120-155`, com ícones de
  `src/renderer/src/ui/icons.tsx`.
- **Linguagem visual**: o Herman é uma linha só (`herman/poses.ts`, `Figure.tsx`), que se desenha com
  `stroke-dasharray`/`stroke-dashoffset` e `pathLength=1` (`herman.css:66-80`). O app já tem ícones de traço único
  (`ui/lineIcons.ts`). Tokens: `--duration: 300ms`, `--ease` (`styles/tokens.css:101-103`); claro papel e tinta,
  escuro carvão; um acento índigo.
- **Princípio**: "No streaks, no scores" (README.md:25; CloseDayScreen.tsx:4). O céu respeita isso: **cresce,
  nunca apaga, nunca mostra números**.

---

## Escopo

### O que é

✅ **Metáfora: um céu de constelações.** Cada dia com uma linha nas Meditações acende **uma estrela**. As estrelas de
um mês desenham, uma de cada vez, **uma figura** (o Barco, o Ipê, a Rede…). Quando o mês acaba, a constelação ganha
o nome. Cada ano é **um céu**: doze meses em roda, com a lua de verdade no meio. O desenho é de **carta celeste
antiga**: tinta sobre papel no tema claro, noite no escuro, tudo em traço, sem imagens.

✅ **Nome: Céu / Sky.** Barra lateral, título da aba, comando, menu e Settings dizem "Céu" (pt-BR) / "Sky" (en).
Internamente tudo é `sky` (rota `_sky`, página `sel-sky`, `props.system: 'sky'`, settings `sky.*`, IPC `sky:*`,
pasta `sky/`). Isso evita repetir o caso notebook/Meditações. Na paleta, as keywords "céu", "sky", "estrelas",
"stars", "constelações", "constellations", "jardim" e "garden" acham a tela.

### O que faz crescer, e com que peso

✅ **Só a Meditação acende estrela.** Uma linha escrita num dia = uma estrela daquele dia. Tasks e pomodoros
enfeitam, nunca acendem:

| Ação | No céu | Fonte | Passado |
|---|---|---|---|
| Linha das Meditações | uma estrela no mês dela | blocos `sel-notebook-YYYY-MM-DD` (derivado, nada novo gravado) | **todo o histórico** |
| Task concluída na DB de Tasks | um grão de poeira na Via Láctea | `tasks.completedAt` (derivado) | sim (uma recorrente fica só com a última data: o grão muda de lugar; aceito) |
| To-do marcado numa página | um grão de poeira | evento gravado em `sel-sky` na hora (ver Dados) | não (não há data) |
| Fase de foco do pomodoro até o fim | um anel de halo na estrela daquele dia (até 3); sem estrela no dia, um grão | evento gravado em `sel-sky` | o histórico local `pomodoro.completed` deste computador, uma vez |
| Fechar o dia | nada a mais (a linha dele já é a Meditação) | — | — |
| Reunião gravada | nada | — | — |

✅ **Nunca apaga.** Dia sem linha não deixa marca: não há contorno do que faltou, não há lugar vazio desenhado.
Desmarcar uma task não tira o grão. Apagar uma página não tira nada do céu.

✅ **Nenhum número na tela.** Nada de contagem, dias seguidos, nível ou porcentagem. A data de uma estrela só aparece
ao passar o mouse. Estrelas não têm tamanho nem brilho que meçam alguma coisa: o tamanho da linha, o humor e a
produtividade nunca mudam o desenho.

### O desenho (algoritmo, determinístico)

Tudo que decide posição e forma fica em **`src/shared/sky/`**, puro (sem DOM, sem Electron), testado em node. Os
mesmos dados dão o mesmo céu em qualquer computador. A única aleatoriedade é um sorteio semeado por strings estáveis
(datas e ids), nunca por `Math.random`.

- **Acaso** (`random.ts`): `hash(s)` = FNV-1a 32 bits seguido do finalizador do murmur3
  (`h ^= h>>>16; h = imul(h, 0x85ebca6b); h ^= h>>>13; h = imul(h, 0xc2b2ae35); h ^= h>>>16`), e `rng(seed)` =
  mulberry32 sobre `hash(seed)`. Os dois estão no `<script>` de `animations.html`; copiar e fixar com vetores de teste.
- **Caixa**: o céu de um ano é desenhado num `viewBox` de **800 × 460**. A espessura de traço não escala: a linha
  tem 1–1,4 px na tela em qualquer tamanho, como no protótipo (`--px` = largura do viewBox ÷ largura na tela).
- **A roda do ano** (✅ extra "Roda do ano"): uma elipse fina de centro (400, 232), rx 318, ry 150. O mês k (0 =
  janeiro) fica no ângulo −90° + k·30°, no sentido horário. Um traço curto e fraco entre meses, como as divisões de um
  zodíaco. Por trás, três arcos e cinco meridianos de carta celeste, muito fracos.
- **Figura do mês** (`figures.ts`): as 45 figuras de `docs/plans/sky/figures.js` (estrelas numa caixa 100×100, y
  para baixo, já na ordem de acender, e `lines` como polilinhas de índices). A figura de um mês é
  `FIGURE_SEQUENCE[(ano·12 + mês−1) mod 45]`. `FIGURE_SEQUENCE` é uma **lista literal e congelada** dos 45 ids (gerar
  uma vez com um shuffle de semente `'sel-sky-figures'` e colar no código). Trocar a ordem mudaria os céus antigos;
  um teste trava a lista. Meses vizinhos nunca repetem, e o mesmo mês só repete depois de 15 anos. Na roda, a figura
  ocupa 64 unidades, girada por `(rng('sel-sky-rot:' + YYYY-MM)() − 0,5) · 0,5` rad.
- **Estrelas do mês**: as linhas do mês, em ordem de data. A j-ésima acende a estrela j da figura. Um segmento da
  figura aparece quando as duas pontas estão acesas. Depois da última estrela da figura (6 a 11, conforme a figura),
  os dias seguintes viram **estrelas soltas** perto dela: ângulo e raio sorteados por `'sel-sky-loose:' + dia`, a 36–60
  unidades do centro do mês, menores e em `--text-secondary`.
- **Via Láctea** (✅ extra): uma faixa fixa que atravessa o céu na diagonal, de (−20, 400) a (820, 70), com uma
  ondulação leve. Cada grão tem uma chave estável (id da task + data, ou id do evento); a posição ao longo da faixa e
  o desvio (soma de três sorteios − 1,5, × 24) saem de `rng(chave)`. O raio varia de 0,6 a 1,1, a opacidade fica em
  ~0,6. Um ano de tasks forma a faixa sozinho.
- **Halo do pomodoro**: na estrela do dia, 1 a 3 anéis finos em acento, a 4,2 + 1,6·i unidades, com opacidade 0,35.
- **Estrelas de fundo**: 60 por ano, sorteadas por `'sel-sky-field:' + ano`, muito fracas. Não significam nada.
- **A primeira estrela** (✅ extra): a primeira linha de todas as Meditações ganha, para sempre, um brilho de quatro
  pontas em volta.
- **A lua** (`moon.ts`): fase = ((t − 2000-01-06T18:14Z) / 29,530588853 dias) mod 1, ao meio-dia local do dia. No
  centro da roda, raio 20: um círculo fino com a parte iluminada preenchida em `--moon` (token novo, amarelo
  fraquinho). O hemisfério decide de que lado ela aparece acesa. O nome da fase (8 nomes) é o título da tela.
- **Nomes**: mês já passado com pelo menos uma estrela mostra embaixo da figura, em itálico serifado, o nome que o
  usuário deu (ver Nomes seus) ou o da figura no idioma da UI ("o Barco" → "O Barco"). O mês corrente fica sem nome.
- **Mês sem nenhuma linha**: nada é desenhado no lugar dele, nem nome. A roda continua passando por ali.
- **Céus anteriores**: cada ano é um céu. Os anos anteriores com estrelas aparecem embaixo do céu atual, como
  miniaturas com legenda ("O céu de 2025"). Clicar troca o céu grande para aquele ano. Esc ou "O céu de agora" volta.

API sugerida: `skyScene(input: SkyInput, year: number, today: string): SkyScene`, com `SkyInput` = `{ meditations:
{day, text}[], grains: {key, day}[], pomodoros: {key, day}[], names: Record<'YYYY-MM', string>, hemisphere: 'south' |
'north', locale }` e `SkyScene` = posições prontas (meses com figura, estrelas, segmentos, nome; grãos; halos;
primeira estrela; lua; eco; evento da noite). O componente só desenha a cena.

### Dados e sincronização

✅ **Derivar o que já existe, e gravar só o que não existe, numa página de sistema `sel-sky`** (molde do notebook:
`ensure()` com `{ id: 'sel-sky', type: 'page', parentId: null, props: { system: 'sky', title: [['Céu' | 'Sky']] } }`;
`SYSTEM_KINDS` ganha `'sky'`). Os blocos filhos sincronizam pelo engine atual, que não muda.

- **Estrelas e linhas**: derivadas dos blocos `sel-notebook-*`. Nada é gravado.
- **Grãos de tasks da DB**: derivados de `tasks.completedAt`. Nada é gravado.
- **Eventos gravados**: um bloco por acontecimento, com **id determinístico**. Cada bloco é escrito uma vez e nunca
  editado, então dois computadores nunca entram em conflito: o merge vira uma união. Tipo `text`, `props: { sky:
  'grain' | 'pomodoro', day: 'YYYY-MM-DD' }`, sem texto visível.
  - To-do marcado: `sel-sky-todo-<blockId>-<YYYY-MM-DD>`. Gravado no main, em `Repository.update`, quando um bloco
    `to_do` passa de `checked: false` a `true` (não na DB de Tasks, que já tem `completedAt`). Marcar e desmarcar no
    mesmo dia não duplica.
  - Pomodoro: `sel-sky-pomodoro-<at>` (o `at` em ms do `PomodoroCompleted`), gravado no main pelo hook de
    `pomodoro:completed`. Na primeira abertura do Céu neste computador, o histórico local `pomodoro.completed` é
    gravado do mesmo jeito. Os ids são os mesmos, então repetir não duplica nada.
- **Nomes dados aos meses**: `sel-sky-name-YYYY-MM`, `props: { sky: 'name', text }` (1–40 caracteres, limpo como
  `cleanLine`). Último que escreve ganha, como qualquer bloco.
- **Estado deste computador** (settings locais, não sincronizam): `sky.lastSeen` (o dia da estrela mais nova já
  mostrada), `sky.firstShown` (a primeira abertura já tocou), `sky.eventShown` (o dia cujo evento já tocou).
- O repositório protege `sel-sky` como página de sistema. A página nunca é mostrada como página comum: abri-la por
  link ou busca leva à rota `_sky`, como `isNotebookRoute` faz com o notebook.

### Onde vive

✅ **Tela própria** `_sky`:
- Botão **Céu** na barra lateral, logo abaixo de Meditações, com um ícone novo de estrela de quatro pontas em
  `ui/icons.tsx`, no traço dos outros. Comando `open-sky` na paleta (com as keywords acima), item no menu Exibir
  ("Sky") e atalho **Ctrl+Alt+G**, o que estava reservado ao jardim (`src/shared/shortcuts.ts`).
- Layout em uma coluna mais larga que a página (até ~960 px), centrada:
  - kicker "Carta celeste" / "Star chart";
  - título com o nome da fase da lua ("Lua crescente");
  - a data por extenso, pequena;
  - o céu;
  - uma linha de legenda embaixo, vazia na maioria das noites. Mostra o eco do Neste dia, ou a legenda do evento da
    noite (ex.: "Perseidas", "Solstício de inverno · a noite mais longa do ano");
  - "Céus anteriores", quando houver.
- **Vazio** (nenhuma Meditação ainda): a carta, a lua e as estrelas de fundo, com a legenda "Cada dia escrito nas
  Meditações acende uma estrela." / "Each day you write in Meditations lights a star." e um link "Escrever a de hoje"
  / "Write today's" que abre as Meditações.

✅ **Fim do Fechar o dia**: o `Rest` passa a mostrar o céu do ano por cima de "Até amanhã" (animação 14), com a
estrela da linha que acabou de ser escrita acendendo. Com o Céu desligado, o `Rest` fica como hoje.

✅ **Fora daqui na 0.6.0**: rodapé do Hoje, vislumbre ao lado do Herman, widget.

### Interação

✅ **Só contemplar, com duas exceções pequenas:**
- Passar o mouse numa estrela mostra um tooltip com o dia por extenso e a linha daquele dia. Clicar abre as
  Meditações (`openNotebook`); se a tela delas aceitar uma âncora de dia, rola até ele.
- O nome de uma constelação passada é um botão, alcançável por Tab. Passar o mouse ou focar mostra até quatro linhas
  daquele mês e "e outras linhas…" (✅ extra "O mês no nome"); clicar abre as Meditações.
- ✅ **Nomes seus** (extra): no **último dia do mês**, se o mês tem pelo menos uma estrela, o Fechar o dia ganha um
  passo opcional depois da linha: "Outubro virou uma constelação." + campo "Que nome você dá a ela?", com o nome da
  figura como placeholder. Enter continua; vazio deixa o nome da figura. Grava `sel-sky-name-YYYY-MM`. Não há outro
  lugar para renomear na 0.6.0.
- Não dá para plantar, mover, apagar ou escolher figura.

### As animações (referência: `docs/plans/sky/animations.html`, parte 1)

✅ Oito momentos, todos em traço, todos uma vez só, por causa de algo que o usuário fez. Durações em múltiplos de
`--duration`, com `--ease` do app. Só a coisa nova se mexe; depois de terminar, nada fica se mexendo, a não ser o anel
do Neste dia.

| # | Momento | Animação (escolhida pelo Érik) | Duração | Movimento reduzido |
|---|---|---|---|---|
| 1 | Estrela nova (linha escrita) | **A caneta + Quatro pontas.** A estrela anterior pisca em acento (×1,5; 4×), a linha se desenha dela até o lugar novo (dash, 6×, ease-in-out), um brilho de quatro pontas abre e fecha girando (4,5×), a estrela fica em acento e assenta em tinta (16×) | ≈ 2,8 s | fade 0,5 s |
| 8 | Mês vira constelação (1ª abertura depois do fim do mês) | **A figura respira.** Uma onda na ordem das estrelas: cada uma cresce (×1,8) e volta, as linhas acendem em acento e voltam (7–9×, defasadas 0,4× por estrela); depois o nome se escreve da esquerda para a direita (`clip-path`, 6×) | ≈ 4,5 s | só o nome, com fade |
| 9 | Task concluída | **Poeira.** O grão chega com um rastro curto (4×), brilha maior ao pousar e assenta (5×) | ≈ 1,5 s | aparece no lugar |
| 10 | Fim de um pomodoro | **Estrela cadente.** Uma estrela cadente com rastro largo e apagado cruza o céu (4×); depois a caneta desenha o anel do halo (5×), que assenta a 0,35 | ≈ 3 s | só o halo, com fade |
| 12 | Neste dia | **Cintilar.** A estrela do mesmo dia de um ano atrás fica em acento, e dois anéis respiram desencontrados (ciclo de 14×), enquanto a tela estiver aberta naquele dia | contínuo | um anel parado |
| 14 | Até amanhã | A janela escurece (8×), o céu aparece por baixo (5×), a lua sobe 12 px (6×), a estrela de hoje acende (animação 1), e só então "Até amanhã" (5×) e a dica | ≈ 8 s | céu pronto, palavras com fade |
| 15 | Primeira abertura neste computador | **Estrela por estrela.** A carta se desenha (arcos, 5×), as estrelas já escritas acendem em ordem de data, cada uma puxando sua linha (0,75× entre estrelas, comprimido para caber em ~9 s no total, com no máximo ~120 estrelas animadas e o resto aparecendo junto), cada mês fechado escreve o nome, a lua sobe por último | ≈ 9 s, uma vez | céu pronto, com fade |
| 20 | Abrir a tela | Fade e 4 px para cima (2×), como o Hoje e as Meditações. Se há estrela mais nova que `sky.lastSeen`, toca a animação 1 só para ela (até três, em sequência), depois a 8 se um mês fechou | 0,6 s | fade 0,5 s |

O eco do Neste dia (#12) usa o `onThisDay` de `src/shared/notebook.ts`. Como cada ano tem o seu céu, a estrela que
cintila está no céu do ano dela: no céu grande, se for o ano mostrado, e também na miniatura daquele ano em "Céus
anteriores". A legenda embaixo do céu diz "Há um ano, neste dia, você escreveu: “…”" (anos > 1: "Há 2 anos…",
como já é nas Meditações). Clicar na legenda mostra aquele céu.

Movimento reduzido: o `prefers-reduced-motion` global de `styles/global.css` já encurta as animações. Além disso,
o componente não toca o que atravessa ou pisca (estrela cadente, eventos de passagem) e mostra o estado final.

### Noites raras (referência: `animations.html`, parte 3)

✅ Eventos que não dependem do usuário. `events.ts`, puro: `eventOf(day, { hemisphere, firstStarDay })` devolve
`null` ou um evento. As regras:
- O acaso é a data: o sorteio usa `rng('sel-sky-event:' + dia)`, então o mesmo dia dá o mesmo evento em todos os
  computadores, e nada é gravado.
- No máximo um evento por noite. Os de calendário vêm primeiro, nesta ordem: eclipse > aniversário da primeira estrela
  > chuva de meteoros > solstício/equinócio > ano novo; depois os sorteados.
- O que é passageiro toca **uma vez por dia neste computador**, ao abrir o Céu (`sky.eventShown`), depois da
  animação 20. O que fica (halo, cometa, lua de cobre, céu escuro) é só o desenho daquela noite.
- Nunca vira notificação, nunca aparece fora da tela do Céu, e não existe "você perdeu".
- Settings → Hoje → "Noites raras no céu" (`sky.events`, padrão ligado) desliga todos.

| Evento | Quando | Frequência | O que fica | Herman |
|---|---|---|---|---|
| Chuva de meteoros | fixo: Quadrântidas 3–4 jan, Líridas 22 abr, Eta Aquáridas 5–6 mai, Delta Aquáridas 29–30 jul, Perseidas 12–13 ago, Oriônidas 21 out, Leônidas 17 nov, Geminídeas 13–14 dez | ≈ 13 noites/ano | nada; 8 meteoros de um radiante, uma vez | "Hoje é noite das Perseidas." |
| Eclipse da lua | tabela de eclipses lunares parciais e totais de 2026 a 2035, conferida com a NASA (eclipse.gsfc.nasa.gov) antes de gravar; de memória: 2026-03-03 total, 2026-08-28 parcial, 2028-01-12 parcial, 2028-07-06 parcial, 2028-12-31 total, 2029-06-26 total, 2029-12-20 total, 2030-06-15 parcial | 1–3/ano | lua cor de cobre (`--copper`) a noite toda; a sombra passa ao abrir (16×) | "Eclipse esta noite. A lua fica cor de cobre." |
| Halo da lua cheia | fase "cheia" e `rng < 1/3` | ≈ 4/ano | dois anéis finos em volta da lua | — |
| Cometa | sorteado no primeiro dia (`rng < 1/365`, e não houve cometa nos 120 dias anteriores); fica 7 noites, andando um pouco a cada noite | ≈ 1/ano | o cometa (núcleo + três traços de cauda) | "Tem um cometa passando. Fica alguns dias." (1ª noite) |
| Estrela cadente | `rng < 1/45` | ≈ 8/ano | nada | — |
| Satélite | `rng < 1/60` | ≈ 6/ano | nada; um ponto cruza devagar (40×) | — |
| Nuvem | `rng < 1/40` (1/30 nos meses de chuva do hemisfério) | ≈ 10/ano | nada; uma nuvem de traço (o ícone `cloud`) cruza devagar, escondendo estrelas | — |
| Revoada | outono do hemisfério, `rng < 1/40` | ≈ 2/ano | nada; cinco pássaros de traço em V | — |
| Vaga-lumes | verão do hemisfério, `rng < 1/15` | ≈ 6/ano | piscam devagar perto da borda de baixo enquanto a tela estiver aberta | — |
| Aniversário da primeira estrela | todo ano, na data da primeira Meditação | 1/ano | a primeira estrela com o brilho mais forte | "A primeira estrela faz aniversário hoje." |
| Solstício / equinócio | tabela fixa 2026–2040 (dados do USNO); nome certo para o hemisfério | 4/ano | o nome na legenda; os arcos da carta acendem uma vez | "A noite mais longa do ano." (só no solstício de inverno) |
| Ano novo | 1º de janeiro | 1/ano | nada; três fogos pequenos e longe, de traço; o céu novo começa vazio | "Feliz ano novo. O céu de 2027 começa vazio, como uma página." |
| Noite sem lua | fase "nova"; é um estado do céu, não conta como evento e convive com qualquer um | ≈ 12/ano | o dobro de estrelas de fundo, bem fracas | — |

Os sorteados entram nessa ordem, um só por noite: cometa > halo > vaga-lumes > revoada > estrela cadente > satélite >
nuvem. Somando o calendário (~21 noites) e os sorteados (~40), dá por volta de uma noite em seis. Um teste de 10 anos
garante entre ~45 e ~85 noites com evento por ano.

### Estações e hemisfério

✅ No céu, as estações dão lugar à **lua de verdade**, e ao hemisfério para os eventos de estação (verão, outono,
meses de chuva, nomes de solstício). Setting `sky.hemisphere` (`'south' | 'north'`) em Settings → Hoje. Adivinhar
pelo fuso do sistema não é confiável, então o padrão é **`south` quando a língua da UI é pt-BR e `north` nos outros
casos**. O usuário troca.

### Herman

✅ Fala raramente, com linhas escritas de antemão em `src/main/herman/lines.ts` (no mesmo molde das que existem), pt-BR
e en, só nestes momentos e uma vez por dia no máximo:
- uma constelação ganhou o nome, na abertura em que a animação 8 toca: "Outubro virou o Barco." / "October became
  the Boat." (com o nome dado pelo usuário quando houver);
- as noites marcadas com fala na tabela acima.

Nunca sobre falta, nunca com número. Com o Herman desligado ou quieto, nada muda no céu.

### Pode desligar

✅ Settings → Hoje (`TodaySettings.tsx`):
- "Mostrar o Céu" (`sky.enabled`, padrão ligado). Desligado: somem o botão, o comando, o atalho (ele não faz nada) e
  o céu do Fechar o dia. Os eventos gravados continuam sendo gravados, para o céu estar certo se voltar.
- "Hemisfério" (`sky.hemisphere`).
- "Noites raras no céu" (`sky.events`).

Os três são settings locais, no `WRITABLE_SETTINGS`/`settingValueFor` de `src/main/validate.ts`.

### Copy (pt-BR / en), em `src/renderer/src/sky/copy.ts`, no molde de `notebook/copy.ts`

| chave | pt-BR | en |
|---|---|---|
| title (barra lateral, aba, comando) | Céu | Sky |
| kicker | Carta celeste | Star chart |
| phase[0..7] | Lua nova · Lua crescente · Quarto crescente · Lua gibosa crescente · Lua cheia · Lua gibosa minguante · Quarto minguante · Lua minguante | New moon · Waxing crescent · First quarter · Waxing gibbous · Full moon · Waning gibbous · Last quarter · Waning crescent |
| empty | Cada dia escrito nas Meditações acende uma estrela. | Each day you write in Meditations lights a star. |
| emptyLink | Escrever a de hoje | Write today's |
| echo(years, text) | Há um ano, neste dia, você escreveu: “…” / Há N anos… | A year ago today you wrote: “…” / N years ago… |
| earlierSkies | Céus anteriores | Earlier skies |
| skyOf(year) | O céu de 2025 | The sky of 2025 |
| backToNow | O céu de agora | Tonight's sky |
| moreLines | e outras linhas… | and other lines… |
| nameStepTitle(month) | Outubro virou uma constelação. | October became a constellation. |
| nameStepAsk | Que nome você dá a ela? | What will you call it? |
| nameStepHint | Dê um nome, ou deixe o da figura. Enter continua. | Give it a name, or keep the figure's. Enter goes on. |
| settings.show | Mostrar o Céu | Show the Sky |
| settings.hemisphere | Hemisfério: Sul / Norte | Hemisphere: Southern / Northern |
| settings.events | Noites raras no céu | Rare nights in the sky |
| loadFailed / tryAgain | Não foi possível abrir o céu. / Tentar de novo | The sky could not be opened. / Try again |

Os nomes das figuras (pt e en) estão em `figures.js` e vão para `figures.ts` com o artigo ("o Barco" / "the Boat"):
o artigo minúsculo serve para frases, e o rótulo do céu põe a primeira letra em maiúscula. Os nomes de eventos e
solstícios por hemisfério também entram na copy. Não existe framework de i18n.

---

## Fora do escopo

- Rodapé do Hoje, vislumbre perto do Herman, widget do céu.
- Plantar, mover, apagar estrelas, escolher a figura do mês, renomear fora do passo do Fechar o dia.
- A figura nascer de uma palavra escrita no mês; sons novos (o sino das Meditações continua só no Fechar o dia, como
  hoje); salvar o céu como imagem; o "céu que cintila" sem motivo; o Herman desenhado dentro do céu.
- Exportar ou mostrar estatísticas, de qualquer tipo.
- Astronomia de verdade além da fase da lua e das tabelas fixas (posição de planetas, constelações reais).
- Mudar o engine de sync.

## Toca em

- **Novo** `src/shared/sky/`: `random.ts`, `figures.ts` (porta de `docs/plans/sky/figures.js` + `FIGURE_SEQUENCE`),
  `layout.ts` (`skyScene`), `moon.ts`, `events.ts`, `index.ts` (tipos `SkyInput`, `SkyScene`, `SkyApi`, ids e keys) e
  testes `*.test.ts`.
- **Novo** `src/main/sky/`: `service.ts` (`ensure`, montar o `SkyInput` a partir do notebook, da DB de Tasks e dos
  blocos `sel-sky`, gravar eventos e nomes, backfill do pomodoro local), `register.ts` (IPC `sky:view`, `sky:name`,
  push `sky:changed`), testes, incluindo um `sky.sync.test.ts` no molde de `notebook.sync.test.ts`.
- **Novo** `src/renderer/src/sky/`: `route.ts` (`SKY_ROUTE = '_sky'`, `openSky`, `isSkyRoute` para `_sky` e
  `sel-sky`), `Host.tsx` (chunk sob demanda), `SkyScreen.tsx`, `SkyChart.tsx` (o SVG, usado também pelo Fechar o
  dia), `copy.ts`, `sky.css` (só tokens).
- `src/shared/system.ts` (`'sky'` em `SYSTEM_KINDS`), `src/main/db/repository.ts` (hook de `to_do` marcado em
  `update`, com o mínimo de acoplamento: um callback injetado), o registro do hook `pomodoro:completed` no main.
- Registros compartilhados: `src/shared/api.ts` (INVOKE, MenuCommand `open-sky`), `src/preload/index.ts` e
  `index.test.ts` (INVOKE_CHANNELS), `src/main/validate.ts` (`sky.*`), `src/renderer/src/commands/builtin.ts`,
  `src/shared/shortcuts.ts` (Ctrl+Alt+G), `src/main/menu.ts`, `src/renderer/src/shell/menuCommands.ts`,
  `src/renderer/src/shell/Sidebar.tsx`, `src/renderer/src/store/tabs.ts` (`SKY_ROUTE`), `Shell.tsx` (rota e
  `sel-sky` → `_sky`), `src/renderer/src/shortcuts/catalog.ts`.
- `src/renderer/src/notebook/CloseDayScreen.tsx` + `close.css` (o céu no `Rest`; o passo de nomear) e `copy.ts`.
- `src/renderer/src/briefing/TodaySettings.tsx` (os três settings), `src/renderer/src/ui/icons.tsx` (ícone novo).
- `src/main/herman/lines.ts` (as falas).
- `src/renderer/src/styles/tokens.css` + `appearance/schema.ts`: tokens novos `--moon` e `--copper`, com valores
  claro e escuro (ver `animations.html`). O teste exige a mesma lista nos dois arquivos.

## Pronto quando

- **Testes puros** (`npm test`, Node 24):
  - `random`: vetores fixos de `hash` e `rng`.
  - `figures`: 45 ids únicos; todo índice de `lines` é válido; 6 a 11 estrelas por figura; `FIGURE_SEQUENCE` tem cada
    id uma vez e é igual à lista travada; nomes pt e en não vazios.
  - `layout`:
    - a mesma entrada dá a mesma cena, também com as listas embaralhadas na entrada;
    - a estrela j de um mês está na estrela j da figura, e as soltas aparecem depois da última estrela da figura;
    - um segmento só aparece com as duas pontas acesas;
    - o mês corrente não tem nome, um nome dado vence o da figura, e mês sem linhas não desenha nada;
    - halos param em 3, e pomodoro sem estrela vira grão;
    - a primeira estrela é a mais antiga de todos os anos;
    - os céus anteriores listam só anos com estrelas;
    - nenhuma posição sai do viewBox.
  - `moon`: luas cheias de 2026 (3 jan, 1 fev, 3 mar, 2 abr, 1 e 31 mai, 29 jun, 29 jul, 28 ago, 26 set, 26 out,
    24 nov, 24 dez) e novas (18 jan, 17 fev, 19 mar, 17 abr, 16 mai, 15 jun, 14 jul, 12 ago, 11 set, 10 out, 9 nov,
    9 dez) com o nome certo, ±1 dia; o lado aceso muda com o hemisfério.
  - `events`: as datas fixas dão o evento delas; a prioridade de calendário vale; nunca há dois eventos numa noite; o
    mesmo dia dá o mesmo evento; o cometa dura 7 noites e não volta em 120 dias; a estação segue o hemisfério; em 10
    anos, cada ano tem entre ~45 e ~85 noites com evento.
- **Testes do main**:
  - `ensure` cria `sel-sky` uma vez, e o repositório a protege como sistema;
  - marcar um to-do grava um evento, e marcar/desmarcar/marcar no mesmo dia continua um;
  - um `pomodoro:completed` grava `sel-sky-pomodoro-<at>`, e o backfill do histórico local não duplica;
  - o nome é limpo, limitado a 40 caracteres e regravável;
  - sync de dois dispositivos com eventos diferentes vira a união, sem conflito.
- `npm run typecheck` verde.
- **Na tela** (app buildado, `--user-data-dir` de rascunho; ver a memória "selida-test-and-edit-gotchas"):
  - `Ctrl+Alt+G` e o botão abrem o Céu;
  - com Meditações antigas, a primeira abertura toca a 15 e a segunda abre direto (20);
  - escrever a linha de hoje e reabrir toca a 1;
  - concluir uma task e terminar um pomodoro (com foco de 1 min) tocam a 9 e a 10;
  - o Fechar o dia termina com o céu e a estrela nova (14);
  - no último dia do mês aparece o passo de nomear;
  - tema claro e escuro;
  - movimento reduzido (Windows: "Mostrar animações" desligado) não deixa nada atravessar a tela;
  - hover numa estrela mostra a linha; clicar abre as Meditações;
  - os três settings funcionam.
- Nenhum número aparece na tela do Céu (conferir à mão e com um teste de render que procure dígitos fora da data do
  tooltip e do "O céu de AAAA").
