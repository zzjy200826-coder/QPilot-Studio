import type { Page } from "../../runtime/node_modules/playwright/index.mjs";
import { createClient } from "../../runtime/node_modules/@libsql/client/lib-esm/node.js";

export const defaultTenantId = "tenant-default";

const tenantTables = [
  "projects",
  "runs",
  "steps",
  "test_cases",
  "reports",
  "case_templates",
  "load_profiles",
  "load_runs",
  "load_profile_baseline_events",
  "load_profile_versions",
  "load_run_workers",
  "load_run_sample_windows",
  "environment_targets",
  "environment_service_nodes",
  "injector_pools",
  "injector_workers",
  "gate_policies",
  "gate_policy_versions",
  "release_candidates",
  "release_gate_results",
  "waivers",
  "approval_events",
  "ops_alert_events"
] as const;

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const backfillTenantIds = async (
  client: ReturnType<typeof createClient>,
  extraTables: string[] = []
): Promise<void> => {
  const tables = [...new Set([...tenantTables, ...extraTables])];

  for (const tableName of tables) {
    try {
      await client.execute({
        sql: `UPDATE ${tableName} SET tenant_id = ? WHERE tenant_id IS NULL`,
        args: [defaultTenantId]
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("no such column: tenant_id") ||
        message.includes("no such table")
      ) {
        continue;
      }
      throw error;
    }
  }
};

export const registerFixtureUser = async (
  page: Page,
  input: {
    email: string;
    password: string;
    displayName?: string;
    tenantName?: string;
    redirectPath?: string;
  }
): Promise<void> => {
  const redirectPath = input.redirectPath ?? "/projects";

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(input.email);
  await page.locator('input[name="password"]').fill(input.password);

  if (input.displayName) {
    await page.locator('input[name="displayName"]').fill(input.displayName);
  }
  if (input.tenantName) {
    await page.locator('input[name="tenantName"]').fill(input.tenantName);
  }

  await Promise.all([
    page.waitForURL(new RegExp(`${escapeRegExp(redirectPath)}(?:\\?|$)`)),
    page.locator('button[type="submit"]').click()
  ]);
};

export const createApiTokenFromPage = async (
  page: Page,
  runtimeBaseUrl: string,
  payload: {
    label: string;
    scopes: Array<"release:create" | "gate:read">;
    expiresAt?: string;
  }
): Promise<{ apiToken: { id: string; label: string; scopes: string[] }; plainTextToken: string }> => {
  const response = await page.evaluate(
    async ({ runtimeBaseUrl, payload: nextPayload }) => {
      const runtimeResponse = await fetch(`${runtimeBaseUrl}/api/auth/tokens`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(nextPayload)
      });

      return {
        status: runtimeResponse.status,
        body: await runtimeResponse.text()
      };
    },
    {
      runtimeBaseUrl,
      payload
    }
  );

  if (response.status !== 200) {
    throw new Error(`Failed to create API token: ${response.status} ${response.body}`);
  }

  return JSON.parse(response.body) as {
    apiToken: { id: string; label: string; scopes: string[] };
    plainTextToken: string;
  };
};
