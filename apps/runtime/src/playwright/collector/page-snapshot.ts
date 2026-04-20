import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import type { PageSnapshot } from "@qpilot/shared";
import { collectInteractiveElements } from "./interactive-elements.js";
import { summarizePageState } from "./page-state.js";

export interface SnapshotOptions {
  artifactDir: string;
  screenshotPublicPrefix: string;
  stepIndex: number;
  label?: string;
}

const SCREENSHOT_TIMEOUT_MS = 5_000;

const CLOSED_PAGE_PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9l9wAAAABJRU5ErkJggg==",
  "base64"
);

const isClosedPageError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /target page, context or browser has been closed|page closed/i.test(message);
};

const isScreenshotTimeoutError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /page\.screenshot: timeout|waiting for fonts to load|taking page screenshot/i.test(
    message.toLowerCase()
  );
};

const isRecoverableScreenshotError = (error: unknown): boolean =>
  isClosedPageError(error) || isScreenshotTimeoutError(error);

const resolveSnapshotPage = (page: Page): Page => {
  if (!page.isClosed()) {
    return page;
  }

  try {
    return [...page.context().pages()].reverse().find((candidate) => !candidate.isClosed()) ?? page;
  } catch {
    return page;
  }
};

const safePageUrl = (page: Page): string => {
  try {
    return page.url();
  } catch {
    return "about:blank";
  }
};

const captureSnapshotImage = async (page: Page, absolutePath: string): Promise<void> => {
  await page.screenshot({
    path: absolutePath,
    fullPage: false,
    animations: "disabled",
    scale: "css",
    timeout: SCREENSHOT_TIMEOUT_MS
  });
};

export const collectPageSnapshot = async (
  page: Page,
  options: SnapshotOptions
): Promise<PageSnapshot> => {
  await mkdir(options.artifactDir, { recursive: true });
  const filename = options.label
    ? `${options.label}.png`
    : `step-${String(options.stepIndex).padStart(4, "0")}.png`;
  const absolutePath = join(options.artifactDir, filename);
  const publicPath = `${options.screenshotPublicPrefix}/${filename}`;
  let snapshotPage = resolveSnapshotPage(page);

  try {
    await captureSnapshotImage(snapshotPage, absolutePath);
  } catch (error) {
    const replacementPage = resolveSnapshotPage(page);
    if (replacementPage !== snapshotPage && !replacementPage.isClosed()) {
      snapshotPage = replacementPage;
      try {
        await captureSnapshotImage(snapshotPage, absolutePath);
      } catch (replacementError) {
        if (isRecoverableScreenshotError(replacementError)) {
          await writeFile(absolutePath, CLOSED_PAGE_PLACEHOLDER_PNG);
        } else {
          throw replacementError;
        }
      }
    } else if (isRecoverableScreenshotError(error)) {
      await writeFile(absolutePath, CLOSED_PAGE_PLACEHOLDER_PNG);
    } else {
      throw error;
    }
  }

  const elements = snapshotPage.isClosed()
    ? []
    : await collectInteractiveElements(snapshotPage).catch(() => []);
  const title = snapshotPage.isClosed()
    ? "(closed page)"
    : await snapshotPage.title().catch(() => "(no title)");
  const pageState = summarizePageState({
    url: safePageUrl(snapshotPage),
    title,
    elements
  });

  return {
    url: safePageUrl(snapshotPage),
    title,
    screenshotPath: publicPath,
    elements,
    pageState
  };
};
