import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import plugin from "../.opencode/plugin/cognicode.ts"

function project() {
  const dir = mkdtempSync(join(tmpdir(), "cognicode-test-"))
  mkdirSync(join(dir, ".git"), { recursive: true })
  mkdirSync(join(dir, "src"), { recursive: true })
  writeFileSync(join(dir, "src/app.ts"), "export const a = 1\n")
  return dir
}

async function harness(dir = project()) {
  const hooks = await plugin({
    client: { app: { log: async () => {} } },
    project: {},
    directory: dir,
    worktree: dir,
    experimental_workspace: { register() {} },
    serverUrl: new URL("http://localhost"),
    $: () => {},
  })
  const ctx = (sessionID = "s1") => ({
    sessionID,
    messageID: "m1",
    agent: "build",
    directory: dir,
    worktree: dir,
    abort: new AbortController().signal,
    metadata() {},
    ask() {},
  })
  const call = async (name, args = {}, sessionID) => {
    const out = await hooks.tool[name].execute(args, ctx(sessionID))
    const text = typeof out === "string" ? out : JSON.stringify(out)
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  const denied = async (tool, args, sessionID) => {
    try {
      await hooks["tool.execute.before"]({ tool, sessionID: sessionID ?? "s1", callID: "c" }, { args })
      return false
    } catch {
      return true
    }
  }
  const engage = (over = {}) =>
    call("cognicode_engage", { situation: "new", experience: "beginner", onboarding: "complete", ...over })
  return { hooks, dir, ctx, call, denied, engage }
}

const approveStep = async (h, files = ["src/links.ts", "src/app.ts"]) => {
  await h.call("cognicode_checkpoint", {
    kind: "confirm-implementation",
    title: "Folder membership",
    proposal: "Add the links table and folder deletion.",
    scope: "Add the links table and folder deletion operation",
    files,
  })
  return h.call("cognicode_resolve", { outcome: "approved", note: "Learner confirmed a links table with note_id and folder_id." })
}

test("finds the notes directory without engagement and stays out of the way", async () => {
  const h = await harness()
  const state = await h.call("cognicode_state")
  assert.equal(state.state_directory, null)
  assert.equal(state.expected_state_directory, join(h.dir, ".cognicode"))
  assert.equal(state.engaged, false)
  assert.equal(await h.denied("write", { filePath: "src/app.ts" }), false)
})

test("engages, creates the ledger, and suggests gitignoring", async () => {
  const h = await harness()
  const state = await h.engage()
  assert.equal(state.engaged, true)
  assert.match(state.gitignore_hint, /\.cognicode/)
  assert.ok(existsSync(join(h.dir, ".cognicode/decisions.md")))
})

test("refuses a symlinked notes directory instead of following it", async () => {
  const h = await harness()
  const { symlinkSync } = await import("node:fs")
  const outside = mkdtempSync(join(tmpdir(), "cognicode-outside-"))
  symlinkSync(outside, join(h.dir, ".cognicode"))
  const state = await h.call("cognicode_state")
  assert.match(state.problem, /symlink/)
  assert.equal(await h.denied("write", { filePath: "src/app.ts" }), false)
})

test("blocks writes and mutating commands until a decision is approved", async () => {
  const h = await harness()
  await h.engage()
  assert.equal(await h.denied("write", { filePath: "src/app.ts" }), true)
  assert.equal(await h.denied("edit", { filePath: "src/app.ts" }), true)
  assert.equal(await h.denied("read", { filePath: "src/app.ts" }), false)
  assert.equal(await h.denied("glob", { pattern: "**/*.ts" }), false)
  assert.equal(await h.denied("task", { description: "explore" }), false)
  assert.equal(await h.denied("question", { questions: [] }), false)
  assert.equal(await h.denied("write", { filePath: ".cognicode/profile.md" }), false)
})

test("keeps read-only shell inspection open and mutating shell closed", async () => {
  const h = await harness()
  await h.engage()
  for (const command of [
    "ls -la",
    "cat src/app.ts",
    "rg -n foo src",
    "sed -n '1,5p' src/app.ts",
    "find . -name '*.ts'",
    "git status",
    "git diff --stat",
    "git log --oneline -5",
    "git branch -a",
    "node --version",
    "python3 --version",
    "ls && git status",
  ]) {
    assert.equal(await h.denied("bash", { command }), false, `expected allowed: ${command}`)
  }
  for (const command of [
    "npm test",
    "bun test",
    "bun run build",
    "bun --version && npm install",
    "rm -rf src",
    "mkdir -p src/new",
    "cat src/app.ts > /tmp/x",
    "sed -i s/a/b/ src/app.ts",
    "find . -delete",
    "find . -exec rm {} ;",
    `node -e 'require("fs").rmSync("src")'`,
    "git commit -m x",
    "git checkout -b x",
    "git push",
    "git branch -D main",
    "gh pr create -t x",
    "curl https://example.test -d a=b",
    "echo hi | tee out.txt",
    "cat x | xargs rm",
  ]) {
    assert.equal(await h.denied("bash", { command }), true, `expected denied: ${command}`)
  }
})

test("renders build checkpoints verbatim with no approval options", async () => {
  const h = await harness()
  await h.engage()
  const block = await h.call("cognicode_checkpoint", {
    kind: "reasoning",
    title: "Folder membership",
    question: "How would you represent which folders a note belongs to?",
  })
  assert.match(block, /^---\n\n\*\*✦ Build checkpoint: Folder membership\*\*/)
  assert.doesNotMatch(block, /Confirm and continue|Implement this step/)
  assert.equal(await h.denied("write", { filePath: "src/app.ts" }), true)
  assert.equal(await h.denied("bash", { command: "npm test" }), true)
})

test("shows scope and files on an implementation checkpoint", async () => {
  const h = await harness()
  await h.engage()
  const block = await h.call("cognicode_checkpoint", {
    kind: "confirm-implementation",
    title: "Folder membership",
    proposal: "Add the links table and folder deletion.",
    scope: "Add the links table and folder deletion operation",
    files: ["src/links.ts", "src/app.ts"],
  })
  assert.match(block, /Scope: Add the links table and folder deletion operation/)
  assert.match(block, /Files: src\/links\.ts, src\/app\.ts/)
  assert.match(block, /❯ 1\. Implement this step/)
  assert.match(block, /2\. Discuss/)
})

test("requires scope and files before an implementation checkpoint can be opened", async () => {
  const h = await harness()
  await h.engage()
  assert.match(
    String(await h.call("cognicode_checkpoint", { kind: "confirm-implementation", title: "x", proposal: "y" })),
    /needs scope/,
  )
  assert.match(
    String(await h.call("cognicode_checkpoint", { kind: "confirm-implementation", title: "x", proposal: "y", scope: "z" })),
    /needs files/,
  )
  assert.match(
    String(
      await h.call("cognicode_checkpoint", {
        kind: "confirm-implementation",
        title: "x",
        proposal: "y",
        scope: "z",
        files: ["../escape.ts"],
      }),
    ),
    /inside the project root/,
  )
})

test("refuses to widen an approved scope", async () => {
  const h = await harness()
  await h.engage()
  await h.call("cognicode_checkpoint", {
    kind: "confirm-implementation",
    title: "Folder membership",
    proposal: "Add the links table.",
    scope: "Add the links table",
    files: ["src/links.ts"],
  })
  const widened = await h.call("cognicode_resolve", {
    outcome: "approved",
    note: "ok",
    files: ["src/links.ts", "src/extra.ts"],
  })
  assert.match(widened.error, /wider scope/)
  const empty = await h.call("cognicode_resolve", { outcome: "approved", note: "  " })
  assert.match(empty.error, /Record what the learner decided/)
})

test("grants writes to the approved files only", async () => {
  const h = await harness()
  await h.engage()
  const approved = await approveStep(h)
  assert.deepEqual(approved.approval.files, ["src/links.ts", "src/app.ts"])
  assert.equal(await h.denied("write", { filePath: "src/links.ts" }), false)
  assert.equal(await h.denied("edit", { filePath: "src/app.ts" }), false)
  assert.equal(await h.denied("write", { filePath: "src/sneaky.ts" }), true)
  assert.equal(await h.denied("write", { filePath: "src/nested/deep.ts" }), true)
  assert.equal(await h.denied("write", { filePath: "../../etc/passwd" }), true)
  assert.equal(await h.denied("edit", { filePath: "/etc/hosts" }), true)
  assert.equal(await h.denied("bash", { command: "bun test && npm run lint" }), false)
  const ledger = readFileSync(join(h.dir, ".cognicode/decisions.md"), "utf8")
  assert.match(ledger, /\| .* \| Implementation checkpoint \| Folder membership \| approved \|/)
  assert.match(ledger, /links table with note_id/)
})

test("a design checkpoint confirms a design without permitting code", async () => {
  const h = await harness()
  await h.engage()
  const block = await h.call("cognicode_checkpoint", { kind: "confirm-design", title: "Access rules", proposal: "Notes are private." })
  assert.match(block, /❯ 1\. Confirm and continue/)
  assert.doesNotMatch(block, /Implement this step/)
  const approved = await h.call("cognicode_resolve", { outcome: "approved", note: "Owner is a user_id on notes." })
  assert.equal(approved.approval, null)
  assert.equal(await h.denied("write", { filePath: "src/app.ts" }), true)
})

test("a new checkpoint clears the previous approval", async () => {
  const h = await harness()
  await h.engage()
  await approveStep(h)
  await h.call("cognicode_checkpoint", { kind: "confirm-design", title: "Access rules", proposal: "Notes are private." })
  assert.equal(await h.denied("write", { filePath: "src/app.ts" }), true)
})

test("discussing keeps the decision open and cannot be approved directly", async () => {
  const h = await harness()
  await h.engage()
  await h.call("cognicode_checkpoint", { kind: "confirm-design", title: "Access rules", proposal: "Owner is a user_id." })
  const discussed = await h.call("cognicode_resolve", { outcome: "discussing", note: "Where is ownership stored?" })
  assert.match(discussed.guard, /still open/)
  const approved = await h.call("cognicode_resolve", { outcome: "approved", note: "x" })
  assert.match(approved.error, /cannot be approved directly/)
  assert.equal(await h.denied("write", { filePath: "src/app.ts" }), true)
})

test("chains the next checkpoint in one call and keeps blocking until it is approved", async () => {
  const h = await harness()
  await h.engage()
  await h.call("cognicode_checkpoint", { kind: "confirm-design", title: "Access rules", proposal: "Owner is a user_id." })
  const chained = await h.call("cognicode_resolve", {
    outcome: "discussing",
    note: "Learner agreed: notes carry user_id.",
    next: {
      kind: "confirm-implementation",
      title: "Ownership column",
      proposal: "Add user_id and index it.",
      scope: "Add user_id to notes",
      files: ["src/app.ts"],
    },
  })
  assert.match(chained.block, /✦ Implementation checkpoint: Ownership column/)
  assert.equal(await h.denied("edit", { filePath: "src/app.ts" }), true)
  const approved = await h.call("cognicode_resolve", { outcome: "approved", note: "Learner approved the column." })
  assert.deepEqual(approved.approval.files, ["src/app.ts"])
  assert.equal(await h.denied("edit", { filePath: "src/app.ts" }), false)
  assert.equal(await h.denied("write", { filePath: "src/links.ts" }), true)
})

test("records reasoning from a build checkpoint", async () => {
  const h = await harness()
  await h.engage()
  await h.call("cognicode_checkpoint", { kind: "reasoning", title: "Folder membership", question: "How would you model it?" })
  const answered = await h.call("cognicode_resolve", { outcome: "answered", note: "A links table with note_id and folder_id." })
  assert.equal(answered.approval, null)
  assert.match(answered.guard, /no write access/)
  const wrong = await h.call("cognicode_resolve", { outcome: "answered", note: "x" })
  assert.match(wrong.error, /no open CogniCode decision/)
})

test("bypass lifts the guard for that session only", async () => {
  const h = await harness()
  await h.engage()
  await h.call("cognicode_bypass", { reason: "just build it, no checkpoints" })
  assert.equal(await h.denied("write", { filePath: "src/anything.ts" }, "s1"), false)
  assert.equal(await h.denied("bash", { command: "rm -rf /tmp/whatever" }, "s1"), false)
  assert.equal(await h.denied("write", { filePath: "src/app.ts" }, "s2"), true)
  await h.call("cognicode_bypass", { clear: true })
  assert.equal(await h.denied("write", { filePath: "src/other.ts" }, "s1"), true)
})

test("bypass reaches subagents started by that session", async () => {
  const h = await harness()
  await h.engage()
  await h.hooks.event({ event: { type: "session.created", properties: { info: { id: "sub-1", parentID: "s1" } } } })
  await h.hooks.event({ event: { type: "session.created", properties: { info: { id: "sub-2", parentID: "sub-1" } } } })
  assert.equal(await h.denied("write", { filePath: "src/other.ts" }, "sub-1"), true)

  await h.call("cognicode_bypass", { reason: "just build it, no checkpoints" })
  assert.equal(await h.denied("write", { filePath: "src/other.ts" }, "s1"), false)
  assert.equal(await h.denied("write", { filePath: "src/other.ts" }, "sub-1"), false)
  assert.equal(await h.denied("write", { filePath: "src/other.ts" }, "sub-2"), false)
  assert.equal(await h.denied("write", { filePath: "src/other.ts" }, "s2"), true)
})

test("pausing stops enforcement and checkpoints until resumed", async () => {
  const h = await harness()
  await h.engage()
  await approveStep(h)
  await h.call("cognicode_mode", { mode: "paused", reason: "focus day" })
  assert.equal((await h.call("cognicode_state")).mode, "paused")
  assert.equal(await h.denied("write", { filePath: "src/other.ts" }), false)
  assert.match(String(await h.call("cognicode_checkpoint", { kind: "reasoning", title: "x", question: "y" })), /paused/)
  await h.call("cognicode_mode", { mode: "active" })
  assert.equal(await h.denied("write", { filePath: "src/other.ts" }), true)
})

test("pausing drops the approval so resuming cannot write silently", async () => {
  const h = await harness()
  await h.engage()
  await approveStep(h)
  await h.call("cognicode_mode", { mode: "paused" })
  await h.call("cognicode_mode", { mode: "active" })
  assert.equal(await h.denied("write", { filePath: "src/app.ts" }), true)
})

test("announces active and paused learning mode in the system prompt", async () => {
  const h = await harness()
  await h.engage()
  const active = []
  await h.hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, { system: active })
  assert.match(active.join("\n"), /CogniCode learning mode: ACTIVE/)
  assert.match(active.join("\n"), /\.cognicode\/profile\.md/)
  await h.call("cognicode_mode", { mode: "paused" })
  const paused = []
  await h.hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, { system: paused })
  assert.match(paused.join("\n"), /CogniCode learning mode: PAUSED/)
})

test("says nothing in a project that never engaged", async () => {
  const h = await harness()
  const system = []
  await h.hooks["experimental.chat.system.transform"]({ sessionID: "s1" }, { system })
  assert.deepEqual(system, [])
})

test("carries the unresolved decision through compaction", async () => {
  const h = await harness()
  await h.engage()
  await h.call("cognicode_checkpoint", {
    kind: "confirm-implementation",
    title: "Pending step",
    proposal: "Do the thing.",
    scope: "Do the thing",
    files: ["src/app.ts"],
  })
  const context = []
  await h.hooks["experimental.session.compacting"]({ sessionID: "s1" }, { context })
  assert.match(context.join("\n"), /Unresolved decision: "Pending step" at stage confirm-implementation/)
  assert.match(context.join("\n"), /decisions\.md/)
})

test("previews before resetting and rejects a stale confirmation", async () => {
  const h = await harness()
  assert.equal((await h.call("cognicode_reset")).status, "no_notes")
  await h.engage()
  writeFileSync(join(h.dir, ".cognicode/profile.md"), "# Learner Profile\n\nLearning mode: active\nOnboarding: complete\n")
  writeFileSync(join(h.dir, ".cognicode/progress.md"), "# Learning Progress\n")
  writeFileSync(join(h.dir, ".cognicode/project-map.md"), "# Project Map\n")
  const preview = await h.call("cognicode_reset")
  assert.equal(preview.status, "preview")
  assert.deepEqual(preview.files, ["profile.md", "progress.md", "project-map.md", "state.json"])

  const stale = await h.call("cognicode_reset", { confirm: "nope" })
  assert.equal(stale.status, "error")

  const done = await h.call("cognicode_reset", { confirm: preview.confirmation })
  assert.equal(done.status, "reset")
  assert.ok(existsSync(join(done.backup, "profile.md")))
  assert.ok(existsSync(join(done.backup, "state.json")))
  assert.match(readFileSync(join(h.dir, ".cognicode/profile.md"), "utf8"), /Onboarding reset: pending/)
  const after = await h.call("cognicode_state")
  assert.equal(after.approval, null)
  assert.equal(after.pending_decision, null)
})

test("reset fails loudly when the notes change mid-preview", async () => {
  const h = await harness()
  await h.engage()
  writeFileSync(join(h.dir, ".cognicode/profile.md"), "# Learner Profile\n\nLearning mode: active\nOnboarding: complete\n")
  const preview = await h.call("cognicode_reset")
  writeFileSync(join(h.dir, ".cognicode/profile.md"), "# Learner Profile\n\nLearning mode: active\nOnboarding: complete\n\nEdited\n")
  const result = await h.call("cognicode_reset", { confirm: preview.confirmation })
  assert.equal(result.status, "error")
  assert.match(result.message, /changed since the preview/)
})

test("reports a corrupt state file instead of guessing", async () => {
  const h = await harness()
  await h.engage()
  writeFileSync(join(h.dir, ".cognicode/state.json"), "{not json")
  const state = await h.call("cognicode_state")
  assert.match(state.problem, /not readable JSON/)
  assert.equal(await h.denied("write", { filePath: "src/app.ts" }), false)
})

test("finds notes from a subdirectory without crossing the git boundary", async () => {
  const h = await harness()
  mkdirSync(join(h.dir, "src/deep"), { recursive: true })
  await h.engage()
  const inside = await plugin({
    client: { app: { log: async () => {} } },
    project: {},
    directory: join(h.dir, "src/deep"),
    worktree: join(h.dir, "src/deep"),
    experimental_workspace: { register() {} },
    serverUrl: new URL("http://localhost"),
    $: () => {},
  })
  const state = await inside.tool.cognicode_state.execute(
    {},
    {
      sessionID: "s9",
      messageID: "m",
      agent: "build",
      directory: join(h.dir, "src/deep"),
      worktree: join(h.dir, "src/deep"),
      abort: new AbortController().signal,
      metadata() {},
      ask() {},
    },
  )
  assert.match(state, new RegExp(`"state_directory": "${join(h.dir, ".cognicode")}"`))
})

test("without git it never adopts a parent folder's notes", async () => {
  const parent = project()
  mkdirSync(join(parent, ".cognicode"), { recursive: true })
  writeFileSync(join(parent, ".cognicode/state.json"), JSON.stringify({ version: 1, engaged: true, mode: "active" }))
  const child = mkdtempSync(join(tmpdir(), "cognicode-child-"))
  mkdirSync(join(child, "nested"), { recursive: true })
  const hooks = await plugin({
    client: { app: { log: async () => {} } },
    project: {},
    directory: join(child, "nested"),
    worktree: join(child, "nested"),
    experimental_workspace: { register() {} },
    serverUrl: new URL("http://localhost"),
    $: () => {},
  })
  const state = await hooks.tool.cognicode_state.execute(
    {},
    {
      sessionID: "s9",
      messageID: "m",
      agent: "build",
      directory: join(child, "nested"),
      worktree: join(child, "nested"),
      abort: new AbortController().signal,
      metadata() {},
      ask() {},
    },
  )
  assert.match(state, /"state_directory": null/)
})