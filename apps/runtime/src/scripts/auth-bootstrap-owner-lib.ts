import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { membershipsTable, tenantsTable, usersTable } from "../db/schema.js";
import {
  countUsers,
  defaultTenantId,
  hashPassword,
  isEmailAllowedForInteractiveAccess,
  normalizeEmail,
  recordAuditLog,
  slugifyTenantName
} from "../auth/service.js";

export interface BootstrapOwnerConfig {
  help: boolean;
  email: string;
  displayName?: string;
  tenantName?: string;
  password: string;
}

export interface BootstrapOwnerResult {
  userId: string;
  tenantId: string;
  email: string;
}

export const bootstrapOwnerUsage = `
QPilot bootstrap owner

Usage:
  pnpm --filter @qpilot/runtime run auth:bootstrap-owner -- --email <email> [options]

Options:
  --email <email>
  --display-name <name>
  --tenant-name <name>
  --help

Required env:
  AUTH_BOOTSTRAP_OWNER_PASSWORD

Rules:
  - Only works when the database has no users yet
  - Email must be included in AUTH_ALLOWED_EMAILS
  - Creates the first owner inside the default tenant
`.trim();

const normalizeText = (value?: string | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const readOption = (argv: string[], index: number, flag: string): string => {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
};

export const parseBootstrapOwnerArgs = (
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): BootstrapOwnerConfig => {
  let help = false;
  let email: string | undefined;
  let displayName: string | undefined;
  let tenantName: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    switch (current) {
      case "--":
        break;
      case "--help":
        help = true;
        break;
      case "--email":
        email = readOption(argv, index, current);
        index += 1;
        break;
      case "--display-name":
        displayName = readOption(argv, index, current);
        index += 1;
        break;
      case "--tenant-name":
        tenantName = readOption(argv, index, current);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument "${current}".`);
    }
  }

  const password = normalizeText(env.AUTH_BOOTSTRAP_OWNER_PASSWORD);
  if (help) {
    return {
      help: true,
      email: "",
      displayName,
      tenantName,
      password: password ?? ""
    };
  }

  const normalizedEmail = normalizeText(email);
  if (!normalizedEmail) {
    throw new Error("Missing required argument --email.");
  }
  if (!password) {
    throw new Error("Missing required AUTH_BOOTSTRAP_OWNER_PASSWORD environment variable.");
  }
  if (password.length < 8) {
    throw new Error("AUTH_BOOTSTRAP_OWNER_PASSWORD must be at least 8 characters.");
  }

  return {
    help: false,
    email: normalizedEmail,
    displayName: normalizeText(displayName),
    tenantName: normalizeText(tenantName),
    password
  };
};

export const bootstrapOwnerAccount = async (
  db: any,
  input: {
    email: string;
    password: string;
    displayName?: string;
    tenantName?: string;
  }
): Promise<BootstrapOwnerResult> => {
  const email = normalizeEmail(input.email);
  if (!isEmailAllowedForInteractiveAccess(email)) {
    throw new Error("Bootstrap owner email is not included in AUTH_ALLOWED_EMAILS.");
  }

  const userCount = await countUsers(db);
  if (userCount > 0) {
    throw new Error("Owner already bootstrapped. Refusing to create another initial owner.");
  }

  const now = Date.now();
  const userId = nanoid();
  const membershipId = nanoid();
  const tenantName = input.tenantName ?? "Private Workspace";
  const tenantSlug = slugifyTenantName(tenantName);

  await db
    .update(tenantsTable)
    .set({
      name: tenantName,
      slug: tenantSlug,
      updatedAt: now
    })
    .where(eq(tenantsTable.id, defaultTenantId));

  await db.insert(usersTable).values({
    id: userId,
    email,
    passwordHash: await hashPassword(input.password),
    displayName: input.displayName ?? null,
    createdAt: now,
    updatedAt: now
  });

  await db.insert(membershipsTable).values({
    id: membershipId,
    tenantId: defaultTenantId,
    userId,
    role: "owner",
    createdAt: now,
    updatedAt: now
  });

  await recordAuditLog(db, {
    tenantId: defaultTenantId,
    userId,
    action: "auth.bootstrap_owner",
    targetType: "user",
    targetId: userId,
    detail: {
      email,
      tenantName
    }
  });

  return {
    userId,
    tenantId: defaultTenantId,
    email
  };
};
