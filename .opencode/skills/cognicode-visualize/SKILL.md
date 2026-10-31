---
name: cognicode-visualize
description: Generate learning-first visual diagrams for the project. Creates detailed sequence diagrams following engineering review style to help understand and remember flows. Use when the learner wants to visualize how the codebase works or trace a specific flow.
license: MIT
compatibility: opencode
metadata:
  opencode/slash: "true"
  opencode/autoinvoke: "false"
---

# CogniCode Visualize

Load this skill to generate visual diagrams that help you understand and remember the codebase.

## Read state first
Call `cognicode_state` to understand the learning context. Read `profile.md`, `project-map.md`, and `decisions.md` from the notes directory.

## Workflow
1. **Pick a flow to trace** - Use `cognicode_checkpoint` with kind `reasoning`, title "Trace a flow", asking which flow to visualize. Suggest candidates from approved implementation checkpoints in decisions.md.
2. **Gather details** - If needed, ask targeted questions in chat to make the diagram accurate. Mark assumptions.
3. **Generate** - Call `cognicode_visualize` with mode `sequence`, focus on the flow, and any description gathered.
4. **Learn by explaining** - After generating, walk through steps with the learner. Ask them to explain key interactions - record their explanations to `progress.md` under "Demonstrated understanding".

## Modes
- `sequence`: Detailed dark-themed sequence diagram following engineering review style (default for learning)
- `timeline`: Visual timeline of learning journey from decisions.md
- `flow`: Feature map from project-map and approved scopes
- `atlas`: Module/import graph

All outputs go to `.cognicode/visuals/`. Writes to this directory are always allowed.

**Outputs:** editable `*.source.json`, dark SVG, self-contained HTML viewer, Mermaid `*.mmd` sequence diagram, Mermaid `*.mmd` flowchart. The `.mmd` files render in any Markdown viewer that supports Mermaid (GitHub, GitLab, VS Code, etc.).
