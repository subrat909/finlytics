/**
 * Child processes for the test helpers (`@finlytics/database/testing`): no shell, output collected, a timeout. Like
 * every module of this entry, it never imports "vitest": Vitest global setups run it in the main process.
 */
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 120_000;

export interface ProcessResult {
  /** The exit code, or null when the process was killed by a signal (for example on timeout). */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunProcessOptions {
  readonly cwd: string;
  /** The child's whole environment: nothing is inherited unless it is passed here. */
  readonly env: NodeJS.ProcessEnv;
  /** Kills the child after this long (SIGTERM). Defaults to 2 minutes. */
  readonly timeoutMs?: number;
}

/** Runs a process without a shell and collects its output. Resolves on exit, whatever the exit code. */
export function runProcess(file: string, args: readonly string[], options: RunProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
