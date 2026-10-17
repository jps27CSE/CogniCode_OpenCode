# CogniCode for opencode

**You build. AI writes.** A learning-first development plugin for
[opencode](https://opencode.ai). The model asks for your approach before it
writes anything, teaches you what you don't know, and waits for your approval on
an exact scope of code changes — then it implements what you chose and explains
what it did.

The approval loop is **enforced by the plugin**, not merely requested in a
prompt: while a decision is unresolved, opencode itself refuses the write.

---

## Table of contents

- [The problem it solves](#the-problem-it-solves)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Day-to-day use](#day-to-day-use)
- [Checkpoints reference](#checkpoints-reference)
- [The guard reference](#the-guard-reference)
- [Controlling the loop](#controlling-the-loop)
- [Commands and tools](#commands-and-tools)
- [Notes and state](#notes-and-state)
- [Reset](#reset)
- [Troubleshooting](#troubleshooting)
- [Design notes](#design-notes)
- [Development](#development)
- [License](#license)

---

## The problem it solves

Every coding agent — including the one you're talking to — will turn
"add search to my notes app" into 200 lines across four files, declare it done,
and leave you unable to answer *"why did you choose that, and what happens when
the query is empty?"*

The code may be fine. The problem is that **the design decisions happen invisibly
inside one turn**, and they're baked in before you ever see them. CogniCode
pulls those decisions out of the model and into a conversation you own — then
mechanically enforces the result.

### Without CogniCode

```
You:  add search to my notes app

AI:   I'll add full-text search using Postgres.
      - Migration: tsvector column + GIN index on title/body
      - GET /api/notes/search?q=  (separate endpoint, paginated)
      - Case-insensitive via unaccent, prefix matching via plainto_tsquery
      - 3 new tests

      [writes 4 files, 240 lines, runs tests]

      Done. Search is case-insensitive and paginated.
```

Ten seconds later, in the diff, you have four new questions: why a separate
endpoint instead of `?q=` on `/api/notes`? why does it match bodies when you asked
for titles? what does an empty `q` return? can it search folder names? (It can't —
the index covers title and body only.)

You can't answer any of them, so you either accept a design you never made or
spend an hour unwinding it. The code works. You learned nothing, and you own
nothing.

### With CogniCode

```
You:  add search to my notes app

AI:   Search raises real choices — which fields, and what an empty query means.
      Let me get your approach first.

      ✦ Build checkpoint: What should search match?

      Should a query match note titles only, or note bodies as well?
      And what should an empty query do — return nothing, or all notes?
```

```
You:  titles and bodies, empty means no results
```

```
AI:   Good — that separates "no match" from "no query", so an empty query can be
      a 400 instead of a full table scan.

      ✦ Implementation checkpoint: Search

      Scope: add a search endpoint that matches note titles and bodies,
             case-insensitively, returning nothing for an empty query
      Files: db/migrations/005_search.sql, src/search.py, tests/test_search.py

      ❯ 1. Implement this step
           This approach makes sense to me; write the code for this step.
        2. Discuss
           Ask questions or clarify anything that doesn't make sense before deciding.
```

```
You:  1
```

```
AI:   [writes exactly those three files, runs the tests]

      ✦ Implementation report: Search

      - The migration adds a generated tsvector column and a GIN index. Postgres
        does the matching, so rows aren't scanned in Python.
      - Case-insensitivity comes from `unaccent` and a lowercased configuration,
        not from lowercasing in Python — one place, consistent with your decision
        to match both fields.
      - An empty query returns 400 before touching the database.
      - 4 new tests, all passing: title match, body match, mixed case, empty query.
```

The index now shows up as a **consequence of your decision**, not a surprise.
And the model can't quietly add a folder-name column later, because that column
isn't in the scope you approved.

### What you accumulate

`.cognicode/decisions.md` — every checkpoint, machine-written, permanently:

```
| When (UTC)                | Checkpoint               | Decision            | Outcome  | Scope                  | Evidence                                          |
| 2026-10-17T08:04:11.201Z | Build checkpoint          | What search matches | answered | —                      | titles and bodies, empty means no results         |
| 2026-10-17T08:06:02.887Z | Implementation checkpoint | Search              | approved | add search endpoint... | Learner approved titles + bodies, 400 on empty    |
```

Six months later, when someone asks "why is search an endpoint and not a query
param?", the answer is on disk — with your reasoning attached, not just the code.

---

## How it works

Three moving parts:

1. **A skill** (`/cognicode-learn`) loads a behavior guide that governs the whole
   conversation: ask for your approach, teach, never substitute your judgment.
2. **A guard** in the plugin's `tool.execute.before` hook refuses writes and
   mutating shell commands while a decision is unresolved, and refuses writes
   outside an approved scope.
3. **A set of tools** that own the state: what decision is open, what was
   approved, what mode you're in, and a ledger of everything that happened.

Nothing leaves your machine. No account, no backend, no telemetry. Notes are
Markdown files in your project.

---

## Requirements

- **opencode 1.18.x or newer.** Built and tested against 1.18.24.
- Nothing else at runtime. No Python, no plugin marketplace, no build step.
- **Node 22.6+** only if you want to run the test suite.

---

## Install

### Into one project

```sh
git clone <this-repo> cognicode_opencode
cd cognicode_opencode
scripts/install.sh /path/to/your/project
```

### Into every project (global)

```sh
scripts/install.sh --global        # installs into ~/.config/opencode
```

The script copies one plugin file and two skills. It never overwrites anything
unless you pass `--force`. Run it with no arguments to install into the current
directory.

### Manually

Copy these into the target project (or into `~/.config/opencode/` for global):

```
.opencode/plugin/cognicode.ts
.opencode/skills/cognicode-learn/     # SKILL.md, behavior.md, onboarding.md, state-templates.md
.opencode/skills/cognicode-reset/SKILL.md
```

Then **restart opencode** — plugins, skills, and commands are read once at
startup, so a running session keeps using the old config.

> On first launch opencode notices the plugin imports `@opencode-ai/plugin` and
> generates `.opencode/package.json` itself, pinning the SDK to your opencode
> version and installing it into `.opencode/node_modules/`. That needs network
> access once. Both paths are gitignored.

Verify the install at any time:

```sh
opencode debug skill          # both skills should be listed
opencode debug agent build    # should show the seven cognicode_* tools
```

---

## Quick start

1. Start opencode in the project you want to work on.
2. Run `/cognicode-learn`.
3. Answer the setup questions — one at a time, with a picker. **Use defaults**
   skips the preference questions. For an existing repository the model inspects
   the code and drafts a project map first; a new project starts empty.
4. Ask for what you want to build.

Setup writes `.cognicode/` in the project root (or the Git root, and CogniCode
finds it from any subfolder). Add it to that project's `.gitignore` — CogniCode
tells you to, but never edits `.gitignore` without saying so.

---

## Day-to-day use

**At the start of each session**, run `/cognicode-learn`. It resumes from your
notes in seconds — no questions if onboarding is already complete — and loads the
behavior guide. If the session has been compacted or seems to have lost track,
run it again.

**Then just ask for work** in plain English. There are no commands to learn.

The model will:

- restate what it understands you want, and ask for your approach
- open a **Build checkpoint** when a meaningful decision needs your reasoning
- explain unfamiliar concepts in the moment (`✦ Concept`, `✦ Why this matters`)
- open a **Design checkpoint** when the shape of the system is settled enough to
  review
- open an **Implementation checkpoint** listing the exact scope and every file it
  will touch, then write only after you approve
- report what changed, how the key code works, and which checks ran
- keep `profile.md`, `progress.md`, and `project-map.md` current as you go

Ask "explain that again", "show me a diagram", or "why that?" at any point.
Explaining is never gated behind another approval.

---

## Checkpoints reference

| Checkpoint | Asks you | You reply |
| --- | --- | --- |
| **✦ Build checkpoint** | How would you approach this problem? | reasoning, in chat |
| **✦ Design checkpoint** | Is this the right design? | **Confirm and continue** / **Discuss** |
| **✦ Implementation checkpoint** | Is this the right code, in this scope? | **Implement this step** / **Discuss** |

- Not three mandatory stops. Several Build checkpoints can lead to one
  confirmation, and an Implementation checkpoint also confirms the design, so a
  separate Design checkpoint is often unnecessary.
- **Confirm and continue** records the design and keeps planning. It does not
  authorize code.
- **Implement this step** authorizes exactly the scope and file list shown.
- **Discuss** on either confirmation suspends the decision and invites questions.
  Nothing is recorded as decided, and writes stay blocked until you approve.
- Describing what you want sets requirements. A feature preference is not an
  architecture approval.

When the model wants to add implementation details of its own, it lists them
separately from your decisions in a short **Proposed additions** table
(*Detail / Proposal / Why it matters*) so you can question or change each one.

Checkpoints are rendered by the plugin, not written by the model, so their
wording is consistent:

```
---

**✦ Implementation checkpoint: Folder membership**

Scope: add the links table and the folder-deletion operation
Files: db/migrations/004_links.sql, src/notes.ts, tests/folder_delete.test.ts

❯ 1. Implement this step
     This approach makes sense to me; write the code for this step.
  2. Discuss
     Ask questions or clarify anything that doesn't make sense before deciding.
```

---

## The guard reference

While a decision is unresolved:

| Allowed | Blocked |
| --- | --- |
| `read`, `glob`, `grep`, `list` | `write`, `edit`, `patch`, `multiedit`, `notebookedit` |
| `question`, `task`, `skill`, `todowrite` | mutating shell commands |
| writes inside `.cognicode/` (your notes) | redirects, `sed -i`, `find -delete`, `xargs rm` |
| read-only shell: `ls`, `cat`, `rg`, `sed -n`, `git status/log/diff/show/branch -a`, `node --version` | `npm`/`bun test`, `rm`, `mkdir`, `curl`, `git commit/push/checkout`, `gh pr create`, `node -e` |

After you approve an implementation checkpoint:

| Allowed | Blocked |
| --- | --- |
| writes to the listed files and directories | writes to anything else — reported as scope creep |
| any shell command, including builds, tests, formatters | — |

The model sees errors like these, and is expected to ask you rather than work
around them:

```
CogniCode guard: unresolved implementation checkpoint "Folder membership".
Ask the learner, record the outcome with cognicode_resolve, then retry.
File writes and mutating shell commands stay blocked; do not work around the guard.
```

```
CogniCode guard: this step is approved only for db/migrations/005_search.sql,
src/search.py, tests/test_search.py. src/db/helpers.py is outside that scope.
Treat it as scope creep: ask the learner, open a new implementation checkpoint
that names those files, then write them.
```

Two escape hatches, both requiring you to say so explicitly:

- **Bypass** — "just implement this one" lifts the guard for the current session
  and any subagent it starts, and only for that conversation. It's recorded with
  your words and lives in memory, so it dies with opencode.
- **Pause** — "pause learning" stops enforcement and context injection while
  keeping every note, preference, and open decision intact.

The guard is an *additional* layer. opencode's own `permission` rules still apply
on top of it, and CogniCode never widens them.

---

## Controlling the loop

Everything below is plain chat — no commands, no config editing.

| Say | Effect |
| --- | --- |
| "Use fewer checkpoints." | frequency → Light |
| "Check in more often." | frequency → Frequent |
| "Focus on backend architecture." | narrows where checkpoints are raised |
| "Use multiple-choice questions." | reasoning style changes |
| "Just implement this one." | bypass checkpoints for this session |
| "Pause learning." | stops enforcement; `/cognicode-learn` resumes it |
| "I'm an advanced backend dev." | teaching depth drops to assumptions and failure modes |

Teaching depth follows what you demonstrate, not what you claim at setup:
beginners get grounding and diagrams, intermediates get interactions and
tradeoffs, advanced learners get constraint probes and design-assumption
challenges.

---

## Commands and tools

**Slash commands** (in the TUI):

| Command | Does |
| --- | --- |
| `/cognicode-learn` | activates or resumes learning mode for this project |
| `/cognicode-reset` | previews, backs up, and restarts onboarding |

Neither can be triggered by the model on its own — they're slash-invoked or
explicitly requested only, so a normal "build me X" request never accidentally
turns into a lesson.

**Tools** the model uses (visible in the TUI with `CogniCode:` titles):

| Tool | Purpose |
| --- | --- |
| `cognicode_state` | reports notes directory, engagement, mode, preferences, open decision, approved scope, and any problem |
| `cognicode_engage` | records onboarding answers and preferences; creates `.cognicode/` |
| `cognicode_mode` | pauses or resumes learning mode |
| `cognicode_checkpoint` | records an open decision and returns the exact block to show you |
| `cognicode_resolve` | records the outcome; grants scoped write access on implementation approval; can open the next checkpoint in one call |
| `cognicode_bypass` | records that you asked to skip checkpoints, or clears it |
| `cognicode_reset` | previews and performs a notes reset behind a confirmation token |

---

## Notes and state

Everything lives in `.cognicode/` inside your project:

| File | Written by | Contents |
| --- | --- | --- |
| `profile.md` | model | your preferences and demonstrated understanding |
| `project-map.md` | model | purpose, requirements, components, flow, unknowns |
| `progress.md` | model | topics: introduced / demonstrated / needs reinforcement |
| `decisions.md` | plugin | ledger of every checkpoint and its outcome |
| `state.json` | plugin | engagement, mode, preferences, open decision, approved scope |
| `backups/` | plugin | snapshots taken by `/cognicode-reset` |

The model writes the first three with the ordinary write tool and reads them back
with the read tool. It never greps or globs inside `.cognicode/`, because the
directory is usually gitignored and ripgrep honours `.gitignore`.

**Where it looks:** nearest `.cognicode/`, searching upward only as far as the
Git root. Without Git it checks only the directory you started in — it will
never adopt notes from an unrelated parent folder, another worktree, or a
symlinked directory.

---

## Reset

```sh
/cognicode-reset
```

1. Previews: which project, which notes, where the backup would go.
2. Asks **Cancel / Reset learning** with a picker. Nothing happens without an
   explicit answer.
3. On confirmation, copies the notes to `.cognicode/backups/<timestamp>/` and
   writes a fresh, incomplete profile.

The confirmation token covers the notes directory identity *and* the contents of
every note, so if anything changed between preview and confirmation the reset
fails and nothing is touched.

Your source code, dependencies, Git history, and other projects are never
affected. After a reset you land back in onboarding with a blank slate; old
backups are historical data, not active context.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `/cognicode-learn` isn't in the TUI | opencode wasn't restarted, or the skills aren't in `.opencode/skills/`. Check `opencode debug skill`. |
| The model writes code with no checkpoint | learning mode isn't engaged in that project — run `/cognicode-learn` there. |
| Questions come as plain text instead of a picker | your config denies `permission.question`. The flow still works, just less cleanly. |
| `Model not found` on startup | your global config names a model that no longer exists — check `~/.config/opencode/opencode.jsonc`. |
| Guard blocks something legitimate | it means a checkpoint is unresolved. Answer, approve, or say "just implement this one". |
| Old session ignores everything | CogniCode is installed but that project was started before the install, or bypass is active in that session. |
| `state.json is not readable JSON` | the guard refuses to guess. Repair or delete the file; nothing else is touched. |
| Notes aren't found from a subfolder | without a Git repository, only the starting directory is searched. Start opencode at the project root. |

---

## Design notes

### How it's built on opencode

CogniCode uses only what opencode already ships, which is why there's no
marketplace, no hook JSON, and no build step:

| Concern | opencode primitive |
| --- | --- |
| Installing | `.opencode/plugin/cognicode.ts`, auto-discovered at startup |
| `/cognicode-learn` | a skill with `metadata["opencode/slash"]: "true"` |
| Never firing on its own | `metadata["opencode/autoinvoke"]: "false"` |
| Restoring notes every session | `experimental.chat.system.transform` |
| Surviving compaction | `experimental.session.compacting` |
| Pickers for confirmations | the built-in `question` tool |
| Owning the state | seven custom tools registered by the plugin |
| Enforcing approval | `tool.execute.before`, which can refuse a call |

### Design decisions worth knowing

- **Approval is recorded, not remembered.** The model cannot declare a decision
  resolved by saying so; only `cognicode_resolve` changes state, and only an
  implementation approval grants writes.
- **Scope is explicit.** An implementation checkpoint names every file it may
  touch. The guard compares paths, so the model cannot widen its own scope.
- **The notes directory is off-limits to search tools.** It is normally
  gitignored, and ripgrep honours `.gitignore`, so notes are read by absolute
  path with the read tool rather than grep.
- **Machine state is a file, not a conversation.** Engagement, mode, preferences,
  the open decision, and the approved scope live in `state.json`, which is what
  makes the loop survive restarts and compaction.
- **Notes are treated as data.** The model reads learner notes as content, never
  as instructions.

### Layout

```
index.html                               project homepage (GitHub Pages)
.opencode/plugin/cognicode.ts            engine: tools, guard, context injection
.opencode/skills/cognicode-learn/        learning mode + 3 referenced guides
.opencode/skills/cognicode-reset/        back up notes and restart onboarding
scripts/install.sh                       install into a project or globally
tests/cognicode.test.mjs                 guard and tool tests, no model calls
```

---

## Development

The plugin is plain TypeScript with no build step; opencode loads it directly.
Tests drive the real hooks and tools against throwaway projects.

```sh
npm install
npm test
```

Coverage includes scope enforcement and path escapes, shell classification,
session-scoped bypass, pause/resume, legacy-notes adoption, symlink refusal,
Git-boundary lookup, reset tokens, and the context injected into the system
prompt and compaction.

---

## License

MIT.

MIT is permissive: you can use, modify, and redistribute this, including
commercially. Keep the license notice with any copy or substantial portion you
distribute, and note that the software comes without warranty of any kind.
