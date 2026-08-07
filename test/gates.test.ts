import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkPath,
  gates,
  shouldCheckFrontmatter,
  validateFrontmatterText,
} from "../src/gates.js";

const tempRoots: string[] = [];

function tempDir(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "bb-plugin-hooks-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("gate registry", () => {
  it("registers frontmatter as the first gate", () => {
    expect(gates[0]).toMatchObject({
      name: "frontmatter",
      fileGlob: "**/*.md",
      kind: "builtin",
    });
  });

  it("skips documented frontmatter exceptions", () => {
    expect(shouldCheckFrontmatter("README.md")).toBe(false);
    expect(shouldCheckFrontmatter("notes/agents.md")).toBe(false);
    expect(shouldCheckFrontmatter("notes/plan.md")).toBe(true);
  });

  it("reports missing and malformed fields", () => {
    const failures = validateFrontmatterText("bad.md", "---\ntitle: Bad\nstatus: bogus\nupdated: soon\n---\n");
    expect(failures.map((failure) => failure.message)).toEqual([
      "missing field 'type'",
      "bad type ''",
      "bad status 'bogus'",
      "bad updated date",
    ]);
  });

  it("checks files under a directory", () => {
    const root = tempDir();
    writeFileSync(
      path.join(root, "good.md"),
      "---\ntitle: Good\ntype: ops\nstatus: active\nupdated: 2026-08-07\n---\n",
    );
    writeFileSync(path.join(root, "bad.md"), "No frontmatter\n");
    const result = checkPath(root);
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ path: path.join(root, "bad.md"), message: "missing frontmatter block" });
  });
});
