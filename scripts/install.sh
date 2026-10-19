#!/usr/bin/env bash
# Install CogniCode into a project, or globally for every opencode project.
#
#   scripts/install.sh [path]     install into that project (default: current dir)
#   scripts/install.sh --global   install into ~/.config/opencode for all projects
#
# Existing files are never overwritten unless you pass --force.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="$PWD"
global=0
force=0

for arg in "$@"; do
  case "$arg" in
    --global) global=1 ;;
    --force) force=1 ;;
    *) target="$arg" ;;
  esac
done

if [ "$global" -eq 1 ]; then
  target="$HOME/.config/opencode"
fi

requested="$target"
target="$(cd "$requested" 2>/dev/null && pwd)" || {
  echo "install: no such directory: ${requested}" >&2
  exit 1
}

install_file() {
  src="$1"
  dest="$2"
  if [ -e "$dest" ] && [ "$force" -eq 0 ]; then
    echo "  skip     ${dest#"$target"/} (exists; pass --force to overwrite)"
    return
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "  install  ${dest#"$target"/}"
}

echo "CogniCode -> $target"

install_file "$root/.opencode/plugin/cognicode.ts" "$target/.opencode/plugin/cognicode.ts"

for skill in cognicode-learn cognicode-reset; do
  for file in "$root/.opencode/skills/$skill"/*; do
    install_file "$file" "$target/.opencode/skills/$skill/$(basename "$file")"
  done
done

cat <<'NOTE'

Done. Restart opencode, then run  /cognicode-learn  in your project.
Type it even if it is not in the autocomplete list; /skills also lists it.

To keep the skills slash-only on opencode 1.18.x, add to opencode.json:

  "permission": { "skill": { "*": "allow", "cognicode-*": "deny" } }

Notes and machine state live in .cognicode/ inside each project. Add it to that
project's .gitignore — CogniCode suggests it but never edits .gitignore itself.
NOTE