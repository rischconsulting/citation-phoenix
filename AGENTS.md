# AGENTS.md

Repository contract for Codex and other agents.

## Rules

- Treat handwritten source as the source of truth.
- Edit source files, not generated output, unless the user explicitly asks for a bundle-only hotfix.
- Do not hand-edit `content/citation-phoenix.js`; `package-xpi.ps1` regenerates it.
- Use `package-xpi.ps1` as the canonical packaging step.
- Keep packaging logic and fixes in source files and build scripts.
- Use `apply_patch` for manual edits.
- Preserve user changes unless the user asks you to replace them.
- Keep changes small and targeted.
