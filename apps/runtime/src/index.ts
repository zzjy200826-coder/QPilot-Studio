import { env } from "./config/env.js";
import { createServer } from "./server.js";

const bootstrap = async (): Promise<void> => {
  const app = await createServer();
  await app.listen({
    host: env.HOST,
    port: env.PORT
  });
  app.log.info(`QPilot runtime listening at http://${env.HOST}:${env.PORT}`);
};

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
