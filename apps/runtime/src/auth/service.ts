import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  AuthMeSchema,
  ApiTokenCreateResultSchema,
  type ApiToken,
  type AuthMe,
  type Membership,
  type Tenant,
  type TenantRole,
  type TenantScope,
  type User
} from "@qpilot/shared";
import { env } from "../config/env.js";
import {
  apiTokensTable,
  auditLogsTable,
  authSessionsTable,
  membershipsTable,
  tenantsTable,
  usersTable
} from "../db/schema.js";
import {
  mapApiTokenRow,
  mapMembershipRow,
  mapTenantRow,
  mapUserRow,
  type ApiTokenRow,
  type MembershipRow,
  type TenantRow,
  type UserRow
} from "../utils/mappers.js";

const scrypt = promisify(scryptCallback);
const passwordVersion = "s1";

const roleRank: Record<TenantRole, number> = {
  viewer: 0,
  member: 1,
  owner: 2
};

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const loginFailureBuckets = new Map<string, { count: number; resetAt: number }>();

export const defaultTenantId = "tenant-default";

export interface RequestAuth {
  user: User;
  tenant: Tenant;
  membership: Membership;
  authenticatedVia: "session" | "api_token";
  tokenScopes: TenantScope[];
  sessionId?: string;
  apiToken?: ApiToken;
}

export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const allowedEmails = new Set(
  (env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean)
);

export const isSelfServiceRegistrationEnabled = (): boolean =>
  env.AUTH_SELF_SERVICE_REGISTRATION;

export const isEmailAllowedForInteractiveAccess = (email: string): boolean =>
  allowedEmails.size === 0 || allowedEmails.has(normalizeEmail(email));

const cleanupBucket = (
  buckets: Map<string, { count: number; resetAt: number }>,
  now: number
): void => {
  for (const [key, value] of buckets.entries()) {
    if (value.resetAt <= now) {
      buckets.delete(key);
    }
  }
};

const takeBucket = (
  buckets: Map<string, { count: number; resetAt: number }>,
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterMs?: number } => {
  const now = Date.now();
  cleanupBucket(buckets, now);
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterMs: Math.max(1_000, existing.resetAt - now)
    };
  }

  existing.count += 1;
  return { allowed: true };
};

const clearBucket = (
  buckets: Map<string, { count: number; resetAt: number }>,
  key: string
): void => {
  buckets.delete(key);
};

const toIso = (value: number): string => new Date(value).toISOString();

const hashOpaqueSecret = (value: string): string =>
  createHash("sha256")
    .update(`${env.AUTH_TOKEN_PEPPER}:${value}`)
    .digest("hex");

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${passwordVersion}$${salt}$${derived.toString("hex")}`;
};

export const verifyPassword = async (
  password: string,
  storedHash: string
): Promise<boolean> => {
  const [version, salt, digest] = storedHash.split("$");
  if (version !== passwordVersion || !salt || !digest) {
    return false;
  }

  const expected = Buffer.from(digest, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return timingSafeEqual(expected, actual);
};

export const slugifyTenantName = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `tenant-${nanoid(8)}`;
};

export const buildAuthMe = (auth: RequestAuth): AuthMe =>
  AuthMeSchema.parse({
    user: auth.user,
    tenant: auth.tenant,
    membership: auth.membership,
    authenticatedVia: auth.authenticatedVia
  });

export const hasMinimumRole = (
  auth: RequestAuth,
  minimumRole: TenantRole
): boolean => roleRank[auth.membership.role] >= roleRank[minimumRole];

export const hasTokenScope = (auth: RequestAuth, scope: TenantScope): boolean =>
  auth.authenticatedVia === "api_token" && auth.tokenScopes.includes(scope);

export const parseCookieHeader = (header?: string | null): Record<string, string> => {
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separatorIndex = entry.indexOf("=");
        if (separatorIndex < 0) {
          return [entry, ""];
        }
        return [
          entry.slice(0, separatorIndex),
          decodeURIComponent(entry.slice(separatorIndex + 1))
        ];
      })
  );
};

export const buildSessionCookie = (value: string, expiresAt: number): string => {
  const maxAge = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
  return [
    `${env.AUTH_SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    env.AUTH_SECURE_COOKIES ? "Secure" : ""
  ]
    .filter(Boolean)
    .join("; ");
};

export const buildClearedSessionCookie = (): string =>
  [
    `${env.AUTH_SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    env.AUTH_SECURE_COOKIES ? "Secure" : ""
  ]
    .filter(Boolean)
    .join("; ");

export const getRequestIp = (request: {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}): string | undefined => {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim();
  }
  return request.ip;
};

const loadAuthByTenantContext = async (
  db: any,
  input: {
    userId?: string | null;
    tenantId: string;
    membershipId?: string | null;
  }
): Promise<{
  user: User;
  tenant: Tenant;
  membership: Membership;
} | null> => {
  const tenantRows = (await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.id, input.tenantId))
    .limit(1)) as TenantRow[];
  const tenantRow = tenantRows[0];
  if (!tenantRow) {
    return null;
  }

  const membershipRows = (await db
    .select()
    .from(membershipsTable)
    .where(
      input.membershipId
        ? eq(membershipsTable.id, input.membershipId)
        : and(
            eq(membershipsTable.tenantId, input.tenantId),
            eq(membershipsTable.userId, input.userId ?? "")
          )
    )
    .limit(1)) as MembershipRow[];
  const membershipRow = membershipRows[0];
  if (!membershipRow) {
    return null;
  }

  const userRows = (await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, membershipRow.userId))
    .limit(1)) as UserRow[];
  const userRow = userRows[0];
  if (!userRow) {
    return null;
  }

  return {
    user: mapUserRow(userRow),
    tenant: mapTenantRow(tenantRow),
    membership: mapMembershipRow(membershipRow)
  };
};

export const findUserByEmail = async (db: any, email: string): Promise<UserRow | undefined> => {
  const rows = (await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizeEmail(email)))
    .limit(1)) as UserRow[];
  return rows[0];
};

export const countUsers = async (db: any): Promise<number> => {
  const rows = (await db.select().from(usersTable)) as UserRow[];
  return rows.length;
};

export const countTenantMemberships = async (db: any, tenantId: string): Promise<number> => {
  const rows = (await db
    .select()
    .from(membershipsTable)
    .where(eq(membershipsTable.tenantId, tenantId))) as MembershipRow[];
  return rows.length;
};

export const findTenantBySlug = async (db: any, slug: string): Promise<TenantRow | undefined> => {
  const rows = (await db
    .select()
    .from(tenantsTable)
    .where(eq(tenantsTable.slug, slug))
    .limit(1)) as TenantRow[];
  return rows[0];
};

export const createSession = async (
  db: any,
  input: {
    userId: string;
    tenantId: string;
    membershipId: string;
    userAgent?: string;
    ipAddress?: string;
  }
): Promise<{ cookieValue: string; expiresAt: number; sessionId: string }> => {
  const sessionId = nanoid();
  const secret = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + env.AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000;
  const now = Date.now();

  await db.insert(authSessionsTable).values({
    id: sessionId,
    userId: input.userId,
    tenantId: input.tenantId,
    membershipId: input.membershipId,
    secretHash: hashOpaqueSecret(secret),
    expiresAt,
    createdAt: now,
    lastSeenAt: now,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null
  });

  return {
    cookieValue: `${sessionId}.${secret}`,
    expiresAt,
    sessionId
  };
};

export const revokeSession = async (db: any, sessionId: string): Promise<void> => {
  await db.delete(authSessionsTable).where(eq(authSessionsTable.id, sessionId));
};

export const createApiToken = async (
  db: any,
  input: {
    tenantId: string;
    userId: string;
    membershipId: string;
    label: string;
    scopes: TenantScope[];
    expiresAt?: number;
  }
): Promise<ReturnType<typeof ApiTokenCreateResultSchema.parse>> => {
  const tokenId = nanoid();
  const secret = `qpt_${randomBytes(24).toString("base64url")}`;
  const createdAt = Date.now();

  await db.insert(apiTokensTable).values({
    id: tokenId,
    tenantId: input.tenantId,
    userId: input.userId,
    membershipId: input.membershipId,
    label: input.label,
    secretHash: hashOpaqueSecret(secret),
    scopesJson: JSON.stringify(input.scopes),
    lastUsedAt: null,
    expiresAt: input.expiresAt ?? null,
    createdAt
  });

  return ApiTokenCreateResultSchema.parse({
    apiToken: {
      id: tokenId,
      label: input.label,
      scopes: input.scopes,
      expiresAt: input.expiresAt ? toIso(input.expiresAt) : undefined,
      createdAt: toIso(createdAt)
    },
    plainTextToken: secret
  });
};

export const listApiTokensForTenant = async (
  db: any,
  tenantId: string
): Promise<ApiToken[]> => {
  const rows = (await db
    .select()
    .from(apiTokensTable)
    .where(eq(apiTokensTable.tenantId, tenantId))) as ApiTokenRow[];
  return rows.map(mapApiTokenRow);
};

export const resolveRequestAuth = async (
  db: any,
  request: {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
  }
): Promise<RequestAuth | null> => {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    const rawToken = authorization.slice("Bearer ".length).trim();
    if (!rawToken) {
      return null;
    }

    const tokenRows = (await db
      .select()
      .from(apiTokensTable)
      .where(eq(apiTokensTable.secretHash, hashOpaqueSecret(rawToken)))
      .limit(1)) as ApiTokenRow[];
    const tokenRow = tokenRows[0];
    if (!tokenRow) {
      return null;
    }
    if (tokenRow.expiresAt && tokenRow.expiresAt <= Date.now()) {
      return null;
    }

    await db
      .update(apiTokensTable)
      .set({
        lastUsedAt: Date.now()
      })
      .where(eq(apiTokensTable.id, tokenRow.id));

    const context = await loadAuthByTenantContext(db, {
      userId: tokenRow.userId,
      tenantId: tokenRow.tenantId,
      membershipId: tokenRow.membershipId
    });
    if (!context) {
      return null;
    }

    return {
      ...context,
      authenticatedVia: "api_token",
      tokenScopes: mapApiTokenRow(tokenRow).scopes,
      apiToken: mapApiTokenRow(tokenRow)
    };
  }

  const cookies = parseCookieHeader(typeof request.headers.cookie === "string" ? request.headers.cookie : "");
  const rawSession = cookies[env.AUTH_SESSION_COOKIE_NAME];
  if (!rawSession) {
    return null;
  }

  const [sessionId, secret] = rawSession.split(".");
  if (!sessionId || !secret) {
    return null;
  }

  const sessionRows = (await db
    .select()
    .from(authSessionsTable)
    .where(
      and(
        eq(authSessionsTable.id, sessionId),
        gt(authSessionsTable.expiresAt, Date.now())
      )
    )
    .limit(1)) as Array<{
    id: string;
    userId: string;
    tenantId: string;
    membershipId: string;
    secretHash: string;
    expiresAt: number;
  }>;
  const sessionRow = sessionRows[0];
  if (!sessionRow || sessionRow.secretHash !== hashOpaqueSecret(secret)) {
    return null;
  }

  await db
    .update(authSessionsTable)
    .set({
      lastSeenAt: Date.now(),
      ipAddress: getRequestIp(request) ?? null,
      userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null
    })
    .where(eq(authSessionsTable.id, sessionId));

  const context = await loadAuthByTenantContext(db, {
    userId: sessionRow.userId,
    tenantId: sessionRow.tenantId,
    membershipId: sessionRow.membershipId
  });
  if (!context) {
    return null;
  }

  return {
    ...context,
    authenticatedVia: "session",
    tokenScopes: [],
    sessionId
  };
};

export const recordAuditLog = async (
  db: any,
  input: {
    tenantId: string;
    userId?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    detail?: unknown;
    ipAddress?: string;
  }
): Promise<void> => {
  await db.insert(auditLogsTable).values({
    id: nanoid(),
    tenantId: input.tenantId,
    userId: input.userId ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    detailJson: input.detail === undefined ? null : JSON.stringify(input.detail),
    ipAddress: input.ipAddress ?? null,
    createdAt: Date.now()
  });
};

export const checkApiRateLimit = (
  requestKey: string
): { allowed: boolean; retryAfterMs?: number } =>
  takeBucket(
    rateLimitBuckets,
    requestKey,
    env.AUTH_API_RATE_LIMIT_PER_MINUTE,
    60_000
  );

export const checkLoginRateLimit = (
  requestKey: string
): { allowed: boolean; retryAfterMs?: number } =>
  takeBucket(
    loginFailureBuckets,
    requestKey,
    env.AUTH_LOGIN_FAILURE_LIMIT,
    env.AUTH_LOGIN_WINDOW_MS
  );

export const clearLoginRateLimit = (requestKey: string): void => {
  clearBucket(loginFailureBuckets, requestKey);
};

export const getLoginRateLimitKey = (input: {
  email: string;
  ipAddress?: string;
}): string => `${normalizeEmail(input.email)}|${input.ipAddress ?? "unknown"}`;

export const formatRetryAfterSeconds = (retryAfterMs?: number): number =>
  Math.max(1, Math.ceil((retryAfterMs ?? 1_000) / 1_000));
