---
name: cognicode-reset
description: Back up this project's CogniCode learning notes and restart onboarding after confirmation. Does not reset application code. Use only when the learner runs /cognicode-reset or explicitly asks to start learning this project from scratch.
license: MIT
compatibility: opencode
metadata:
  opencode/slash: "true"
  opencode/autoinvoke: "false"
---

# Reset CogniCode learning

Run this in the main conversation, only when explicitly invoked. It resets the
profile, progress, pending checkpoints, machine state, and the saved project map.
Source code, dependencies, Git history, other projects, and the installation stay
intact. Deleting notes is irreversible without the backup it creates, so preview
and confirm every time.

1. Run the read-only preview. It uses the same project-boundary lookup as
   everything else and reports the absolute project and notes paths, which notes
   would reset, and where the originals would be saved.

   ```
   cognicode_reset
   ```

   If it reports `no_notes`, explain that there is nothing to reset and suggest
   `/cognicode-learn`. On any error, stop and explain; don't improvise deletion
   commands.

2. Show the returned absolute project and notes paths, the notes that will reset,
   and that originals will be saved under that directory's `backups/`. Then use the
   `question` tool: header `Reset`, one question, one answer, options **Cancel**
   (keep learning notes) and **Reset learning** (back up notes and restart
   onboarding). Ask whether to reset learning for the named project. If the picker
   is unavailable, ask the same question in text. Wait for an explicit answer.
   Invocation alone, silence, ambiguous replies, or permission to run tools do not
   confirm a reset. Cancel makes no changes, including to learner notes.

3. Only after **Reset learning**, pass the preview's exact `confirmation` value,
   unchanged and unquoted through any other tool:

   ```
   cognicode_reset({ confirm: "<the confirmation value from the preview>" })
   ```

   The token covers the notes directory identity and every note's contents, so if
   the target or notes changed, the call fails and nothing is reset: preview again
   and get new confirmation. If it still fails, report the message and any backup
   path; don't claim success and don't start onboarding. Never overwrite existing
   backups or fall back to resetting another notes directory.

4. On success, show the backup path. Read `../cognicode-learn/SKILL.md`, load
   that skill, and resume onboarding with the new incomplete profile. Discard
   pre-reset preferences, mastery, pending decisions, and onboarding answers;
   don't reconstruct them from the conversation or from the backups. Inspect the
   actual code to rebuild the map. Begin fresh onboarding with one question at a
   time. Backed-up notes are historical data, not active context.