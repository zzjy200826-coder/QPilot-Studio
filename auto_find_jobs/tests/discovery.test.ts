import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { discoveryUtils } from "../src/domain/discovery.js";

describe("discovery utilities", () => {
  it("derives stable ATS identifiers from source URLs", () => {
    expect(
      discoveryUtils.deriveGreenhouseToken("https://boards.greenhouse.io/examplecompany")
    ).toBe("examplecompany");
    expect(discoveryUtils.deriveLeverSite("https://jobs.lever.co/examplecompany")).toBe(
      "examplecompany"
    );
    expect(
      discoveryUtils.detectSourceKind(
        "https://my.feishu.cn/sheets/NL3es2eOmhHUjUtLC63cSxRRn7b?sheet=2d5134"
      )
    ).toBe("feishu_sheet");
  });

  it("extracts JobPosting structured data from JSON-LD graphs", () => {
    const html = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  "name": "Example Co"
                },
                {
                  "@type": "JobPosting",
                  "title": "Frontend Engineer",
                  "description": "Build structured application flows",
                  "url": "https://example.com/jobs/frontend"
                }
              ]
            }
          </script>
        </head>
      </html>
    `;

    const postings = discoveryUtils.extractJobPostingNodes(html);
    expect(postings).toHaveLength(1);
    expect(postings[0]?.title).toBe("Frontend Engineer");
  });

  it("normalizes dedupe fingerprints for repeated structured jobs", () => {
    const first = discoveryUtils.buildFingerprint({
      company: "Example Co",
      title: "Frontend Engineer",
      location: "Remote",
      applyUrl: "https://example.com/jobs/frontend"
    });
    const second = discoveryUtils.buildFingerprint({
      company: " example co ",
      title: "Frontend   Engineer",
      location: "remote",
      applyUrl: "https://example.com/jobs/frontend"
    });

    expect(first).toBe(second);
  });

  it("infers whether an imported link is directly auto-apply eligible", () => {
    expect(
      discoveryUtils.inferAtsFromApplyUrl("https://boards.greenhouse.io/example/jobs/123")
    ).toBe("greenhouse");
    expect(
      discoveryUtils.inferAtsFromApplyUrl("https://jobs.lever.co/example/abc")
    ).toBe("lever");
    expect(
      discoveryUtils.inferAtsFromApplyUrl(
        "https://app.mokahr.com/campus_apply/example/96064?recommendCode=AUTO123#/jobs"
      )
    ).toBe("moka");
    expect(
      discoveryUtils.inferAtsFromApplyUrl("https://jobs.bytedance.com/campus/position")
    ).toBe("portal");
    expect(
      discoveryUtils.inferAtsFromApplyUrl("http://127.0.0.1:3000/apply/greenhouse/research-engineer")
    ).toBe("greenhouse");
  });

  it("extracts referral codes from plain text or apply URLs", () => {
    expect(discoveryUtils.extractReferralCode("code: AUTO123")).toBe("AUTO123");
    expect(
      discoveryUtils.extractReferralCode("https://jobs.example.com/campus?code=PORTAL888")
    ).toBe("PORTAL888");
  });

  it("parses Feishu snapshot blocks into structured rows", () => {
    const blockText = [
      "Company",
      "Batch",
      "Apply Link",
      "Code",
      "Acme",
      "apply:https://jobs.example.com/acme",
      "code: ACME123",
      "Bravo Labs",
      "apply:https://jobs.example.com/bravo?code=BRAVO456",
      "code: BRAVO456"
    ].join("\u0012");
    const snapshot = {
      blocks: {
        block_1: gzipSync(Buffer.from(blockText, "utf8")).toString("base64")
      }
    };

    const rows = discoveryUtils.parseFeishuSnapshotRows(snapshot);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      company: "Acme",
      applyUrl: "https://jobs.example.com/acme",
      referralCode: "ACME123"
    });
    expect(rows[1]).toMatchObject({
      company: "Bravo Labs",
      applyUrl: "https://jobs.example.com/bravo?code=BRAVO456",
      referralCode: "BRAVO456"
    });
  });

  it("ignores trailing Feishu metadata url blobs without a company row anchor", () => {
    const blockText = [
      "Company",
      "Apply Link",
      "Code",
      "Acme",
      "apply:https://jobs.example.com/acme",
      "code: ACME123",
      "Bravo Labs",
      "apply:https://jobs.example.com/bravo",
      "code: BRAVO456",
      "*https://jobs.example.com/acme",
      "7https://jobs.example.com/bravo",
      "https://jobs.example.com/metadata-only"
    ].join("\u0012");
    const snapshot = {
      blocks: {
        block_1: gzipSync(Buffer.from(blockText, "utf8")).toString("base64")
      }
    };

    const rows = discoveryUtils.parseFeishuSnapshotRows(snapshot);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.company)).toEqual(["Acme", "Bravo Labs"]);
  });
});
