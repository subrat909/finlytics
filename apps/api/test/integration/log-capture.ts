/**
 * Captures the api's JSON log lines in memory (pino's `destination`).
 *
 * nestjs-pino builds ONE pino-http instance per process, from the first app's options. So every app a test file
 * builds logs here, at the harness's level (createTestApp): one capture per test file, filtered by request id.
 */
import type { DestinationStream } from "pino";

export type LogLine = Readonly<Record<string, unknown>>;

export class LogCapture implements DestinationStream {
  private readonly raw: string[] = [];

  write(chunk: string): void {
    this.raw.push(...chunk.split("\n").filter((line) => line !== ""));
  }

  /** Every line captured since the last clear(), as written. */
  text(): string {
    return this.raw.join("\n");
  }

  /** Every line captured since the last clear(), parsed. */
  lines(): LogLine[] {
    return this.raw.map((line) => JSON.parse(line) as LogLine);
  }

  /** The lines logged for one request. */
  forRequest(requestId: string): LogLine[] {
    return this.lines().filter((line) => line["requestId"] === requestId);
  }

  clear(): void {
    this.raw.length = 0;
  }
}

/** The capture every app of this test file logs to. */
export const logCapture = new LogCapture();
