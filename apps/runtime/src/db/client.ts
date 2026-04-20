import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createClient, type Client as LibsqlClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

export const resolveDatabasePath = (databaseUrl: string, runtimeRoot: string): string => {
  if (databaseUrl.startsWith("file:")) {
    return databaseUrl;
  }
  if (databaseUrl === ":memory:") {
    return "file::memory:";
  }
  const absolutePath = isAbsolute(databaseUrl)
    ? databaseUrl
    : resolve(runtimeRoot, databaseUrl);
  return `file:${absolutePath}`;
};

export const createDatabase = async (
  databaseUrl: string
): Promise<{ client: LibsqlClient; db: ReturnType<typeof drizzle> }> => {
  const pathWithoutPrefix = databaseUrl.replace(/^file:/, "");
  if (pathWithoutPrefix && !pathWithoutPrefix.startsWith(":memory:")) {
    mkdirSync(dirname(pathWithoutPrefix), { recursive: true });
  }

  const client = createClient({
    url: databaseUrl
  });
  const db = drizzle(client, { schema });
  return { client, db };
};
