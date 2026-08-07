---
name: hooks
description: Use when a repository needs durable Git hook gates installed, checked, or inspected through `bb hooks`.
---

# Hooks

Use `bb hooks status` before changing hook configuration so you can see which
repositories point at the durable plugin hook directory.

Use `bb hooks install <repo-path>` to point a Git repository at the plugin hook
directory. The installer preserves an existing `core.hooksPath` in
`bb-hooks.previousHooksPath`; the plugin hook chains that previous
`pre-commit` hook and any executable repository-local `.git/hooks/pre-commit`.

Use `bb hooks check --staged <repo-path>` to run the same staged gates that
the Git hook runs. Use `bb hooks check <path>` to scan a file or directory
outside a commit.
