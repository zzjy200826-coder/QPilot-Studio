import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { env } from "../../config/env.js";
import { projectsTable } from "../../db/schema.js";
import { encryptText } from "../../security/credentials.js";
import { mapProjectRow, type ProjectRow } from "../../utils/mappers.js";
import { resolveUtf8TextInput } from "../utf8-payload.js";
import type { AppFastify } from "../types.js";

const createProjectSchema = z.object({
  name: z.string().min(1).optional(),
  nameBase64: z.string().optional(),
  baseUrl: z.string().url(),
  username: z.string().optional(),
  usernameBase64: z.string().optional(),
  password: z.string().optional(),
  passwordBase64: z.string().optional()
});

export const registerProjectRoutes = (app: AppFastify): void => {
  app.get("/api/projects", async () => {
    const rows = (await app.appContext.db.select().from(projectsTable)) as ProjectRow[];
    return rows.map(mapProjectRow);
  });

  app.post("/api/projects", async (request, reply) => {
    const payload = createProjectSchema.parse(request.body);
    let name: string | undefined;
    let username: string | undefined;
    let password: string | undefined;
    try {
      name = resolveUtf8TextInput({
        fieldName: "name",
        value: payload.name,
        valueBase64: payload.nameBase64
      });
      username = resolveUtf8TextInput({
        fieldName: "username",
        value: payload.username,
        valueBase64: payload.usernameBase64
      });
      password = resolveUtf8TextInput({
        fieldName: "password",
        value: payload.password,
        valueBase64: payload.passwordBase64
      });
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Invalid UTF-8 payload."
      });
    }
    if (!name?.trim()) {
      return reply.status(400).send({ error: "Project name is required." });
    }
    const now = Date.now();
    const id = nanoid();
    const encryptedUsername = username
      ? encryptText(username, env.CREDENTIAL_MASTER_KEY)
      : undefined;
    const encryptedPassword = password
      ? encryptText(password, env.CREDENTIAL_MASTER_KEY)
      : undefined;

    await app.appContext.db.insert(projectsTable).values({
      id,
      name,
      baseUrl: payload.baseUrl,
      usernameCipher: encryptedUsername?.ciphertext ?? null,
      usernameIv: encryptedUsername?.iv ?? null,
      usernameTag: encryptedUsername?.tag ?? null,
      passwordCipher: encryptedPassword?.ciphertext ?? null,
      passwordIv: encryptedPassword?.iv ?? null,
      passwordTag: encryptedPassword?.tag ?? null,
      createdAt: now,
      updatedAt: now
    });

    const rows = await app.appContext.db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, id))
      .limit(1);
    const row = rows[0] as ProjectRow | undefined;
    if (!row) {
      return reply.status(500).send({ error: "Failed to create project" });
    }
    return mapProjectRow(row);
  });

  app.patch("/api/projects/:projectId/credentials", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const body = z
      .object({
        username: z.string().optional(),
        usernameBase64: z.string().optional(),
        password: z.string().optional(),
        passwordBase64: z.string().optional()
      })
      .parse(request.body);
    let username: string | undefined;
    let password: string | undefined;
    try {
      username = resolveUtf8TextInput({
        fieldName: "username",
        value: body.username,
        valueBase64: body.usernameBase64
      });
      password = resolveUtf8TextInput({
        fieldName: "password",
        value: body.password,
        valueBase64: body.passwordBase64
      });
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : "Invalid UTF-8 payload."
      });
    }

    const encryptedUsername = username
      ? encryptText(username, env.CREDENTIAL_MASTER_KEY)
      : undefined;
    const encryptedPassword = password
      ? encryptText(password, env.CREDENTIAL_MASTER_KEY)
      : undefined;

    await app.appContext.db
      .update(projectsTable)
      .set({
        usernameCipher: encryptedUsername?.ciphertext ?? null,
        usernameIv: encryptedUsername?.iv ?? null,
        usernameTag: encryptedUsername?.tag ?? null,
        passwordCipher: encryptedPassword?.ciphertext ?? null,
        passwordIv: encryptedPassword?.iv ?? null,
        passwordTag: encryptedPassword?.tag ?? null,
        updatedAt: Date.now()
      })
      .where(eq(projectsTable.id, params.projectId));

    const rows = await app.appContext.db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, params.projectId))
      .limit(1);
    const row = rows[0] as ProjectRow | undefined;
    if (!row) {
      return reply.status(404).send({ error: "Project not found" });
    }
    return mapProjectRow(row);
  });
};
