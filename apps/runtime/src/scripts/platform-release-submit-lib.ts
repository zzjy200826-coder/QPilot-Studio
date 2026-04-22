import type { LoadRunVerdict } from "@qpilot/shared";

export interface ReleaseSubmitConfig {
  help: boolean;
  runtimeBaseUrl: string;
  apiToken?: string;
  projectId: string;
  environmentId?: string;
  gatePolicyId: string;
  name: string;
  buildLabel: string;
  buildId?: string;
  commitSha?: string;
  sourceRunIds: string[];
  sourceLoadRunIds: string[];
  notes?: string;
  evaluate: boolean;
  requiredVerdict: LoadRunVerdict;
  outputFile?: string;
}

export const releaseSubmitUsage = `
QPilot release submit

Usage:
  pnpm release:submit -- --project-id <id> --gate-policy-id <id> --build-label <label> [options]

Options:
  --runtime-base-url <url>
  --api-token <token>
  --project-id <id>
  --environment-id <id>
  --gate-policy-id <id>
  --name <name>
  --build-label <label>
  --build-id <id>
  --commit-sha <sha>
  --source-run-id <id>            repeatable
  --source-run-ids <ids>          comma or newline separated
  --source-load-run-id <id>       repeatable
  --source-load-run-ids <ids>     comma or newline separated
  --notes <text>
  --required-verdict <hold|watch|ship>
  --output-file <path>
  --evaluate
  --no-evaluate
  --help

Env fallbacks:
  QPILOT_RUNTIME_BASE_URL
  QPILOT_API_TOKEN
  QPILOT_RELEASE_PROJECT_ID
  QPILOT_RELEASE_ENVIRONMENT_ID
  QPILOT_RELEASE_GATE_POLICY_ID
  QPILOT_RELEASE_NAME
  QPILOT_RELEASE_BUILD_LABEL
  QPILOT_RELEASE_BUILD_ID
  QPILOT_RELEASE_COMMIT_SHA
  QPILOT_RELEASE_SOURCE_RUN_IDS
  QPILOT_RELEASE_SOURCE_LOAD_RUN_IDS
  QPILOT_RELEASE_NOTES
  QPILOT_RELEASE_REQUIRED_VERDICT
  QPILOT_RELEASE_OUTPUT_FILE
  QPILOT_RELEASE_EVALUATE
`.trim();

const verdictRank: Record<LoadRunVerdict, number> = {
  hold: 0,
  watch: 1,
  ship: 2
};

const normalizeText = (value?: string | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const splitBindingIds = (value?: string | null): string[] =>
  (value ?? "")
    .split(/[\r\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const unique = (values: string[]): string[] => Array.from(new Set(values));

const normalizeVerdict = (value?: string | null): LoadRunVerdict | undefined => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }
  if (normalized === "hold" || normalized === "watch" || normalized === "ship") {
    return normalized;
  }
  throw new Error(`Unsupported verdict "${normalized}". Expected hold, watch, or ship.`);
};

const parseBoolean = (value?: string | null): boolean | undefined => {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Unsupported boolean value "${value}". Expected true/false or 1/0.`);
};

const readOption = (argv: string[], index: number, flag: string): string => {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
};

export const isVerdictSatisfied = (
  actual: LoadRunVerdict,
  required: LoadRunVerdict
): boolean => verdictRank[actual] >= verdictRank[required];

export const parseReleaseSubmitArgs = (
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): ReleaseSubmitConfig => {
  const cliValues: Record<string, string> = {};
  const sourceRunIds: string[] = [];
  const sourceLoadRunIds: string[] = [];
  let evaluateOverride: boolean | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    switch (current) {
      case "--":
        break;
      case "--help":
        help = true;
        break;
      case "--runtime-base-url":
      case "--api-token":
      case "--project-id":
      case "--environment-id":
      case "--gate-policy-id":
      case "--name":
      case "--build-label":
      case "--build-id":
      case "--commit-sha":
      case "--source-run-ids":
      case "--source-load-run-ids":
      case "--notes":
      case "--required-verdict":
      case "--output-file": {
        cliValues[current] = readOption(argv, index, current);
        index += 1;
        break;
      }
      case "--source-run-id":
        sourceRunIds.push(readOption(argv, index, current));
        index += 1;
        break;
      case "--source-load-run-id":
        sourceLoadRunIds.push(readOption(argv, index, current));
        index += 1;
        break;
      case "--evaluate":
        evaluateOverride = true;
        break;
      case "--no-evaluate":
        evaluateOverride = false;
        break;
      default:
        throw new Error(`Unknown argument "${current}".`);
    }
  }

  if (help) {
    return {
      help: true,
      runtimeBaseUrl: normalizeText(cliValues["--runtime-base-url"]) ??
        normalizeText(env.QPILOT_RUNTIME_BASE_URL) ??
        "http://127.0.0.1:8787",
      apiToken:
        normalizeText(cliValues["--api-token"]) ?? normalizeText(env.QPILOT_API_TOKEN),
      projectId: "",
      gatePolicyId: "",
      name: "",
      buildLabel: "",
      sourceRunIds: [],
      sourceLoadRunIds: [],
      evaluate: true,
      requiredVerdict: "hold"
    };
  }

  const runtimeBaseUrl =
    normalizeText(cliValues["--runtime-base-url"]) ??
    normalizeText(env.QPILOT_RUNTIME_BASE_URL) ??
    "http://127.0.0.1:8787";
  const apiToken =
    normalizeText(cliValues["--api-token"]) ?? normalizeText(env.QPILOT_API_TOKEN);
  const projectId =
    normalizeText(cliValues["--project-id"]) ??
    normalizeText(env.QPILOT_RELEASE_PROJECT_ID);
  const environmentId =
    normalizeText(cliValues["--environment-id"]) ??
    normalizeText(env.QPILOT_RELEASE_ENVIRONMENT_ID);
  const gatePolicyId =
    normalizeText(cliValues["--gate-policy-id"]) ??
    normalizeText(env.QPILOT_RELEASE_GATE_POLICY_ID);
  const buildLabel =
    normalizeText(cliValues["--build-label"]) ??
    normalizeText(env.QPILOT_RELEASE_BUILD_LABEL);
  const name =
    normalizeText(cliValues["--name"]) ??
    normalizeText(env.QPILOT_RELEASE_NAME) ??
    buildLabel;
  const buildId =
    normalizeText(cliValues["--build-id"]) ??
    normalizeText(env.QPILOT_RELEASE_BUILD_ID);
  const commitSha =
    normalizeText(cliValues["--commit-sha"]) ??
    normalizeText(env.QPILOT_RELEASE_COMMIT_SHA);
  const notes =
    normalizeText(cliValues["--notes"]) ??
    normalizeText(env.QPILOT_RELEASE_NOTES);
  const requiredVerdict =
    normalizeVerdict(cliValues["--required-verdict"]) ??
    normalizeVerdict(env.QPILOT_RELEASE_REQUIRED_VERDICT) ??
    "hold";
  const outputFile =
    normalizeText(cliValues["--output-file"]) ??
    normalizeText(env.QPILOT_RELEASE_OUTPUT_FILE);
  const evaluate =
    evaluateOverride ??
    parseBoolean(env.QPILOT_RELEASE_EVALUATE) ??
    true;
  const normalizedSourceRunIds = unique([
    ...sourceRunIds,
    ...splitBindingIds(cliValues["--source-run-ids"]),
    ...splitBindingIds(env.QPILOT_RELEASE_SOURCE_RUN_IDS)
  ]);
  const normalizedSourceLoadRunIds = unique([
    ...sourceLoadRunIds,
    ...splitBindingIds(cliValues["--source-load-run-ids"]),
    ...splitBindingIds(env.QPILOT_RELEASE_SOURCE_LOAD_RUN_IDS)
  ]);

  const missing = [
    projectId ? null : "projectId",
    gatePolicyId ? null : "gatePolicyId",
    buildLabel ? null : "buildLabel",
    name ? null : "name"
  ].filter((value): value is string => Boolean(value));

  if (missing.length > 0) {
    throw new Error(`Missing required release submit fields: ${missing.join(", ")}.`);
  }

  if (!evaluate && requiredVerdict !== "hold") {
    throw new Error("requiredVerdict can only be enforced when release evaluation is enabled.");
  }

  return {
    help: false,
    runtimeBaseUrl,
    apiToken,
    projectId: projectId!,
    environmentId,
    gatePolicyId: gatePolicyId!,
    name: name!,
    buildLabel: buildLabel!,
    buildId,
    commitSha,
    sourceRunIds: normalizedSourceRunIds,
    sourceLoadRunIds: normalizedSourceLoadRunIds,
    notes,
    evaluate,
    requiredVerdict,
    outputFile
  };
};
