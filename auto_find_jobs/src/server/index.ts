import { ARTIFACTS_ROOT, DATABASE_PATH, SESSIONS_ROOT, ensureRuntimeDirectories, serverConfig } from "./config.js";
import { createApp } from "./app.js";

const main = async (): Promise<void> => {
  ensureRuntimeDirectories();
  const app = createApp({
    databasePath: DATABASE_PATH,
    artifactsRoot: ARTIFACTS_ROOT,
    sessionsRoot: SESSIONS_ROOT
  });

  await app.listen({
    host: serverConfig.host,
    port: serverConfig.port
  });
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
