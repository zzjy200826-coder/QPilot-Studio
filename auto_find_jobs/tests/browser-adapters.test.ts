import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { GreenhouseAdapter } from "../src/browser/adapters/greenhouse.js";
import { LeverAdapter } from "../src/browser/adapters/lever.js";
import { MokaAdapter, mokaAdapterUtils } from "../src/browser/adapters/moka.js";
import { PortalAdapter } from "../src/browser/adapters/portal.js";
import { FieldMapperService } from "../src/domain/mapping.js";
import type { CandidateProfile } from "../src/domain/schemas.js";

const resumePath = resolve(process.cwd(), "tests/fixtures/resume.txt");

const profile: CandidateProfile = {
  id: "default",
  basic: {
    firstName: "Zoe",
    lastName: "Jin",
    email: "zoe@example.com",
    phone: "+86 13800000000",
    city: "Shanghai",
    country: "China",
    linkedin: "https://linkedin.com/in/zoe",
    github: "https://github.com/zoe",
    portfolio: "https://zoe.dev"
  },
  education: [],
  experience: [],
  preferences: {
    targetKeywords: ["算法", "algorithm", "ai"],
    preferredLocations: ["上海", "shanghai"],
    excludeKeywords: ["销售"]
  },
  answers: {
    expectedSalary: "$150,000"
  },
  files: {
    resumePath,
    otherFiles: []
  }
};

const textField = (label: string, name: string, type = "text"): string =>
  `<label>${label} <input ${type === "email" ? 'type="email"' : type === "file" ? 'type="file"' : ""} name="${name}" /></label>`;

describe("browser adapters", () => {
  let browser: Browser;
  let page: Page;

  beforeEach(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterEach(async () => {
    await browser.close();
  });

  it("extracts, fills, advances, and submits Greenhouse-style multi-step forms", async () => {
    await page.setContent(`
      <div id="mount"></div>
      <script>
        const mount = document.getElementById("mount");
        let step = 1;
        const render = () => {
          if (step === 1) {
            mount.innerHTML = \`
              <form id="step-1">
                ${textField("First name", "first_name")}
                ${textField("Email", "email", "email")}
                ${textField("Resume", "resume", "file")}
                ${textField("Desired compensation", "salary")}
                <button type="button" id="next-step">Continue</button>
              </form>
            \`;
            document.getElementById("next-step").addEventListener("click", () => {
              step = 2;
              render();
            });
            return;
          }

          mount.innerHTML = \`
            <form id="step-2">
              ${textField("LinkedIn profile", "linkedin")}
              <button type="submit">Submit application</button>
            </form>
          \`;
          document.getElementById("step-2").addEventListener("submit", (event) => {
            event.preventDefault();
            document.body.innerHTML = "<p>Thank you for applying</p>";
          });
        };
        render();
      </script>
    `);

    const adapter = new GreenhouseAdapter();
    const mapper = new FieldMapperService();

    const firstStepFields = await adapter.extractFields(page);
    const firstStepPlan = await mapper.buildPlan(firstStepFields, profile, []);
    const firstResult = await adapter.fill(page, firstStepPlan, firstStepFields, 0);

    expect(firstResult.state).toBe("advanced");
    expect(firstResult.newFields?.some((field) => field.label.includes("LinkedIn"))).toBe(true);

    const secondStepPlan = await mapper.extendPlan({
      currentPlan: firstStepPlan,
      existingFields: firstStepFields,
      newFields: firstResult.newFields ?? [],
      profile,
      answerLibrary: []
    });
    const secondResult = await adapter.fill(
      page,
      secondStepPlan,
      firstResult.newFields ?? [],
      firstResult.nextDecisionIndex
    );

    expect(secondResult.state).toBe("completed");

    const submitResult = await adapter.submit(page);
    expect(submitResult.confirmed).toBe(true);
  });

  it("stops Lever-style flows when a manual verification wall appears", async () => {
    await page.setContent(`
      <div id="mount"></div>
      <script>
        const mount = document.getElementById("mount");
        let step = 1;
        const render = () => {
          if (step === 1) {
            mount.innerHTML = \`
              <form id="step-1">
                ${textField("First name", "firstName")}
                ${textField("Email", "email", "email")}
                ${textField("Resume", "resume", "file")}
                <button type="button" id="continue-step">Continue</button>
              </form>
            \`;
            document.getElementById("continue-step").addEventListener("click", () => {
              step = 2;
              render();
            });
            return;
          }

          mount.innerHTML = "<p>Email verification required before you can continue.</p>";
        };
        render();
      </script>
    `);

    const adapter = new LeverAdapter();
    const mapper = new FieldMapperService();
    const fields = await adapter.extractFields(page);
    const plan = await mapper.buildPlan(fields, profile, []);
    const result = await adapter.fill(page, plan, fields, 0);

    expect(result.state).toBe("manual");
    expect(result.manualPrompt).toContain("verification");
  });

  it("chooses a Moka job detail by profile preference and pauses on login walls", async () => {
    await page.route("https://app.mokahr.com/**", async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `
          <div id="app"></div>
          <script>
            const render = () => {
              if (window.location.hash.includes("#/job/")) {
                document.body.innerHTML = '<button id="apply-button">Apply</button>';
                document.getElementById("apply-button").addEventListener("click", () => {
                  document.body.innerHTML = "<p>Please log in</p><button>SMS login</button>";
                });
                return;
              }

              document.body.innerHTML = \`
                <a href="https://app.mokahr.com/campus_apply/demo/1#/job/frontend-role">
                  Frontend Engineer
                  Shanghai
                </a>
                <a href="https://app.mokahr.com/campus_apply/demo/1#/job/ai-role">
                  AI Algorithm Engineer
                  Shanghai
                </a>
              \`;
            };

            window.addEventListener("hashchange", render);
            render();
          </script>
        `
      });
    });

    const adapter = new MokaAdapter();
    await adapter.openApply(
      page,
      {
        id: "job-1",
        sourceId: "source-1",
        fingerprint: "fingerprint-1",
        ats: "moka",
        company: "Demo",
        title: "Demo Apply Entry",
        location: "Remote / Not specified",
        applyUrl: "https://app.mokahr.com/campus_apply/demo/1#/jobs",
        metadata: {},
        sourceSeedUrl: "https://app.mokahr.com/campus_apply/demo/1#/jobs",
        status: "new",
        discoveredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      profile
    );

    expect(page.url()).toContain("#/job/ai-role");
    await expect(adapter.extractFields(page)).rejects.toThrow(/log in|登录|验证/i);
  });

  it("keeps Moka portal selection conservative when scores tie", () => {
    const choice = mokaAdapterUtils.selectPortalCandidate(
      [
        {
          href: "https://app.mokahr.com/campus_apply/demo/1#/job/a",
          text: "Algorithm Engineer Shanghai",
          title: "Algorithm Engineer",
          kind: "job_detail"
        },
        {
          href: "https://app.mokahr.com/campus_apply/demo/1#/job/b",
          text: "Algorithm Platform Engineer Shanghai",
          title: "Algorithm Platform Engineer",
          kind: "job_detail"
        }
      ],
      mokaAdapterUtils.buildPortalPreferences(
        {
          id: "job-2",
          sourceId: "source-1",
          fingerprint: "fingerprint-2",
          ats: "moka",
          company: "Demo",
          title: "Demo Apply Entry",
          location: "Remote / Not specified",
          applyUrl: "https://app.mokahr.com/campus_apply/demo/1#/jobs",
          metadata: {},
          sourceSeedUrl: "https://app.mokahr.com/campus_apply/demo/1#/jobs",
          status: "new",
          discoveredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          ...profile,
          preferences: {
            targetKeywords: ["algorithm"],
            preferredLocations: ["shanghai"],
            excludeKeywords: []
          }
        }
      )
    );

    expect(choice).toBeNull();
  });

  it("supports generic portal forms once the browser reaches a real application page", async () => {
    await page.route("https://careers.example.com/**", async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `
          <form id="portal-form">
            ${textField("First name", "first_name")}
            ${textField("Email", "email", "email")}
            ${textField("Resume", "resume", "file")}
            <button type="submit">提交申请</button>
          </form>
          <script>
            document.getElementById("portal-form").addEventListener("submit", (submitEvent) => {
              submitEvent.preventDefault();
              document.body.innerHTML = "<p>申请已提交</p>";
            });
          </script>
        `
      });
    });

    const adapter = new PortalAdapter();
    const mapper = new FieldMapperService();

    await adapter.openApply(
      page,
      {
        id: "job-portal-1",
        sourceId: "source-portal-1",
        fingerprint: "fingerprint-portal-1",
        ats: "portal",
        company: "Demo Portal",
        title: "Demo Apply Entry",
        location: "Remote / Not specified",
        applyUrl: "https://careers.example.com/campus",
        metadata: {},
        sourceSeedUrl: "https://careers.example.com/campus",
        status: "new",
        discoveredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      profile
    );

    const fields = await adapter.extractFields(page);
    const plan = await mapper.buildPlan(fields, profile, []);
    const result = await adapter.fill(page, plan, fields, 0);

    expect(result.state).toBe("completed");

    const submitResult = await adapter.submit(page);
    expect(submitResult.confirmed).toBe(true);
  });
});
