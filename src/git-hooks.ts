import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const previousHooksPathKey = "bb-hooks.previousHooksPath";
const obsoleteHooksPaths = new Set(["/home/jose/bb-migration/hooks"]);

export interface InstallResult {
  repoPath: string;
  previousHooksPath: string | null;
  message: string;
}

export interface StatusRow {
  repoPath: string;
  hooksPath: string;
  pointsHere: boolean;
  previousHooksPath: string | null;
}

function git(repoPath: string, args: string[]): string {
  const result = spawnSync("git", ["-C", repoPath, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return result.stdout.trim();
}

function gitMaybe(repoPath: string, args: string[]): string | null {
  const result = spawnSync("git", ["-C", repoPath, ...args], { encoding: "utf8" });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return value === "" ? null : value;
}

export function normalizeHooksPath(repoPath: string, hooksPath: string): string {
  return path.resolve(repoPath, hooksPath);
}

export function isGitRepository(repoPath: string): boolean {
  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) return false;
  return spawnSync("git", ["-C", repoPath, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).status === 0;
}

export function installHooks(repoPath: string, pluginHooksPath: string): InstallResult {
  if (!isGitRepository(repoPath)) throw new Error(`Not a Git repository: ${repoPath}`);
  const current = gitMaybe(repoPath, ["config", "--get", "core.hooksPath"]);
  const normalizedCurrent = current ? normalizeHooksPath(repoPath, current) : null;
  const normalizedPlugin = path.resolve(pluginHooksPath);
  if (normalizedCurrent === normalizedPlugin) {
    return { repoPath, previousHooksPath: gitMaybe(repoPath, ["config", "--get", previousHooksPathKey]), message: `${repoPath}: already installed` };
  }
  const shouldPreserveCurrent = current !== null && !obsoleteHooksPaths.has(normalizedCurrent ?? current);
  if (shouldPreserveCurrent) git(repoPath, ["config", previousHooksPathKey, current]);
  git(repoPath, ["config", "core.hooksPath", normalizedPlugin]);
  return {
    repoPath,
    previousHooksPath: shouldPreserveCurrent ? current : null,
    message: shouldPreserveCurrent
      ? `${repoPath}: installed ${normalizedPlugin}; chained previous hooksPath ${current}`
      : `${repoPath}: installed ${normalizedPlugin}`,
  };
}

export function uninstallHooks(repoPath: string, pluginHooksPath: string): InstallResult {
  if (!isGitRepository(repoPath)) throw new Error(`Not a Git repository: ${repoPath}`);
  const current = gitMaybe(repoPath, ["config", "--get", "core.hooksPath"]);
  const previous = gitMaybe(repoPath, ["config", "--get", previousHooksPathKey]);
  const normalizedCurrent = current ? normalizeHooksPath(repoPath, current) : null;
  const normalizedPlugin = path.resolve(pluginHooksPath);
  if (normalizedCurrent !== normalizedPlugin) {
    return { repoPath, previousHooksPath: previous, message: `${repoPath}: plugin hooks are not installed` };
  }
  if (previous) {
    git(repoPath, ["config", "core.hooksPath", previous]);
    git(repoPath, ["config", "--unset", previousHooksPathKey]);
    return { repoPath, previousHooksPath: previous, message: `${repoPath}: restored previous hooksPath ${previous}` };
  }
  git(repoPath, ["config", "--unset", "core.hooksPath"]);
  return { repoPath, previousHooksPath: null, message: `${repoPath}: unset plugin hooksPath` };
}

export function discoverRepositories(basePaths = ["/home/jose/kbs", "/home/jose/dev"]): string[] {
  const repos = new Set<string>();
  for (const base of basePaths) {
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const repoPath = path.join(base, entry.name);
      if (isGitRepository(repoPath)) repos.add(repoPath);
    }
  }
  return [...repos].sort();
}

export function statusMatrix(pluginHooksPath: string, repoPaths = discoverRepositories()): StatusRow[] {
  const normalizedPlugin = path.resolve(pluginHooksPath);
  const rows: StatusRow[] = [];
  for (const repoPath of repoPaths) {
    const configured = gitMaybe(repoPath, ["config", "--get", "core.hooksPath"]);
    if (!configured) continue;
    rows.push({
      repoPath,
      hooksPath: configured,
      pointsHere: normalizeHooksPath(repoPath, configured) === normalizedPlugin,
      previousHooksPath: gitMaybe(repoPath, ["config", "--get", previousHooksPathKey]),
    });
  }
  return rows;
}

export function formatStatusMatrix(rows: StatusRow[]): string {
  if (rows.length === 0) return "No discovered repositories have core.hooksPath set.";
  const header = "Repository\tcore.hooksPath\tpoints here\tchained previous";
  return [
    header,
    ...rows.map((row) => `${row.repoPath}\t${row.hooksPath}\t${row.pointsHere ? "yes" : "no"}\t${row.previousHooksPath ?? ""}`),
  ].join("\n");
}
