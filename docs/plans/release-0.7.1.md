# Release 0.7.1 — uma linguagem só

Status: **pronta para PR** · 2026-10-22 · pedido do Érik: harmonizar o design system, o Céu e o Herman 64; tirar a aba
Aparência; o Céu "no padrão 64" · branch `release/0.7.1`, de main @ dad4d7a (v0.7.0).

Referências: o design system (https://claude.ai/artifact/DAe7kc5iFdEnhrNqroUmYs, card **Harmonia**) e os conceitos do Céu
(https://claude.ai/artifact/MfrCH9cNVBBHqKvqen4pkd). O Érik escolheu a recomendação: **Janela 64** como Céu do dia a
dia, mais a **Constelação-objeto**, as **Noites raras** e o **Morro do Herman** no "Até amanhã".

## Feito

1. **Herman 64 nas tintas do sistema.** `scripts/herman64/palette.mjs`: três tons por material, Bayer só nas costuras,
   sem contorno. Sprites refeitos com `node scripts/herman64/generate.mjs`.
2. **Sem aba Aparência.** Settings perde a seção e a paleta perde o comando; uma aparência salva em versões antigas não
   é mais aplicada (o motor `appearance/` fica, sem tela: valida tokens e presets nos testes).
3. **Céu: Janela 64.** `SkyChart.tsx` desenha a carta como uma imagem de 320 × 180 pixels: tudo cai em pixel inteiro
   (P = 2,5 unidades), grade de pontos a cada 6 pixels, estrelas em cruz, linhas de 1 pixel, campo e poeira em pixels
   soltos, roda do ano pontilhada, sem os arcos e meridianos; lua com o lado escuro pontilhado e a parte acesa sólida
   (token novo `--moon-lit`). Rótulos e legenda em mono.
4. **Constelação-objeto, Noites raras, Morro.** `scripts/sky64/generate.mjs` renderiza `src/renderer/src/sky/sprites/`
   (106 PNGs, ~430 KB, claro e escuro): 45 figuras girando (16 quadros, na dica do nome do mês), 7 noites raras
   (12 quadros, ao lado da legenda do Céu; eclipse e ano-novo tocam uma vez) e o morro (240 × 136, a 2×), onde o
   Herman 64 da roupa escolhida dorme sob a lua da fase real, no "Até amanhã" do Fechar o dia.

5. **README e versão.** O README descreve o visual único, o Céu em pixel e o Herman no morro; package.json em 0.7.1.

## Falta

- A figura também no momento "o mês vira constelação" e nos "Céus anteriores" (hoje só na dica do nome).
- As capturas de tela em `docs/screens/` ainda mostram o visual antigo: refazer numa próxima release.
