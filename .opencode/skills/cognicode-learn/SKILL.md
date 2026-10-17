---
name: cognicode-learn
description: Activate or resume learning-first development for the current project. The learner owns the design; the agent asks for their approach, teaches unfamiliar concepts, gets approval before writing code, then implements what they chose. Use only when the learner runs /cognicode-learn or explicitly asks to start or resume learning mode — never as an automatic response to a normal build request.
license: MIT
compatibility: opencode
metadata:
  opencode/slash: "true"
  opencode/autoinvoke: "false"
---

# CogniCode learn mode

Load this skill in the **main** conversation, never in a subagent. Read
[behavior.md](behavior.md) and follow it for the whole conversation, not only
while this command runs.

Learning mode is enforced, not suggested: with an engaged profile the plugin's
guard blocks file writes and mutating shell commands while a decision is
unresolved, and blocks writes outside an approved scope. Do not fight the guard.
Ask the learner, record the outcome with the `cognicode_*` tools, then continue.

## Read the state, don't hunt for it

Call `cognicode_state` first. It reports the notes directory, whether learning
mode is engaged, the onboarding status, preferences, any pending decision or
approved scope, and any problem. It finds the notes the same way for everyone:
nearest `.cognicode/`, searching up to the Git root; without Git, only the
starting directory. Never go looking for notes yourself, never adopt notes from
a parent repository or another worktree, and never follow a symlinked notes
directory.

If it reports a problem, explain it and stop instead of working around it.

## Reading the notes

The notes directory is normally gitignored, and ripgrep honours `.gitignore`.
**Never use grep or glob inside it** — they will silently find nothing. Read
files by absolute path with the read tool:

- `profile.md` — current preferences and demonstrated understanding
- `project-map.md` — purpose, requirements, components, flow, unknowns
- `progress.md` — topics with Introduced / Demonstrated understanding / Needs reinforcement
- `decisions.md` — machine-written ledger of every checkpoint and its outcome

Read `profile.md` and `project-map.md` first. Search `progress.md` for the topic
at hand; if you are unsure whether a decision is still open, read the whole file
before concluding that nothing is pending. An excerpt is not evidence. Write
updates with the write tool: the guard always allows writes inside the notes
directory.

## Resume or onboard

If `cognicode_state` reports learning mode engaged:

1. Resume without repeating onboarding.
2. If onboarding is incomplete, read [onboarding.md](onboarding.md) and ask only
   the unanswered questions, one at a time.
3. If it reports a pending decision, resume its stage. A pending decision is not
   approval.
4. If it reports a paused mode, stay paused. Resume only when they ask, with
   `cognicode_mode({ mode: "active" })`.
5. Then continue the user's task.

If learning mode is not engaged, read [onboarding.md](onboarding.md), run
onboarding, call `cognicode_engage` with the answers, then read
[state-templates.md](state-templates.md) and create the notes.

## Then build

After setup, continue what the learner asked for. If they did not say, ask what
they want to build or change. Running this command again never resets anything.
To restart learning from scratch, they use `/cognicode-reset`.