import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";

const { collectInteractiveElementsMock, summarizePageStateMock } = vi.hoisted(() => ({
  collectInteractiveElementsMock: vi.fn().mockResolvedValue([]),
  summarizePageStateMock: vi.fn().mockReturnValue({
    surface: "generic",
    hasModal: false,
    hasIframe: false,
    frameCount: 0,
    hasLoginForm: false,
    hasProviderChooser: false,
    hasSearchResults: false,
    matchedSignals: []
  })
}));

vi.mock("../playwright/collector/interactive-elements.js", () => ({
  collectInteractiveElements: collectInteractiveElementsMock
}));

vi.mock("../playwright/collector/page-state.js", () => ({
  summarizePageState: summarizePageStateMock
}));

import { collectPageSnapshot } from "../playwright/collector/page-snapshot.js";

const createFakePage = (overrides: Partial<Page> = {}): Page =>
  ({
    screenshot: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn(() => false),
    context: vi.fn(() => ({ pages: () => [] })),
    url: vi.fn(() => "https://example.com/search"),
    title: vi.fn().mockResolvedValue("Example Search"),
    ...overrides
  }) as unknown as Page;

describe("collectPageSnapshot", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("falls back to a placeholder image when screenshot capture times out", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "qpilot-page-snapshot-"));
    tempDirs.push(artifactDir);
    const screenshotError = new Error(
      [
        "page.screenshot: Timeout 30000ms exceeded.",
        "Call log:",
        "  - taking page screenshot",
        "    - disabled all CSS animations",
        "  - waiting for fonts to load..."
      ].join("\n")
    );
    const page = createFakePage({
      screenshot: vi.fn().mockRejectedValue(screenshotError)
    });

    const snapshot = await collectPageSnapshot(page, {
      artifactDir,
      screenshotPublicPrefix: "/artifacts/runs/test-run",
      stepIndex: 3
    });

    const written = await readFile(join(artifactDir, "step-0003.png"));
    expect(written.length).toBeGreaterThan(0);
    expect(snapshot.screenshotPath).toBe("/artifacts/runs/test-run/step-0003.png");
    expect(snapshot.title).toBe("Example Search");
    expect(snapshot.url).toBe("https://example.com/search");
    expect(collectInteractiveElementsMock).toHaveBeenCalledTimes(1);
    expect(summarizePageStateMock).toHaveBeenCalledTimes(1);
  });
});
