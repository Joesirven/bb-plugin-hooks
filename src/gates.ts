import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type GateKind = "builtin" | "command";

export interface Gate {
  name: string;
  fileGlob: string;
  kind: GateKind;
  command?: string[];
  description: string;
}

export interface GateFailure {
  gateName: string;
  path: string;
  message: string;
}

export interface GateCheckResult {
  ok: boolean;
  failures: GateFailure[];
}

const requiredFields = ["title", "type", "status", "updated"];
const allowedTypes = new Set([
  "ops",
  "architecture",
  "data",
  "model",
  "product",
  "research",
  "brand",
  "library",
  "meta",
  "readme",
  "project",
  "business",
  "synthesis",
]);
const allowedStatuses = new Set([
  "draft",
  "active",
  "locked",
  "complete",
  "archived",
  "planned",
  "in-progress",
  "research-complete",
]);
const skipFragments = [
  "08-ARCHIVE/",
  "site/",
  ".obsidian/",
  "_tools/",
  "-TEMPLATE.md",
  "AGENTS.md",
  "agents.md",
  "README.md",
];

export const gates: Gate[] = [
  {
    name: "frontmatter",
    fileGlob: "**/*.md",
    kind: "builtin",
    description: "Markdown files must carry valid required frontmatter fields.",
  },
];

export function listGates(): string {
  return gates
    .map((gate) => `${gate.name}\t${gate.fileGlob}\t${gate.kind}\t${gate.description}`)
    .join("\n");
}

export function shouldCheckFrontmatter(relativePath: string): boolean {
  return relativePath.endsWith(".md") && !skipFragments.some((fragment) => relativePath.includes(fragment));
}

export function validateFrontmatterText(relativePath: string, text: string): GateFailure[] {
  const failures: GateFailure[] = [];
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    return [{ gateName: "frontmatter", path: relativePath, message: "missing frontmatter block" }];
  }
  const fields = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^(\w+):\s*(.*)$/);
    if (field) fields.set(field[1], field[2]);
  }
  for (const required of requiredFields) {
    if (!fields.has(required)) {
      failures.push({ gateName: "frontmatter", path: relativePath, message: `missing field '${required}'` });
    }
  }
  const type = (fields.get("type") ?? "").trim();
  if (!allowedTypes.has(type)) {
    failures.push({ gateName: "frontmatter", path: relativePath, message: `bad type '${type}'` });
  }
  const status = (fields.get("status") ?? "").trim();
  if (!allowedStatuses.has(status)) {
    failures.push({ gateName: "frontmatter", path: relativePath, message: `bad status '${status}'` });
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(fields.get("updated") ?? "")) {
    failures.push({ gateName: "frontmatter", path: relativePath, message: "bad updated date" });
  }
  return failures;
}

function walkMarkdown(root: string): string[] {
  const found: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(".md")) {
        found.push(fullPath);
      }
    }
  }
  return found;
}

export function checkPath(targetPath: string): GateCheckResult {
  const root = statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath);
  const files = statSync(targetPath).isDirectory() ? walkMarkdown(targetPath) : [targetPath];
  const failures: GateFailure[] = [];
  for (const file of files) {
    const relative = path.relative(root, file);
    if (!shouldCheckFrontmatter(relative)) continue;
    failures.push(...validateFrontmatterText(file, readFileSync(file, "utf8")));
  }
  return { ok: failures.length === 0, failures };
}

export function runStagedGates(repoPath: string): GateCheckResult {
  const script = path.join(path.dirname(path.dirname(new URL(import.meta.url).pathname)), "hooks", "validate_frontmatter.py");
  if (!existsSync(script)) {
    return {
      ok: false,
      failures: [{ gateName: "frontmatter", path: repoPath, message: `validator not found: ${script}` }],
    };
  }
  const result = spawnSync(script, { cwd: repoPath, encoding: "utf8" });
  if (result.status === 0) return { ok: true, failures: [] };
  const output = `${result.stdout}${result.stderr}`.trim();
  return {
    ok: false,
    failures: parseValidatorOutput(output),
  };
}

export function parseValidatorOutput(output: string): GateFailure[] {
  const failures: GateFailure[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line || line === "FRONTMATTER VALIDATION FAILED:") continue;
    const match = line.match(/^(.+?):\s*(.+)$/);
    failures.push({
      gateName: "frontmatter",
      path: match?.[1] ?? "",
      message: match?.[2] ?? line,
    });
  }
  return failures.length > 0 ? failures : [{ gateName: "frontmatter", path: "", message: output }];
}

export function formatCheckResult(result: GateCheckResult): string {
  if (result.ok) return "All gates passed.";
  return [
    "HOOK GATE FAILED:",
    ...result.failures.map((failure) => `${failure.path}: ${failure.message} [${failure.gateName}]`),
  ].join("\n");
}
