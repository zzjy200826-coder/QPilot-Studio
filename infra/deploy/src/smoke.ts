import { formatSmokeResults, parseSmokeArgs, runSmokeChecks } from "./lib.ts";

const main = async () => {
  const options = parseSmokeArgs(process.argv.slice(2));
  const results = await runSmokeChecks(options);
  console.log(formatSmokeResults(results));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
