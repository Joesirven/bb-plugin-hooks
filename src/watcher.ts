import { existsSync, statSync } from "node:fs";
import type { PluginLogger } from "@bb/plugin-sdk";
import { checkPath, type GateFailure } from "./gates.js";

export interface WatcherState {
  setRoots(roots: string[]): void;
  getRoots(): string[];
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  setFailures(failures: GateFailure[]): void;
  getFailures(): GateFailure[];
}

export function createWatcherState(): WatcherState {
  let roots: string[] = [];
  let enabled = true;
  let failures: GateFailure[] = [];
  return {
    setRoots(next) {
      roots = [...next];
    },
    getRoots() {
      return [...roots];
    },
    setEnabled(next) {
      enabled = next;
    },
    isEnabled() {
      return enabled;
    },
    setFailures(next) {
      failures = [...next];
    },
    getFailures() {
      return [...failures];
    },
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function scanRoots(state: WatcherState, log?: PluginLogger): Promise<GateFailure[]> {
  if (!state.isEnabled()) {
    state.setFailures([]);
    return [];
  }
  const failures: GateFailure[] = [];
  for (const root of state.getRoots()) {
    if (!existsSync(root) || !statSync(root).isDirectory()) continue;
    const result = checkPath(root);
    failures.push(...result.failures);
  }
  state.setFailures(failures);
  if (failures.length > 0) {
    log?.warn(`bb hooks watcher detected ${failures.length} gate failure(s) outside a commit`);
  }
  return failures;
}

export async function startWatcher(options: {
  signal: AbortSignal;
  state: WatcherState;
  log?: PluginLogger;
  intervalMs: number;
}): Promise<void> {
  while (!options.signal.aborted) {
    await scanRoots(options.state, options.log);
    await sleep(options.intervalMs, options.signal);
  }
}
