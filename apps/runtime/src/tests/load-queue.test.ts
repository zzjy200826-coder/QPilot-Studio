import { describe, expect, it, vi } from "vitest";
import { PlatformLoadQueue } from "../platform/load-queue.js";

describe("platform load queue", () => {
  it("falls back to inline mode when redis is not configured", async () => {
    const processor = vi.fn(async () => {});
    const queue = new PlatformLoadQueue({
      redisUrl: undefined,
      queueName: "platform-load-runs",
      workerEnabled: false,
      workerConcurrency: 1,
      jobAttempts: 3,
      jobBackoffMs: 1500,
      workerHeartbeatTimeoutMs: 15000,
      processor
    });

    const result = await queue.enqueue({ runId: "run-1" });

    expect(queue.mode).toBe("inline");
    expect(queue.isAvailable).toBe(false);
    expect(result.mode).toBe("inline");

    const summary = await queue.getSummary();
    expect(summary.mode).toBe("inline");
    expect(summary.isConnected).toBe(false);
    expect(summary.counts.waiting).toBe(0);
    expect(summary.detail).toContain("inline");
    expect(summary.retryPolicy.attempts).toBe(3);
    expect(summary.workerHealth.timeoutMs).toBe(15000);

    const cancel = await queue.cancel("run-1");
    expect(cancel.ok).toBe(true);
    expect(cancel.detail).toContain("Inline mode");

    await queue.close();
    expect(processor).not.toHaveBeenCalled();
  });
});
