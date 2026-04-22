import { runBackupPruneCli } from "../platform/backups.js";

runBackupPruneCli().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
