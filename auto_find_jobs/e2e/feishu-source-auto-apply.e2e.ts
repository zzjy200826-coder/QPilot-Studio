import { mkdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startFixtureServer } from "./helpers/fixture-server.ts";
import { getAvailablePort, spawnProcess, waitForUrl } from "./helpers/process.ts";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);
const appRoot = resolve(currentDir, "..");
const workspaceRoot = resolve(appRoot, "..");
const outputRoot = resolve(workspaceRoot, "output", "e2e", "auto-find-jobs-feishu-source-auto-apply");
const logsRoot = resolve(outputRoot, "logs");
const screenshotRoot = resolve(outputRoot, "screenshots");
const dataRoot = resolve(outputRoot, "runtime-data");
const runtimeLogPath = resolve(logsRoot, "runtime.log");
const webLogPath = resolve(logsRoot, "web.log");
const observationsPath = resolve(outputRoot, "observations.json");
const resumePath = resolve(appRoot, "tests", "fixtures", "resume.txt");

const expectText = async (
  scope: import("playwright").Page | import("playwright").Locator,
  text: string
): Promise<void> => {
  await scope.getByText(text, { exact: false }).first().waitFor({ timeout: 20_000 });
};

const run = async (): Promise<void> => {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(logsRoot, { recursive: true });
  mkdirSync(screenshotRoot, { recursive: true });

  const runtimePort = await getAvailablePort();
  const webPort = await getAvailablePort();
  const fixturePort = await getAvailablePort();
  const runtimeBaseUrl = `http://127.0.0.1:${runtimePort}`;
  const webBaseUrl = `http://127.0.0.1:${webPort}`;

  const fixtureServer = await startFixtureServer(fixturePort);
  const runtimeProcess = spawnProcess({
    cwd: appRoot,
    args: ["exec", "node", "dist/server/server/index.js"],
    logPath: runtimeLogPath,
    env: {
      AUTO_FIND_JOBS_HOST: "127.0.0.1",
      AUTO_FIND_JOBS_PORT: String(runtimePort),
      AUTO_FIND_JOBS_CLIENT_ORIGIN: webBaseUrl,
      AUTO_FIND_JOBS_DATA_DIR: dataRoot,
      AUTO_FIND_JOBS_DATABASE_PATH: resolve(dataRoot, "job-assistant.sqlite"),
      AUTO_FIND_JOBS_ARTIFACTS_DIR: resolve(dataRoot, "artifacts"),
      AUTO_FIND_JOBS_SESSIONS_DIR: resolve(dataRoot, "sessions"),
      AUTO_FIND_JOBS_GREENHOUSE_API_BASE: `${fixtureServer.baseUrl}/greenhouse/v1/boards`,
      AUTO_FIND_JOBS_LEVER_API_BASE: `${fixtureServer.baseUrl}/lever/v0/postings`,
      AUTO_FIND_JOBS_PLAYWRIGHT_HEADLESS: "true"
    }
  });
  const webProcess = spawnProcess({
    cwd: appRoot,
    args: ["exec", "vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
    logPath: webLogPath,
    env: {
      VITE_AUTO_FIND_JOBS_RUNTIME_BASE_URL: runtimeBaseUrl
    }
  });

  const cleanup = async (): Promise<void> => {
    await Promise.allSettled([webProcess.close(), runtimeProcess.close(), fixtureServer.close()]);
  };

  try {
    await waitForUrl(`${runtimeBaseUrl}/api/health`, 45_000, (response) => response.ok);
    await waitForUrl(`${webBaseUrl}/profile`, 45_000, (response) => response.ok);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      baseURL: webBaseUrl,
      locale: "zh-CN",
      viewport: { width: 1440, height: 1500 }
    });
    const page = await context.newPage();

    await page.goto("/profile", { waitUntil: "domcontentloaded" });
    await page.getByTestId("profile-first-name").fill("Zoe");
    await page.getByTestId("profile-last-name").fill("Jin");
    await page.getByTestId("profile-email").fill("zoe@example.com");
    await page.getByTestId("profile-phone").fill("+86 13800000000");
    await page.getByTestId("profile-city").fill("Shanghai");
    await page.getByTestId("profile-country").fill("China");
    await page.getByTestId("profile-linkedin").fill("https://linkedin.com/in/zoe");
    await page.getByTestId("profile-resume-path").fill(resumePath);
    await page.getByTestId("save-profile-button").click();

    await page.goto("/sources", { waitUntil: "domcontentloaded" });
    await page.getByTestId("source-seed-url").fill(`${fixtureServer.baseUrl}/feishu/sheet`);
    await page.getByTestId("source-kind").selectOption("feishu_sheet");
    await page.getByTestId("save-source-button").click();
    await expectText(page, "飞书岗位表");
    await page.getByTestId("scan-all-sources-button").click();
    await expectText(page, "扫描完成");
    await page.screenshot({
      path: resolve(screenshotRoot, "01-feishu-source.png"),
      fullPage: true
    });

    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await expectText(page, "FixtureCo Auto");
    await expectText(page, "Campus Portal Co");
    await expectText(page, "AUTO123");
    await expectText(page, "PORTAL888");

    const campusCard = page.locator("article.job-card").filter({ hasText: "Campus Portal Co" }).first();
    const blockedButton = campusCard.locator("button").first();
    await blockedButton.waitFor({ timeout: 20_000 });
    if (!(await blockedButton.isDisabled())) {
      throw new Error("The imported generic campus link should stay blocked from auto apply.");
    }

    await page.getByTestId("job-prepare-mode").selectOption("safe_auto_apply");
    const autoCard = page.locator("article.job-card").filter({ hasText: "FixtureCo Auto" }).first();
    await autoCard.locator("button").first().click();
    await page.screenshot({
      path: resolve(screenshotRoot, "02-feishu-jobs-auto-apply.png"),
      fullPage: true
    });

    await page.goto("/applications", { waitUntil: "domcontentloaded" });
    await expectText(page, "FixtureCo Auto");
    await expectText(page, "已提交");
    await page.screenshot({
      path: resolve(screenshotRoot, "03-feishu-auto-apply-submitted.png"),
      fullPage: true
    });

    await writeFile(
      observationsPath,
      JSON.stringify(
        {
          runtimeBaseUrl,
          webBaseUrl,
          fixtureBaseUrl: fixtureServer.baseUrl,
          screenshots: {
            source: resolve(screenshotRoot, "01-feishu-source.png"),
            jobs: resolve(screenshotRoot, "02-feishu-jobs-auto-apply.png"),
            submitted: resolve(screenshotRoot, "03-feishu-auto-apply-submitted.png")
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await browser.close();
  } finally {
    await cleanup();
  }
};

run()
  .then(() => {
    console.log(`Feishu source auto-apply E2E completed. Output: ${outputRoot}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
