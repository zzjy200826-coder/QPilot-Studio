import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { type TenantScope } from "@qpilot/shared";
import {
  buildAuthMe,
  buildClearedSessionCookie,
  buildSessionCookie,
  checkLoginRateLimit,
  clearLoginRateLimit,
  countTenantMemberships,
  countUsers,
  createApiToken,
  createSession,
  defaultTenantId,
  findTenantBySlug,
  findUserByEmail,
  formatRetryAfterSeconds,
  getLoginRateLimitKey,
  getRequestIp,
  hashPassword,
  isEmailAllowedForInteractiveAccess,
  isSelfServiceRegistrationEnabled,
  hasMinimumRole,
  normalizeEmail,
  recordAuditLog,
  revokeSession,
  slugifyTenantName,
  verifyPassword
} from "../../auth/service.js";
import { membershipsTable, tenantsTable, usersTable } from "../../db/schema.js";
import { mapMembershipRow, mapTenantRow, mapUserRow, type MembershipRow, type TenantRow } from "../../utils/mappers.js";
import type { AppFastify } from "../types.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(160),
  displayName: z.string().trim().min(1).max(80).optional(),
  tenantName: z.string().trim().min(1).max(80).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(160)
});

const createApiTokenSchema = z.object({
  label: z.string().trim().min(1).max(80),
  scopes: z
    .array(z.enum(["release:create", "gate:read"]))
    .default(["release:create", "gate:read"]),
  expiresAt: z.string().datetime().optional()
});

const nextTenantSlug = async (app: AppFastify, preferredName: string): Promise<string> => {
  const base = slugifyTenantName(preferredName);
  let candidate = base;
  let suffix = 1;

  while (await findTenantBySlug(app.appContext.db, candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
};

const loadFirstMembershipForUser = async (
  app: AppFastify,
  userId: string
): Promise<{
  user: ReturnType<typeof mapUserRow>;
  tenant: ReturnType<typeof mapTenantRow>;
  membership: ReturnType<typeof mapMembershipRow>;
} | null> => {
  const userRows = await app.appContext.db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const userRow = userRows[0];
  if (!userRow) {
    return null;
  }

  const membershipRows = (await app.appContext.db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.userId, userId))
    .limit(1)) as MembershipRow[];
  const membershipRow = membershipRows[0];
  if (!membershipRow) {
    return null;
  }

  const tenantRows = (await app.appContext.db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, membershipRow.tenantId))
    .limit(1)) as TenantRow[];
  const tenantRow = tenantRows[0];
  if (!tenantRow) {
    return null;
  }

  return {
    user: mapUserRow(userRow),
    tenant: mapTenantRow(tenantRow),
    membership: mapMembershipRow(membershipRow)
  };
};

export const registerAuthRoutes = (app: AppFastify): void => {
  app.post("/api/auth/register", async (request, reply) => {
    const payload = registerSchema.parse(request.body);
    const email = normalizeEmail(payload.email);
    const ipAddress = getRequestIp(request);
    if (!isEmailAllowedForInteractiveAccess(email)) {
      await recordAuditLog(app.appContext.db, {
        tenantId: defaultTenantId,
        action: "auth.register.denied_allowlist",
        targetType: "user",
        detail: { email },
        ipAddress
      });
      return reply.status(403).send({
        error: "This workspace is restricted to approved accounts."
      });
    }
    if (!isSelfServiceRegistrationEnabled()) {
      await recordAuditLog(app.appContext.db, {
        tenantId: defaultTenantId,
        action: "auth.register.denied_closed",
        targetType: "user",
        detail: { email },
        ipAddress
      });
      return reply.status(403).send({
        error: "Self-service registration is disabled for this workspace. The owner must initialize access from the server."
      });
    }
    const existingUser = await findUserByEmail(app.appContext.db, email);
    if (existingUser) {
      return reply.status(409).send({ error: "An account with this email already exists." });
    }

    const now = Date.now();
    const userId = nanoid();
    const userCount = await countUsers(app.appContext.db);
    const defaultTenantMemberships = await countTenantMemberships(app.appContext.db, defaultTenantId);

    let tenantId = defaultTenantId;
    let tenantName = payload.tenantName ?? "Default Workspace";
    let tenantSlug = "default-workspace";

    if (!(userCount === 0 || defaultTenantMemberships === 0)) {
      tenantId = nanoid();
      tenantName =
        payload.tenantName ?? `${payload.displayName ?? email.split("@")[0] ?? "Team"} Workspace`;
      tenantSlug = await nextTenantSlug(app, tenantName);
      await app.appContext.db.insert(tenantsTable).values({
        id: tenantId,
        name: tenantName,
        slug: tenantSlug,
        createdAt: now,
        updatedAt: now
      });
    } else if (payload.tenantName) {
      tenantSlug = await nextTenantSlug(app, payload.tenantName);
      await app.appContext.db
        .update(tenantsTable)
        .set({
          name: payload.tenantName,
          slug: tenantSlug,
          updatedAt: now
        })
        .where(eq(tenantsTable.id, defaultTenantId));
    }

    await app.appContext.db.insert(usersTable).values({
      id: userId,
      email,
      passwordHash: await hashPassword(payload.password),
      displayName: payload.displayName ?? null,
      createdAt: now,
      updatedAt: now
    });

    const membershipId = nanoid();
    await app.appContext.db.insert(membershipsTable).values({
      id: membershipId,
      tenantId,
      userId,
      role: "owner",
      createdAt: now,
      updatedAt: now
    });

    const session = await createSession(app.appContext.db, {
      userId,
      tenantId,
      membershipId,
      ipAddress,
      userAgent: request.headers["user-agent"]
    });

    await recordAuditLog(app.appContext.db, {
      tenantId,
      userId,
      action: "auth.register",
      targetType: "user",
      targetId: userId,
      detail: { email },
      ipAddress
    });

    const authContext = await loadFirstMembershipForUser(app, userId);
    if (!authContext) {
      return reply.status(500).send({ error: "Failed to load the new account context." });
    }

    reply.header("Set-Cookie", buildSessionCookie(session.cookieValue, session.expiresAt));
    return buildAuthMe({
      ...authContext,
      authenticatedVia: "session",
      tokenScopes: [],
      sessionId: session.sessionId
    });
  });

  app.post("/api/auth/login", async (request, reply) => {
    const payload = loginSchema.parse(request.body);
    const email = normalizeEmail(payload.email);
    const ipAddress = getRequestIp(request);
    if (!isEmailAllowedForInteractiveAccess(email)) {
      await recordAuditLog(app.appContext.db, {
        tenantId: defaultTenantId,
        action: "auth.login.denied_allowlist",
        targetType: "user",
        detail: { email },
        ipAddress
      });
      return reply.status(403).send({
        error: "This workspace is restricted to approved accounts."
      });
    }
    const limiterKey = getLoginRateLimitKey({
      email,
      ipAddress
    });
    const rateLimit = checkLoginRateLimit(limiterKey);
    if (!rateLimit.allowed) {
      reply.header("Retry-After", String(formatRetryAfterSeconds(rateLimit.retryAfterMs)));
      return reply.status(429).send({
        error: "Too many failed login attempts. Please try again later."
      });
    }

    const userRow = await findUserByEmail(app.appContext.db, email);
    if (!userRow || !(await verifyPassword(payload.password, userRow.passwordHash))) {
      return reply.status(401).send({ error: "Incorrect email or password." });
    }

    const authContext = await loadFirstMembershipForUser(app, userRow.id);
    if (!authContext) {
      return reply.status(403).send({ error: "No tenant membership is configured for this account." });
    }

    clearLoginRateLimit(limiterKey);
    const session = await createSession(app.appContext.db, {
      userId: authContext.user.id,
      tenantId: authContext.tenant.id,
      membershipId: authContext.membership.id,
      ipAddress,
      userAgent: request.headers["user-agent"]
    });

    await recordAuditLog(app.appContext.db, {
      tenantId: authContext.tenant.id,
      userId: authContext.user.id,
      action: "auth.login",
      targetType: "user",
      targetId: authContext.user.id,
      detail: { email: authContext.user.email },
      ipAddress
    });

    reply.header("Set-Cookie", buildSessionCookie(session.cookieValue, session.expiresAt));
    return buildAuthMe({
      ...authContext,
      authenticatedVia: "session",
      tokenScopes: [],
      sessionId: session.sessionId
    });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const sessionId = request.auth?.sessionId;
    if (sessionId) {
      await revokeSession(app.appContext.db, sessionId);
    }
    if (request.auth) {
      await recordAuditLog(app.appContext.db, {
        tenantId: request.auth.tenant.id,
        userId: request.auth.user.id,
        action: "auth.logout",
        targetType: "user",
        targetId: request.auth.user.id,
        ipAddress: getRequestIp(request)
      });
    }

    reply.header("Set-Cookie", buildClearedSessionCookie());
    return { ok: true };
  });

  app.get("/api/auth/me", async (request, reply) => {
    if (!request.auth) {
      return reply.status(401).send({ error: "Authentication required." });
    }
    return buildAuthMe(request.auth);
  });

  app.post("/api/auth/tokens", async (request, reply) => {
    if (!request.auth) {
      return reply.status(401).send({ error: "Authentication required." });
    }
    if (request.auth.authenticatedVia !== "session" || !hasMinimumRole(request.auth, "owner")) {
      return reply.status(403).send({ error: "Only tenant owners can create API tokens." });
    }

    const payload = createApiTokenSchema.parse(request.body);
    const token = await createApiToken(app.appContext.db, {
      tenantId: request.auth.tenant.id,
      userId: request.auth.user.id,
      membershipId: request.auth.membership.id,
      label: payload.label,
      scopes: payload.scopes as TenantScope[],
      expiresAt: payload.expiresAt ? Date.parse(payload.expiresAt) : undefined
    });

    await recordAuditLog(app.appContext.db, {
      tenantId: request.auth.tenant.id,
      userId: request.auth.user.id,
      action: "auth.api_token.create",
      targetType: "api_token",
      targetId: token.apiToken.id,
      detail: {
        label: token.apiToken.label,
        scopes: token.apiToken.scopes
      },
      ipAddress: getRequestIp(request)
    });

    return token;
  });
};
