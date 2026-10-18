# Release 0.6.2 — specs

Status: **decidido** · 2026-10-18 · branch `release/0.6.2` (de main @ 2d14a2c, v0.6.1)

Cada feature vira uma branch própria, cortada de `release/0.6.2`, com PR para `release/0.6.2`.
Marcadores: **❓** = decisão pendente do Érik · **✅** = decidido. Regras gerais, registros compartilhados e
pegadinhas de teste: as mesmas de `docs/plans/release-0.6.0.md`. Toda release atualiza o README.

| # | Feature | Estado |
|---|---|---|
| 1 | Abas sem duplicação | ✅ decidido, despachada |
| 2 | Melhorias: busca e navegação (era 10d da 0.6.0) | despachada; mini-spec no PR (não mexe em abas) |
| 3 | Melhorias: reuniões e transcrição (era 10e) | despachada; mini-spec no PR (inclui os 2 testes instáveis) |
| 4 | Melhorias: dados e confiança (era 10f) | despachada; mini-spec no PR |
| 5 | README | último passo |

---

## 1. Abas sem duplicação

**Hoje.** Modelo em `src/renderer/src/store/tabs.ts`: aba = `{id, history[], index}`; telas são ids falsos
(`_today`, `_calendar`, `_tasks`, `_notebook`, `_close`, `_sky`).
- `openPage(id)` (:103-114) **nunca olha as outras abas**: se a página já está aberta em outra aba, navega a aba
  ativa para ela e a página fica em duas abas. Uns 30 pontos de entrada usam isso (árvore, favoritos, busca rápida,
  links, linhas de database, Today/Tasks, Herman, alarmes, reunião, templates, arquivo, lixeira…).
- Ctrl/clique do meio e "Abrir em nova aba" sempre criam aba (:106-107); "Duplicar aba" (TabBar.tsx:52) também.
- `openScreen` (:116-123) é o único que deduplica, mas compara só a rota exata: `sel-notebook`/`_notebook` e
  `sel-sky`/`_sky` viram duas abas (aliases em notebook/route.ts:16-18, sky/route.ts:15-17).
- Voltar/avançar (:192-199) e reabrir aba fechada (:133-141) trazem de volta páginas já abertas em outra aba.
- A restauração deduplica só ids de aba, não páginas (:237, :297-302): **duplicatas são salvas e voltam para
  sempre**. Abas abertas antes da restauração terminar são concatenadas sem checar (:319-323).
- "Nova janela" a partir de uma aba vazia abre uma segunda janela **não efêmera** que restaura as mesmas abas e
  disputa `shell.tabs` com a primeira (menuCommands.ts:95, src/main/index.ts:155-163).
- Barra de abas: abas encolhem até 44 px (styles/shell.css:591-597), sem rolagem nem lista; sem limite de abas.
- Testes: nada cobre `openScreen`, deduplicação entre abas, aliases, restauração com páginas repetidas.

**Escopo.** Regra central: **uma página (ou tela), uma aba**, por janela.
- **Chave canônica** de aba: `sel-notebook` → `_notebook`, `sel-sky` → `_sky` (e qualquer alias futuro num só
  lugar). Toda comparação usa a chave canônica.
- **`openPage` sem `newTab`**: se a página já está aberta em outra aba desta janela → **✅ foca essa aba** (a aba ativa fica como está); senão navega a aba
  ativa como hoje.
- **Ctrl/clique do meio / "Abrir em nova aba"**: se já aberta → **✅ foca a aba existente** (nunca duplica); senão nova aba como hoje.
- **`openScreen`**: igual a hoje, com a chave canônica.
- **Voltar/avançar** para uma página aberta em outra aba: a aba atual fica com ela e a **outra aba é fechada**
  (a história da aba atual vence; nada de pular de aba ao apertar Voltar).
- **Reabrir aba fechada** (Ctrl+Shift+T): se a página já está aberta, foca a aba existente.
- **Restauração**: deduplica por chave canônica (fica a primeira; se a ativa era uma duplicata, a ativa passa a ser
  a sobrevivente); abas abertas durante a restauração entram com a mesma regra. Quem já tem duplicatas salvas fica
  limpo no primeiro start.
- **✅ "Duplicar aba" sai do menu da aba** ("Abrir em nova janela" continua).
- **Janelas**: toda janela além da principal é **efêmera** (não grava `shell.tabs`), inclusive "Nova janela" a partir
  de uma aba vazia (abre com uma aba vazia). A deduplicação vale dentro de cada janela.
- **✅ Barra de abas com muitas abas**: as abas param de encolher numa largura legível (~110 px), a barra rola
  na horizontal (roda do mouse também) mantendo a aba ativa à vista, e um botão ⌄ no fim lista todas as abas
  (título, fechar, Enter para ir). "Fechar abas à direita" no menu de contexto da aba.

**Fora do escopo.** Fixar aba, grupos de abas, aba de pré-visualização (itálico do VS Code), deduplicar entre
janelas, sincronizar abas entre dispositivos.

**Toca em.** store/tabs.ts (núcleo), notebook/route.ts e sky/route.ts (aliases), shell/TabBar.tsx e shell.css,
shell/menuCommands.ts (nova janela), src/main/index.ts (janela efêmera sem `?page=`), testes.
Os chamadores de `openPage` **não** mudam: a regra mora no store.

**Pronto quando.** Testes do store: abrir página já aberta (cada modo), Ctrl-clique, aliases notebook/sky, voltar e
avançar para página aberta em outra aba, reabrir, restauração com duplicatas salvas, abas abertas durante a
restauração, janela efêmera. Typecheck + testes verdes. Na tela: clicar na mesma página pela árvore, busca e link
não cria aba nova; Meditações por link e pela barra lateral é uma aba só; reiniciar com duplicatas salvas limpa.
