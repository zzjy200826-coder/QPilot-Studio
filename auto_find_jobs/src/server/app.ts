import { readFile } from "node:fs/promises";
import { join } from "node:path";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { CLIENT_DIST_ROOT, hasClientBuild, serverConfig } from "./config.js";
import { JobAssistantDatabase } from "./db.js";
import { ApplicationEventHub } from "./events.js";
import { registerAnswerRoutes } from "./routes/answers.js";
import { registerApplicationRoutes } from "./routes/applications.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerSourceRoutes } from "./routes/sources.js";
import { JobAssistantRuntime } from "./services/runtime.js";

export const createApp = (options: {
  databasePath: string;
  artifactsRoot: string;
  sessionsRoot: string;
}): FastifyInstance => {
  const app = Fastify({
    logger: true
  });

  const db = new JobAssistantDatabase(options.databasePath);
  const eventHub = new ApplicationEventHub();
  const runtime = new JobAssistantRuntime(
    db,
    eventHub,
    {
      artifactsRoot: options.artifactsRoot,
      sessionsRoot: options.sessionsRoot
    },
    {
      ai:
        serverConfig.llmConfigured && serverConfig.openAiApiKey
          ? {
              baseURL: serverConfig.openAiBaseUrl,
              apiKey: serverConfig.openAiApiKey,
              model: serverConfig.openAiModel,
              timeoutMs: serverConfig.openAiTimeoutMs
            }
          : undefined,
      discovery: {
        greenhouseApiBase: serverConfig.greenhouseApiBase,
        leverApiBase: serverConfig.leverApiBase
      },
      browser: {
        headless: serverConfig.playwrightHeadless
      }
    }
  );

  const isLoopbackOrigin = (origin: string): boolean => {
    try {
      const url = new URL(origin);
      return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
    } catch {
      return false;
    }
  };

  void app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || origin === serverConfig.clientOrigin || isLoopbackOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed"), false);
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const normalizedError = error instanceof Error ? error : new Error("服务器内部错误。");

    if (error instanceof ZodError) {
      return reply.status(400).send({
        message: error.issues[0]?.message ?? "请求参数无效。",
        issues: error.issues
      });
    }

    const statusCode =
      typeof (error as { statusCode?: number }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;
    const payload: Record<string, unknown> = {
      message: normalizedError.message || "服务器内部错误。"
    };

    if ("code" in normalizedError && typeof normalizedError.code === "string") {
      payload.code = normalizedError.code;
    }
    if ("existingAttempt" in normalizedError) {
      payload.existingAttempt = (normalizedError as { existingAttempt?: unknown }).existingAttempt;
    }

    return reply.status(statusCode).send(payload);
  });

  void app.register(staticPlugin, {
    root: options.artifactsRoot,
    prefix: "/artifacts/"
  });

  registerProfileRoutes(app, runtime);
  registerAnswerRoutes(app, runtime);
  registerSourceRoutes(app, runtime);
  registerJobRoutes(app, runtime);
  registerApplicationRoutes(app, runtime, eventHub);

  app.get("/api/health", async () => runtime.getHealth());

  app.addHook("onClose", async () => {
    db.close();
  });

  if (hasClientBuild()) {
    void app.register(staticPlugin, {
      root: CLIENT_DIST_ROOT,
      prefix: "/",
      decorateReply: false,
      wildcard: false
    });

    app.get("/*", async (_request, reply) => {
      const html = await readFile(join(CLIENT_DIST_ROOT, "index.html"), "utf8");
      reply.type("text/html").send(html);
    });
  }

  return app;
};
