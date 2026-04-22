import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { constants } from "node:fs";
import { requireAuth } from "../../auth/guards.js";
import { getTenantRunRow } from "../../auth/tenant-access.js";
import type { AppFastify } from "../types.js";

const mimeTypeByExtension: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

const normalizeRelativePath = (value: string): string =>
  value.replace(/^[/\\]+/, "").replace(/\\/g, "/");

const resolveRunIdFromPath = (relativePath: string): string | undefined => {
  const parts = normalizeRelativePath(relativePath).split("/");
  if (parts[0] !== "runs") {
    return undefined;
  }
  return parts[1];
};

const isWithinRoot = (root: string, candidate: string): boolean => {
  const normalizedRoot = `${root.replace(/\\/g, "/").replace(/\/+$/, "")}/`;
  const normalizedCandidate = candidate.replace(/\\/g, "/");
  return normalizedCandidate.startsWith(normalizedRoot);
};

const serveProtectedPath = async (
  app: AppFastify,
  input: {
    tenantId: string;
    root: string;
    relativePath: string;
  }
): Promise<{ absolutePath: string; mimeType: string } | null> => {
  const normalized = normalizeRelativePath(input.relativePath);
  const runId = resolveRunIdFromPath(normalized);
  if (!runId) {
    return null;
  }

  const runRow = await getTenantRunRow(app.appContext.db, input.tenantId, runId);
  if (!runRow) {
    return null;
  }

  const absolutePath = resolve(input.root, normalized);
  if (!isWithinRoot(input.root, absolutePath)) {
    return null;
  }

  try {
    await access(absolutePath, constants.R_OK);
  } catch {
    return null;
  }

  return {
    absolutePath,
    mimeType: mimeTypeByExtension[extname(absolutePath).toLowerCase()] ?? "application/octet-stream"
  };
};

export const registerFileRoutes = (
  app: AppFastify,
  input: {
    artifactsRoot: string;
    reportsRoot: string;
  }
): void => {
  app.get("/artifacts/*", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }

    const params = request.params as { "*": string };
    const file = await serveProtectedPath(app, {
      tenantId: auth.tenant.id,
      root: input.artifactsRoot,
      relativePath: params["*"] ?? ""
    });
    if (!file) {
      return reply.status(404).send({ error: "Artifact not found." });
    }

    reply.header("Cache-Control", "private, max-age=60");
    reply.type(file.mimeType);
    return reply.send(createReadStream(file.absolutePath));
  });

  app.get("/reports/*", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) {
      return;
    }

    const params = request.params as { "*": string };
    const file = await serveProtectedPath(app, {
      tenantId: auth.tenant.id,
      root: input.reportsRoot,
      relativePath: params["*"] ?? ""
    });
    if (!file) {
      return reply.status(404).send({ error: "Report asset not found." });
    }

    reply.header("Cache-Control", "private, max-age=60");
    reply.type(file.mimeType);
    return reply.send(createReadStream(file.absolutePath));
  });
};
