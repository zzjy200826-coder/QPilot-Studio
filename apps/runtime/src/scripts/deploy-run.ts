import { runDeployCli } from "../platform/deploy-center.js";

runDeployCli().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
