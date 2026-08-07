import type { BbPluginApi } from "@bb/plugin-sdk";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { defaultRoots, formatContributedFailures } from "./src/defaults.js";
import {
  checkPath,
  formatCheckResult,
  listGates,
  runStagedGates,
} from "./src/gates.js";
import {
  formatStatusMatrix,
  installHooks,
  statusMatrix,
  uninstallHooks,
} from "./src/git-hooks.js";
import { createWatcherState, startWatcher } from "./src/watcher.js";

const pluginRoot = path.dirname(new URL(import.meta.url).pathname);
const hooksPath = path.join(pluginRoot, "hooks");
const watcherState = createWatcherState();

function splitRoots(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function help(): string {
  return [
    "Usage: bb hooks <command>",
    "",
    "Commands:",
    "  install <repo-path>    Set core.hooksPath and preserve chained hooks",
    "  uninstall <repo-path>  Restore the previous hooksPath or unset ours",
    "  status                 Show repositories with configured hooksPath",
    "  gates                  List registered gates",
    "  check [--staged] <path>  Run gates manually against staged files or a path",
  ].join("\n");
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    watchRoots: {
      type: "string",
      label: "Watch roots",
      description: "Newline or comma separated repository roots to scan for hook gate failures.",
      default: defaultRoots.join("\n"),
    },
    watcherEnabled: {
      type: "boolean",
      label: "Enable watcher",
      description: "Detect Markdown gate failures outside commits.",
      default: true,
    },
  });

  const initial = await settings.get();
  watcherState.setRoots(splitRoots(initial.watchRoots));
  watcherState.setEnabled(initial.watcherEnabled);

  settings.onChange((next) => {
    watcherState.setRoots(splitRoots(next.watchRoots));
    watcherState.setEnabled(next.watcherEnabled);
  });

  bb.cli.register({
    name: "hooks",
    summary: "Manage durable repository hook gates.",
    commands: [
      {
        name: "install",
        summary: "Install the durable hooks path in a repository.",
        usage: "bb hooks install <repo-path>",
      },
      {
        name: "uninstall",
        summary: "Restore the previous hooksPath or unset the plugin hook.",
        usage: "bb hooks uninstall <repo-path>",
      },
      {
        name: "status",
        summary: "Show repositories with configured hooksPath.",
        usage: "bb hooks status",
      },
      {
        name: "gates",
        summary: "List registered gates.",
        usage: "bb hooks gates",
      },
      {
        name: "check",
        summary: "Run gates manually against staged files or a path.",
        usage: "bb hooks check [--staged] <path>",
      },
    ],
    async run(argv, ctx) {
      const [command, ...rest] = argv;
      const cwd = ctx.cwd ?? process.cwd();
      try {
        if (!command || command === "help" || command === "--help" || command === "-h") {
          return { exitCode: 0, stdout: `${help()}\n` };
        }
        if (command === "install") {
          const repo = rest[0];
          if (!repo) return { exitCode: 2, stderr: "Missing repo path.\n" };
          const result = installHooks(path.resolve(cwd, repo), hooksPath);
          return { exitCode: 0, stdout: `${result.message}\n` };
        }
        if (command === "uninstall") {
          const repo = rest[0];
          if (!repo) return { exitCode: 2, stderr: "Missing repo path.\n" };
          const result = uninstallHooks(path.resolve(cwd, repo), hooksPath);
          return { exitCode: 0, stdout: `${result.message}\n` };
        }
        if (command === "status") {
          const matrix = statusMatrix(hooksPath);
          return { exitCode: 0, stdout: `${formatStatusMatrix(matrix)}\n` };
        }
        if (command === "gates") {
          return { exitCode: 0, stdout: `${listGates()}\n` };
        }
        if (command === "check") {
          if (rest[0] === "--staged") {
            const repo = rest[1] ? path.resolve(cwd, rest[1]) : cwd;
            const result = runStagedGates(repo);
            return {
              exitCode: result.ok ? 0 : 1,
              stdout: `${formatCheckResult(result)}\n`,
            };
          }
          const target = rest[0] ? path.resolve(cwd, rest[0]) : cwd;
          if (!existsSync(target)) return { exitCode: 2, stderr: `Path not found: ${target}\n` };
          const result = checkPath(target);
          return {
            exitCode: result.ok ? 0 : 1,
            stdout: `${formatCheckResult(result)}\n`,
          };
        }
        return { exitCode: 2, stderr: `Unknown hooks command: ${command}\n\n${help()}\n` };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: `${error instanceof Error ? error.message : String(error)}\n`,
        };
      }
    },
  });

  bb.background.service("watcher", {
    async start(signal) {
      await startWatcher({
        signal,
        state: watcherState,
        log: bb.log,
        intervalMs: 60_000,
      });
    },
  });

  bb.agents.contributeInstructions(() => {
    return formatContributedFailures(watcherState.getFailures());
  });

  if (!existsSync(hooksPath) || !statSync(hooksPath).isDirectory()) {
    bb.log.warn(`Hooks path does not exist: ${hooksPath}`);
  }
}
