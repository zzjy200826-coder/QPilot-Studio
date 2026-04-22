import { env, RUNTIME_ROOT } from "../config/env.js";
import { createDatabase, resolveDatabasePath } from "../db/client.js";
import { migrateDatabase } from "../db/migrate.js";
import {
  bootstrapOwnerAccount,
  bootstrapOwnerUsage,
  parseBootstrapOwnerArgs
} from "./auth-bootstrap-owner-lib.js";

const main = async () => {
  const config = parseBootstrapOwnerArgs(process.argv.slice(2));
  if (config.help) {
    console.log(bootstrapOwnerUsage);
    return;
  }

  await migrateDatabase();
  const databasePath = resolveDatabasePath(env.DATABASE_URL, RUNTIME_ROOT);
  const { client, db } = await createDatabase(databasePath);

  try {
    const result = await bootstrapOwnerAccount(db, {
      email: config.email,
      password: config.password,
      displayName: config.displayName,
      tenantName: config.tenantName
    });

    console.log(
      `Bootstrap owner created for ${result.email} in tenant ${result.tenantId}.`
    );
  } finally {
    client.close();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
