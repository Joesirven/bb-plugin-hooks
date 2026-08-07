import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatStatusMatrix,
  installHooks,
  statusMatrix,
  uninstallHooks,
} from "../src/git-hooks.js";

const tempRoots: string[] = [];

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function tempRepo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "bb-plugin-hooks-repo-"));
  tempRoots.push(root);
  run("git", ["init"], root);
  run("git", ["config", "user.email", "hooks@example.test"], root);
  run("git", ["config", "user.name", "Hooks Test"], root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("hook installation", () => {
  it("sets the plugin hooks path", () => {
    const repo = tempRepo();
    const hooks = path.join(tempRepo(), "hooks");
    mkdirSync(hooks);
    const result = installHooks(repo, hooks);
    expect(result.previousHooksPath).toBeNull();
    expect(run("git", ["config", "--get", "core.hooksPath"], repo)).toBe(hooks);
  });

  it("preserves and restores an existing hooksPath", () => {
    const repo = tempRepo();
    const previous = path.join(tempRepo(), "previous-hooks");
    const hooks = path.join(tempRepo(), "plugin-hooks");
    mkdirSync(previous);
    mkdirSync(hooks);
    run("git", ["config", "core.hooksPath", previous], repo);

    const installed = installHooks(repo, hooks);
    expect(installed.previousHooksPath).toBe(previous);
    expect(run("git", ["config", "--get", "bb-hooks.previousHooksPath"], repo)).toBe(previous);
    expect(run("git", ["config", "--get", "core.hooksPath"], repo)).toBe(hooks);

    const uninstalled = uninstallHooks(repo, hooks);
    expect(uninstalled.previousHooksPath).toBe(previous);
    expect(run("git", ["config", "--get", "core.hooksPath"], repo)).toBe(previous);
  });

  it("does not preserve the temporary migration hooks path", () => {
    const repo = tempRepo();
    const hooks = path.join(tempRepo(), "plugin-hooks");
    mkdirSync(hooks);
    run("git", ["config", "core.hooksPath", "/home/jose/bb-migration/hooks"], repo);

    const installed = installHooks(repo, hooks);
    expect(installed.previousHooksPath).toBeNull();
    expect(run("git", ["config", "--get", "core.hooksPath"], repo)).toBe(hooks);
    const previous = spawnSync("git", ["config", "--get", "bb-hooks.previousHooksPath"], { cwd: repo, encoding: "utf8" });
    expect(previous.status).not.toBe(0);
  });

  it("reports a status matrix for configured repositories", () => {
    const repo = tempRepo();
    const hooks = path.join(tempRepo(), "plugin-hooks");
    mkdirSync(hooks);
    installHooks(repo, hooks);

    const rows = statusMatrix(hooks, [repo]);
    expect(rows).toEqual([
      {
        repoPath: repo,
        hooksPath: hooks,
        pointsHere: true,
        previousHooksPath: null,
      },
    ]);
    expect(formatStatusMatrix(rows)).toContain("points here");
  });

  it("chains repository-local pre-commit hooks", () => {
    const repo = tempRepo();
    const hooks = path.join(tempRepo(), "plugin-hooks");
    mkdirSync(hooks);
    writeFileSync(path.join(hooks, "validate_frontmatter.py"), "#!/bin/sh\nexit 0\n");
    chmodSync(path.join(hooks, "validate_frontmatter.py"), 0o755);
    writeFileSync(
      path.join(hooks, "pre-commit"),
      "#!/bin/sh\n\"$(dirname \"$0\")/validate_frontmatter.py\"\n.git/hooks/pre-commit\n",
    );
    chmodSync(path.join(hooks, "pre-commit"), 0o755);
    writeFileSync(path.join(repo, ".git/hooks/pre-commit"), "#!/bin/sh\necho chained > chained.txt\n");
    chmodSync(path.join(repo, ".git/hooks/pre-commit"), 0o755);
    installHooks(repo, hooks);

    writeFileSync(path.join(repo, "file.txt"), "content\n");
    run("git", ["add", "file.txt"], repo);
    run("git", ["commit", "-m", "test"], repo);
    expect(run("git", ["status", "--short"], repo)).toBe("?? chained.txt");
  });
});
