import type { GateFailure } from "./gates.js";

export const defaultRoots = [
  "/home/jose/kbs/sirven-kb",
  "/home/jose/kbs/jefferson",
  "/home/jose/kbs/spectrium",
  "/home/jose/kbs/legal-agent",
  "/home/jose/dev/meadow",
];

export function formatContributedFailures(failures: GateFailure[]): string | null {
  if (failures.length === 0) return null;
  const byGate = new Map<string, GateFailure[]>();
  for (const failure of failures) {
    const list = byGate.get(failure.gateName) ?? [];
    list.push(failure);
    byGate.set(failure.gateName, list);
  }
  const lines = ["bb hooks detected files in configured workspaces that currently fail gates:"];
  for (const [gate, gateFailures] of byGate) {
    const paths = [...new Set(gateFailures.map((failure) => failure.path))].slice(0, 20);
    lines.push(`${paths.length} files currently fail ${gate}:`);
    for (const failurePath of paths) lines.push(`- ${failurePath}`);
  }
  return lines.join("\n");
}
