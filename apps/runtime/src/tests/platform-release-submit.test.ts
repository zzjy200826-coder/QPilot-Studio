import { describe, expect, it } from "vitest";
import {
  isVerdictSatisfied,
  parseReleaseSubmitArgs
} from "../scripts/platform-release-submit-lib.js";

describe("platform release submit", () => {
  it("parses CLI and env values into a deduplicated release payload", () => {
    const config = parseReleaseSubmitArgs(
      [
        "--project-id",
        "proj-1",
        "--gate-policy-id",
        "gate-1",
        "--build-label",
        "build-2026.04.21.1",
        "--source-run-id",
        "run-1",
        "--source-run-ids",
        "run-2, run-1\nrun-3",
        "--source-load-run-id",
        "load-1",
        "--source-load-run-ids",
        "load-2,load-1",
        "--required-verdict",
        "watch"
      ],
      {
        QPILOT_RUNTIME_BASE_URL: "http://127.0.0.1:9999",
        QPILOT_RELEASE_NAME: "nightly-candidate",
        QPILOT_RELEASE_NOTES: "created from env",
        QPILOT_API_TOKEN: "token-from-env"
      }
    );

    expect(config.runtimeBaseUrl).toBe("http://127.0.0.1:9999");
    expect(config.name).toBe("nightly-candidate");
    expect(config.sourceRunIds).toEqual(["run-1", "run-2", "run-3"]);
    expect(config.sourceLoadRunIds).toEqual(["load-1", "load-2"]);
    expect(config.requiredVerdict).toBe("watch");
    expect(config.evaluate).toBe(true);
    expect(config.notes).toBe("created from env");
    expect(config.apiToken).toBe("token-from-env");
  });

  it("lets CLI values override env fallbacks", () => {
    const config = parseReleaseSubmitArgs(
      [
        "--project-id",
        "proj-cli",
        "--gate-policy-id",
        "gate-cli",
        "--build-label",
        "build-cli",
        "--name",
        "cli-release",
        "--no-evaluate"
      ],
      {
        QPILOT_RELEASE_PROJECT_ID: "proj-env",
        QPILOT_RELEASE_GATE_POLICY_ID: "gate-env",
        QPILOT_RELEASE_BUILD_LABEL: "build-env",
        QPILOT_RELEASE_NAME: "env-release",
        QPILOT_RELEASE_EVALUATE: "true"
      }
    );

    expect(config.projectId).toBe("proj-cli");
    expect(config.gatePolicyId).toBe("gate-cli");
    expect(config.buildLabel).toBe("build-cli");
    expect(config.name).toBe("cli-release");
    expect(config.evaluate).toBe(false);
  });

  it("rejects missing required fields", () => {
    expect(() => parseReleaseSubmitArgs([], {})).toThrow(
      "Missing required release submit fields"
    );
  });

  it("compares release verdicts by gate strictness", () => {
    expect(isVerdictSatisfied("ship", "watch")).toBe(true);
    expect(isVerdictSatisfied("watch", "watch")).toBe(true);
    expect(isVerdictSatisfied("watch", "ship")).toBe(false);
    expect(isVerdictSatisfied("hold", "watch")).toBe(false);
  });
});
