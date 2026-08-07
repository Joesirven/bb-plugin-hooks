#!/usr/bin/env python3
"""Pre-commit frontmatter validator for the Jefferson vault.
Fails the commit if any staged .md file lacks valid frontmatter.

Open item (investigated 2026-07-12, session reconcile-s1-tooling-2026-07-12):
the migration prescription calls for making the pre-commit gate hard in every
knowledge base that inherits the base — today it is best-effort, only warning
when this tool cannot be found. This repository (Meadow) was searched for the
hook template or hook-installation script that would need that hardening, and
none exists here: only the stock `.git/hooks/pre-commit.sample` placeholder
and an unrelated server-side post-receive hook (`server/sync/post-receive-hook.sh`,
installed by `server/sync/setup-kb.sh`) were found. Whatever installs the
client-side pre-commit hook that calls this validator must live in a
knowledge-base repository, which is outside this work-stream's write scope
(tools/ and schema/ only). This is a real open item for whichever work-stream
owns a knowledge-base repository next, not something silently dropped."""
import re, subprocess, sys

REQ = ["title", "type", "status", "updated"]
TYPES = {"ops","architecture","data","model","product","research","brand","library","meta","readme","project","business","synthesis"}
STATUS = {"draft","active","locked","complete","archived","planned","in-progress","research-complete"}
# "AGENTS.md" (uppercase) is kept for any path that still carries that casing;
# "agents.md" (lowercase) and "README.md" are added because the base knowledge
# base uses the lowercase agent-instructions file name in every directory and
# ships frontmatter-less readme files that carry no frontmatter block at all.
SKIP = ("08-ARCHIVE/", "site/", ".obsidian/", "_tools/", "-TEMPLATE.md", "AGENTS.md", "agents.md", "README.md")

def staged_md():
    # Split on newlines only: `git diff --name-only` emits one path per line,
    # and a bare `.split()` would also split on spaces inside a single staged
    # file name (a live pattern in Obsidian vaults), tearing one path into
    # several bogus tokens that silently evade validation.
    out = subprocess.run(["git","diff","--cached","--name-only","--diff-filter=ACM"],
                         capture_output=True, text=True).stdout.splitlines()
    return [f for f in out if f.endswith(".md") and not any(s in f for s in SKIP)]

def check(path):
    errs = []
    # Read the staged blob from the git index (stage 0), not the working-tree
    # copy on disk. Reading the disk copy would let a violating staged blob
    # commit clean if the working-tree file were edited back to compliant
    # after staging without re-staging it.
    result = subprocess.run(["git", "show", f":{path}"], capture_output=True, text=True)
    if result.returncode != 0:
        # Staged blob could not be read (for example a deleted-but-still-listed
        # path) — treat it the same way a missing working-tree file used to be
        # treated: no errors for this file, rather than a false "missing
        # frontmatter block" verdict from empty output.
        return []
    text = result.stdout
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return [f"{path}: missing frontmatter block"]
    fm = m.group(1)
    fields = dict(re.findall(r"^(\w+):\s*(.*)$", fm, re.M))
    for r in REQ:
        if r not in fields: errs.append(f"{path}: missing field '{r}'")
    if fields.get("type","").strip() not in TYPES: errs.append(f"{path}: bad type '{fields.get('type','')}'")
    if fields.get("status","").strip() not in STATUS: errs.append(f"{path}: bad status '{fields.get('status','')}'")
    if not re.match(r"\d{4}-\d{2}-\d{2}", fields.get("updated","")): errs.append(f"{path}: bad updated date")
    return errs

errs = [e for f in staged_md() for e in check(f)]
if errs:
    print("FRONTMATTER VALIDATION FAILED:\n" + "\n".join(errs))
    sys.exit(1)
