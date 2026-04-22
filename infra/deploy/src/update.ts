import {
  buildRollbackInstructions,
  buildUpdatePlan,
  executePlan,
  formatSmokeResults,
  parseUpdateArgs,
  runSmokeChecks,
  runUpdatePrechecks
} from "./lib.ts";

const readMetricsToken = (contents?: string): string | undefined =>
  /^METRICS_BEARER_TOKEN=(.+)$/m.exec(contents ?? "")?.[1]?.trim();

const readDomain = (contents?: string): string | undefined =>
  /^CORS_ORIGIN=https:\/\/(.+)$/m.exec(contents ?? "")?.[1]?.trim();

const readPublicDomain = (contents?: string): string | undefined =>
  /^VITE_PUBLIC_MARKETING_HOST=(.+)$/m.exec(contents ?? "")?.[1]?.trim() || undefined;

const readRegistrationClosed = (contents?: string): boolean =>
  /^AUTH_SELF_SERVICE_REGISTRATION=false$/m.test(contents ?? "");

const main = async () => {
  const options = parseUpdateArgs(process.argv.slice(2));
  const plan = await buildUpdatePlan(options);

  let preflight = {
    previousCommit: "unknown",
    runtimeEnvPresent: false
  };

  if (!options.dryRun) {
    preflight = await runUpdatePrechecks(options);
  }

  try {
    await executePlan(options, plan);
  } catch (error) {
    if (!options.dryRun && plan.derived.backupStamp) {
      console.error(
        buildRollbackInstructions({
          options,
          previousCommit: preflight.previousCommit,
          backupStamp: plan.derived.backupStamp
        })
      );
    }
    throw error;
  }

  if (options.dryRun) {
    return;
  }

  const runtimeEnv = plan.files.find((file) => file.remoteName === "runtime.env")?.contents;
  const domain = options.domain ?? readDomain(runtimeEnv);
  const publicDomain = options.publicDomain ?? readPublicDomain(runtimeEnv);
  const metricsToken = readMetricsToken(runtimeEnv);

  if (!domain || !metricsToken) {
    console.log(
      "Update completed. Smoke checks were skipped because no local runtime env source was provided."
    );
    return;
  }

  const results = await runSmokeChecks({
    baseUrl: `https://${domain}`,
    publicBaseUrl: publicDomain ? `https://${publicDomain}` : undefined,
    metricsToken,
    expectRegistrationClosed: readRegistrationClosed(runtimeEnv),
    timeoutMs: 8_000
  });
  console.log(formatSmokeResults(results));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
