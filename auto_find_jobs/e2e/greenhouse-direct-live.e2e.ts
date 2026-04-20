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
const outputRoot = resolve(workspaceRoot, "output", "e2e", "auto-find-jobs-greenhouse-direct-live");
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
    await page.screenshot({
      path: resolve(screenshotRoot, "01-profile.png"),
      fullPage: true
    });

    await page.goto("/jobs", { waitUntil: "domcontentloaded" });
    await page.getByTestId("direct-apply-url").fill(
      `${fixtureServer.baseUrl}/apply/greenhouse/research-engineer`
    );
    await page.locator("label").filter({ hasText: "ATS 覆盖" }).locator("select").selectOption("greenhouse");
    await page.locator("label").filter({ hasText: "公司名称" }).locator("input").fill("FixtureCo Live");
    await page.locator("label").filter({ hasText: "岗位名称" }).locator("input").fill("Research Engineer Live");
    await page.getByTestId("direct-prepare-button").click();
    await page.screenshot({
      path: resolve(screenshotRoot, "02-live-url-prepared.png"),
      fullPage: true
    });

    await page.goto("/review", { waitUntil: "domcontentloaded" });
    await expectText(page, "Desired compensation");
    await page
      .locator("article.list-card")
      .filter({ hasText: "Desired compensation" })
      .locator("input")
      .fill("$150,000");
    await page.getByTestId("save-review-button").click();
    await page.getByTestId("review-start-button").waitFor({ timeout: 20_000 });
    await page.getByTestId("review-start-button").click();
    await page.getByTestId("enable-final-submit-button").waitFor({ timeout: 20_000 });
    await page.screenshot({
      path: resolve(screenshotRoot, "03-prefill-complete.png"),
      fullPage: true
    });

    await page.getByTestId("enable-final-submit-button").click();
    await page.getByTestId("confirm-submit-button").waitFor({ timeout: 20_000 });
    await page.screenshot({
      path: resolve(screenshotRoot, "04-submit-enabled.png"),
      fullPage: true
    });
    await page.getByTestId("confirm-submit-button").click();

    await page.goto("/applications", { waitUntil: "domcontentloaded" });
    await expectText(page, "Research Engineer Live");
    await expectText(page, "已提交");
    await expectText(page, "打开 HTML 快照");
    await page.screenshot({
      path: resolve(screenshotRoot, "05-applications-submitted.png"),
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
            profile: resolve(screenshotRoot, "01-profile.png"),
            prepared: resolve(screenshotRoot, "02-live-url-prepared.png"),
            prefillComplete: resolve(screenshotRoot, "03-prefill-complete.png"),
            submitEnabled: resolve(screenshotRoot, "04-submit-enabled.png"),
            submitted: resolve(screenshotRoot, "05-applications-submitted.png")
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
    console.log(`Greenhouse direct live E2E completed. Output: ${outputRoot}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
