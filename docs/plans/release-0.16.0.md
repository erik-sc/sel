# Release 0.16.0 — Skills

Status: **proposed** · 2026-11-15 · branch `release/0.16.0` (on top of `release/0.15.1`)

Érik, 2026-11-15: he wants sel to have skills and agents reached over MCP, as Notion has. Asked
what each should be, he said: skills are both sel's own guides and his own; sel, not an
assistant's account, is where his skills are made and kept, versioned, with a skill for making
skills that asks the right questions; an agent runs on the computer at home; and the block has a
screen of its own in the sidebar.

This release is the Skills block. Agents are the next one (below).

## The block

Following "Adicionar um bloco" (docs/codebase-knowledge/50-conventions.md):

- **Data** (`src/shared/skills`): one ordinary database with a fixed id. A row is a skill: its
  title is the name (`fechar-o-mes`; whatever is typed as a title is made into one), a text
  property is the description, the page's own text is the instructions. So a skill is written as
  any page is, **its history keeps every version**, and sync, export, search and "Private from
  AI" apply with nothing added. Made the first time a skill is saved. Out of the sidebar's tree,
  like the Finance page.
- **sel's own skills** (`builtin.ts`, in the code, read-only): `skill-creator` (the questions
  that pin a job down, how a name, a description and instructions are written, show before
  saving, how to improve one), `sel-tasks`, `sel-finances` (with how to bring a statement in),
  `sel-shared-bills`. A test checks every tool they name exists.
- **Tools** (`src/main/skills`, pack `skills`): `list_skills` and `get_skill` (scope read),
  `save_skill` and `delete_skill` (scope write: no new line on the consent screen). `get_skill`
  gives a skill as a `SKILL.md`. Saving over a skill replaces its text in the same page; deleting
  moves it to the trash. The names of sel's own cannot be taken.
- **Screen**: Skills, in the sidebar after Shared bills. The user's skills (open, description,
  copy as SKILL.md, delete), a form for a new one that opens its page to be written, sel's own
  to read, and what to say to Claude.

## Agents: next

What he chose: an agent runs on the computer at home, started over MCP. The plan for it, to be
confirmed before it is built:

- An agent is a page like a skill: a role, the skills it loads, and what it may touch.
- `run_agent` starts sel's own background AI (the one the routines use: Claude Code on that
  computer, with sel's tools and nothing else: no shell, no files) with the agent's instructions
  and the request, and the answer is kept as a page; `agent_runs` reads how it went.
- It can do no more than the connection that started it: the tools it gets are those of the
  scopes that connection was granted. A scope of its own on the consent screen, off by default.
- A daily limit of runs, as the routines have.

## Checked

- Unit tests: names and descriptions, the SKILL.md text, sel's own skills (every tool named
  exists), the tools on a repository (save, save over, read back, trash and restore, private from
  the AI, nothing made by a call that cannot be made), the screen.
- The built app on Linux: a skill made on the screen opens as its page, is listed, and reads
  back as a SKILL.md; the database does not show in the sidebar's tree.
- Not checked: Windows; a real conversation with Claude using the skills over the connector.
