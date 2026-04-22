import {
  buildBootstrapPlan,
  executePlan,
  formatSmokeResults,
  parseBootstrapArgs,
  runBootstrapPrechecks,
  runSmokeChecks
} from "./lib.ts";

const main = async () => {
  const options = parseBootstrapArgs(process.argv.slice(2));
  const plan = await buildBootstrapPlan(options);

  if (!options.dryRun) {
    await runBootstrapPrechecks(options);
  }

  await executePlan(options, plan);

  if (options.dryRun) {
    return;
  }

  const results = await runSmokeChecks({
    baseUrl: `https://${options.domain}`,
    publicBaseUrl: options.publicDomain ? `https://${options.publicDomain}` : undefined,
    metricsToken: /METRICS_BEARER_TOKEN=(.+)/.exec(
      plan.files.find((file) => file.remoteName === "runtime.env")?.contents ?? ""
    )?.[1] ?? "",
    expectRegistrationClosed: /^AUTH_SELF_SERVICE_REGISTRATION=false$/m.test(
      plan.files.find((file) => file.remoteName === "runtime.env")?.contents ?? ""
    ),
    timeoutMs: 8_000
  });
  console.log(formatSmokeResults(results));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
