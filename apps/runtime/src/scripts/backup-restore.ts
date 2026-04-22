import { runBackupRestoreCli } from "../platform/backups.js";

runBackupRestoreCli(process.argv.slice(2)).catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
