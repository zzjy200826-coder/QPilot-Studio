import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  ReleaseCandidateSchema,
  ReleaseGateDetailSchema,
  type LoadRunVerdict
} from "@qpilot/shared";
import {
  isVerdictSatisfied,
  parseReleaseSubmitArgs,
  releaseSubmitUsage
} from "./platform-release-submit-lib.js";

interface ReleaseSubmitSummary {
  runtimeBaseUrl: string;
  release: ReturnType<typeof ReleaseCandidateSchema.parse>;
  gate?: {
    verdict: LoadRunVerdict;
    summary: string;
    blockers: string[];
    evaluatedAt: string;
  };
  requiredVerdict: LoadRunVerdict;
  satisfiedRequiredVerdict: boolean;
}

const requestJson = async <T>(
  runtimeBaseUrl: string,
  path: string,
  init?: RequestInit
): Promise<T> => {
  const response = await fetch(new URL(path, runtimeBaseUrl), init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} ${path}: ${body || response.statusText}`);
  }
  return (await response.json()) as T;
};

const buildAuthHeaders = (
  apiToken?: string,
  headers?: HeadersInit
): HeadersInit => {
  const normalized = new Headers(headers);
  if (apiToken) {
    normalized.set("Authorization", `Bearer ${apiToken}`);
  }
  return normalized;
};

const main = async (): Promise<void> => {
  const config = parseReleaseSubmitArgs(process.argv.slice(2));

  if (config.help) {
    console.log(releaseSubmitUsage);
    return;
  }

  const releasePayload = {
    projectId: config.projectId,
    environmentId: config.environmentId,
    gatePolicyId: config.gatePolicyId,
    name: config.name,
    buildLabel: config.buildLabel,
    buildId: config.buildId,
    commitSha: config.commitSha,
    sourceRunIds: config.sourceRunIds,
    sourceLoadRunIds: config.sourceLoadRunIds,
    notes: config.notes
  };

  const release = ReleaseCandidateSchema.parse(
    await requestJson(
      config.runtimeBaseUrl,
      "/api/platform/releases",
      {
        method: "POST",
        headers: buildAuthHeaders(config.apiToken, {
          "Content-Type": "application/json"
        }),
        body: JSON.stringify(releasePayload)
      }
    )
  );

  const detail = config.evaluate
    ? ReleaseGateDetailSchema.parse(
        await requestJson(
          config.runtimeBaseUrl,
          `/api/platform/releases/${release.id}/gates`,
          {
            headers: buildAuthHeaders(config.apiToken)
          }
        )
      )
    : undefined;

  const satisfiedRequiredVerdict = detail
    ? isVerdictSatisfied(detail.result.verdict, config.requiredVerdict)
    : true;

  const summary: ReleaseSubmitSummary = {
    runtimeBaseUrl: config.runtimeBaseUrl,
    release,
    gate: detail
      ? {
          verdict: detail.result.verdict,
          summary: detail.result.summary,
          blockers: detail.result.blockers,
          evaluatedAt: detail.result.evaluatedAt
        }
      : undefined,
    requiredVerdict: config.requiredVerdict,
    satisfiedRequiredVerdict
  };

  const serialized = JSON.stringify(summary, null, 2);
  console.log(serialized);

  if (config.outputFile) {
    const outputPath = resolve(config.outputFile);
    mkdirSync(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, "utf8");
  }

  if (!satisfiedRequiredVerdict) {
    process.exitCode = 2;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
