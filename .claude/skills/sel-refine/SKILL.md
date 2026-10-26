---
name: sel-refine
description: Run sel's weekly feature refinement - read the whole context (app, backlog, shipped releases, issues, Érik's feedback), propose a few day-sized features attacked by the persona panel, talk them through with Érik in this conversation, and record what he approves in the backlog the daily build reads. Use when the weekly scheduled task fires or Érik says "refine", "/sel-refine" or asks for feature ideas for sel.
---

# sel refine — the weekly conversation

Once a week a scheduled task opens this session. Its output is a **conversation with Érik**:
you bring suggestions, he approves, changes or rejects them **here, in this chat**, and you
write his decisions into the backlog that the daily build (`.claude/skills/sel-team/`) reads.
Nothing gets built from this session.

Tokens cost money: read with intent, keep drafts short, and do the panel once per round.

## 1. Read the context (quietly)

- `backlog.md` on `team/state` (format: `.claude/skills/sel-team/references/backlog-template.md`):
  what is approved, in progress, shipped, rejected and why.
- The last releases and their notes (`gh api repos/erik-sc/sel/releases?per_page=5`), open team
  PRs and Érik's comments on them, open issues.
- `docs/team/charter.md` (identity and principles), `docs/team/roadmap.md`,
  `docs/codebase-knowledge/INDEX.md` and `90-questions.md`, `README.md`, `docs/screens/`.
- The code, wherever a suggestion depends on it. Every suggestion names real files.

## 2. Draft 3 to 5 suggestions

Each one **one day of work** for one developer (split anything bigger), something Érik feels in
daily use (tasks, databases, Today, meetings; fewer clicks; the look), or a fix to something
that shipped rough. Mix: at least one from Érik's own words or comments, at least one new idea.
Never repeat a Rejected entry unless something changed, and say what.

For each, in plain words (Portuguese when talking to Érik, English in the backlog):
- **What changes for you** (one or two sentences).
- **Scope** and **not in scope**; **touches** (files); **done when** (observable, with tests).
- **Sensitive?** (sel-team rule 3) and why.

## 3. Panel (once)

Spawn one fresh `sel-panel` agent (Sonnet) per persona in `docs/team/personas.md`, all at once.
Give each only its persona's section, the drafts' text (in English) and the paths `README.md`
and `docs/screens/`. Then, for each suggestion: change it to answer the objections, or keep it
and say why in one line. A suggestion most of the panel, simulated Érik included, finds
indifferent or against is dropped or replaced, unless it came from Érik's own words: then keep
it and show him the objections. The simulated Érik is a stand-in; the real Érik decides.

## 4. Talk to Érik

Post one message (SendUserMessage) in Portuguese, short:

```
Refino da semana — <data>

1. <título>: <o que muda para você>. Painel: <uma linha>. (<sensível?>)
2. …

No backlog aprovado: <lista curta, em ordem>. Em andamento: <PR, se houver>.

Responda aqui: "aprova 1, 3", "3 antes de 1", "rejeita 2 porque …", ou comente qualquer uma.
```

Then wait for his replies in this conversation. For each:
- **Approved:** add it to **Approved** in `backlog.md`, in the order he gives (default: after
  the existing approved entries), with the full English brief and the date. Confirm in one line.
- **Changes:** revise and show the new version; record it when he approves.
- **Rejected:** add to **Rejected** with his reason.
- **Reordering** of anything already approved: rewrite the order.
Push `team/state` after each change, so the daily build sees it that same night.

If he does not answer in this session, leave the suggestions under **Proposed** in the backlog,
so the next refinement (or any chat with him) can pick them up. Only Érik's words in this
conversation approve a feature.

## Rules

- Never edit `main` or open PRs from this session; only `backlog.md` on `team/state`.
- Sign anything posted on GitHub as `sel-team` rule 4 says (normally nothing is posted).
- Use `gh api` with REST routes (GraphQL is unavailable).
