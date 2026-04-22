import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildBootstrapPlan,
  buildUpdatePlan,
  buildRuntimeEnv,
  createBackupStamp,
  derivePaths,
  packagePaths,
  parseBootstrapArgs,
  parseSmokeArgs,
  parseUpdateArgs,
  renderDryRunPlan
} from "./lib.ts";

const tempRoots: string[] = [];

const createEnvSource = async (contents: string) => {
  const root = await mkdtemp(resolve(tmpdir(), "qpilot-deploy-test-"));
  tempRoots.push(root);
  const path = resolve(root, "runtime.env.source");
  await writeFile(path, contents, "utf8");
  return path;
};

afterAll(async () => {
  await Promise.all(
    tempRoots.map(async (path) => {
      const fs = await import("node:fs/promises");
      await fs.rm(path, { recursive: true, force: true });
    })
  );
});

describe("deploy CLI parsing", () => {
  it("parses bootstrap CLI flags with defaults", () => {
    const parsed = parseBootstrapArgs([
      "--host",
      "192.168.1.10",
      "--ssh-user",
      "ubuntu",
      "--domain",
      "qpilot.example.com",
      "--public-domain",
      "www.example.com",
      "--repo-url",
      "git@github.com:example/qpilot.git",
      "--cert-email",
      "ops@example.com",
      "--runtime-env-source",
      "C:/tmp/runtime.env"
    ]);

    expect(parsed.sshPort).toBe(22);
    expect(parsed.deployRoot).toBe("/opt/qpilot-studio");
    expect(parsed.ref).toBe("main");
    expect(parsed.runtimeEnvFile).toBe("/etc/qpilot/runtime.env");
    expect(parsed.publicDomain).toBe("www.example.com");
  });

  it("parses update CLI flags with optional env source", () => {
    const parsed = parseUpdateArgs([
      "--host",
      "host.internal",
      "--ssh-user",
      "ubuntu",
      "--ref",
      "release/2026.04",
      "--domain",
      "app.example.com",
      "--public-domain",
      "www.example.com"
    ]);

    expect(parsed.runtimeEnvSource).toBeUndefined();
    expect(parsed.ref).toBe("release/2026.04");
    expect(parsed.domain).toBe("app.example.com");
    expect(parsed.publicDomain).toBe("www.example.com");
  });

  it("parses smoke CLI flags", () => {
    const parsed = parseSmokeArgs([
      "--base-url",
      "https://qpilot.example.com/",
      "--public-base-url",
      "https://www.example.com/",
      "--expect-registration-closed",
      "--metrics-token",
      "secret",
      "--timeout-ms",
      "12000"
    ]);

    expect(parsed.baseUrl).toBe("https://qpilot.example.com");
    expect(parsed.publicBaseUrl).toBe("https://www.example.com");
    expect(parsed.expectRegistrationClosed).toBe(true);
    expect(parsed.metricsToken).toBe("secret");
    expect(parsed.timeoutMs).toBe(12000);
  });

  it("allows smoke CLI flags without a metrics token", () => {
    const parsed = parseSmokeArgs([
      "--base-url",
      "https://qpilot.example.com/"
    ]);

    expect(parsed.baseUrl).toBe("https://qpilot.example.com");
    expect(parsed.metricsToken).toBeUndefined();
    expect(parsed.expectRegistrationClosed).toBe(false);
  });
});

describe("deploy rendering", () => {
  it("builds a production runtime env with enforced paths", async () => {
    const envSource = await createEnvSource(`
OPENAI_API_KEY=test-key
CREDENTIAL_MASTER_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
METRICS_BEARER_TOKEN=metrics-secret
OPS_ALERTS_ENABLED=true
AUTH_ALLOWED_EMAILS=owner@example.com
`);
    const paths = derivePaths("/opt/qpilot-studio", "/etc/qpilot/runtime.env");

    const output = await buildRuntimeEnv({
      runtimeEnvSourcePath: envSource,
      domain: "qpilot.example.com",
      publicDomain: "www.example.com",
      paths
    });

    expect(output).toContain("NODE_ENV=production");
    expect(output).toContain("HOST=127.0.0.1");
    expect(output).toContain("AUTH_SELF_SERVICE_REGISTRATION=false");
    expect(output).toContain("AUTH_ALLOWED_EMAILS=owner@example.com");
    expect(output).toContain("BACKUP_SHARED_ROOT=/opt/qpilot-studio/shared");
    expect(output).toContain("BACKUP_OPS_ROOT=/opt/qpilot-studio/ops");
    expect(output).toContain("BACKUP_STALE_AFTER_HOURS=36");
    expect(output).toContain("CORS_ORIGIN=https://qpilot.example.com");
    expect(output).toContain("DATABASE_URL=/opt/qpilot-studio/shared/data/qpilot.db");
    expect(output).toContain("VITE_AUTH_SELF_SERVICE_REGISTRATION=false");
    expect(output).toContain("VITE_PRIVATE_APP_ORIGIN=https://qpilot.example.com");
    expect(output).toContain("VITE_PUBLIC_MARKETING_HOST=www.example.com");
    expect(output).toContain("VITE_RUNTIME_BASE_URL=");
    expect(output).toContain("PLATFORM_REDIS_URL=redis://127.0.0.1:6379");
  });

  it("renders bootstrap and update dry-run plans with templates and backups", async () => {
    const envSource = await createEnvSource(`
CREDENTIAL_MASTER_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
METRICS_BEARER_TOKEN=metrics-secret
AUTH_ALLOWED_EMAILS=owner@example.com
`);

    const bootstrapPlan = await buildBootstrapPlan({
      host: "203.0.113.10",
      sshUser: "ubuntu",
      sshPort: 22,
      deployRoot: "/opt/qpilot-studio",
      runtimeEnvFile: "/etc/qpilot/runtime.env",
      dryRun: true,
      domain: "qpilot.example.com",
      publicDomain: "www.example.com",
      repoUrl: "git@github.com:example/qpilot.git",
      ref: "main",
      certEmail: "ops@example.com",
      runtimeEnvSource: envSource
    });
    const updatePlan = await buildUpdatePlan({
      host: "203.0.113.10",
      sshUser: "ubuntu",
      sshPort: 22,
      deployRoot: "/opt/qpilot-studio",
      runtimeEnvFile: "/etc/qpilot/runtime.env",
      dryRun: true,
      ref: "main",
      domain: "qpilot.example.com",
      publicDomain: "www.example.com",
      runtimeEnvSource: envSource
    });

    expect(bootstrapPlan.files.map((file) => file.remoteName)).toEqual([
      "runtime.env",
      "qpilot.conf",
      "qpilot-runtime.service",
      "qpilot-backup.service",
      "qpilot-backup.timer"
    ]);
    expect(bootstrapPlan.files[1]?.contents).toContain("server_name qpilot.example.com;");
    expect(bootstrapPlan.files[1]?.contents).toContain("server_name www.example.com;");
    expect(bootstrapPlan.files[1]?.contents).toContain("location /api/ {\n        return 404;");
    expect(bootstrapPlan.files[2]?.contents).toContain(
      "ExecStart=/usr/bin/env pnpm --filter @qpilot/runtime start"
    );
    expect(bootstrapPlan.files[3]?.contents).toContain(
      "ExecStart=/usr/bin/env pnpm --filter @qpilot/runtime run backup:create -- --kind scheduled --prune"
    );
    expect(bootstrapPlan.files[4]?.contents).toContain("OnCalendar=*-*-* 03:30:00");
    expect(renderDryRunPlan(bootstrapPlan)).toContain("[remote-script]");
    expect(renderDryRunPlan(bootstrapPlan)).toContain("qpilot-backup.timer");
    expect(bootstrapPlan.remoteScript).toContain('echo "backup_timer_enabled=$(sudo systemctl is-enabled qpilot-backup.timer 2>/dev/null || true)"');
    expect(bootstrapPlan.remoteScript).toContain('echo "backup_timer_next=$(sudo systemctl show qpilot-backup.timer --property=NextElapseUSecRealtime --value 2>/dev/null || true)"');
    expect(bootstrapPlan.remoteScript).toContain('echo "backup_timer_state=intentionally_disabled"');
    expect(updatePlan.remoteScript).toContain("previous_commit.txt");
    expect(updatePlan.remoteScript).toContain('sudo install -m 644 -o root -g root "$REMOTE_STAGING/qpilot-backup.service" "$BACKUP_SYSTEMD_UNIT"');
    expect(updatePlan.remoteScript).toContain('sudo systemctl enable qpilot-backup.timer');
    expect(updatePlan.remoteScript).toContain('echo "backup_timer_enabled=$(sudo systemctl is-enabled qpilot-backup.timer 2>/dev/null || true)"');
    expect(updatePlan.remoteScript).toContain('echo "backup_timer_state=intentionally_disabled"');
    expect(updatePlan.derived.backupStamp).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it("requires the private domain when rendering a public domain update", async () => {
    await expect(
      buildUpdatePlan({
        host: "203.0.113.10",
        sshUser: "ubuntu",
        sshPort: 22,
        deployRoot: "/opt/qpilot-studio",
        runtimeEnvFile: "/etc/qpilot/runtime.env",
        dryRun: true,
        ref: "main",
        publicDomain: "www.example.com"
      })
    ).rejects.toThrow("--public-domain requires --domain");
  });

  it("keeps existing nginx config on update when no domain is provided", async () => {
    const updatePlan = await buildUpdatePlan({
      host: "203.0.113.10",
      sshUser: "ubuntu",
      sshPort: 22,
      deployRoot: "/opt/qpilot-studio",
      runtimeEnvFile: "/etc/qpilot/runtime.env",
      dryRun: true,
      ref: "main"
    });

    expect(updatePlan.files.map((file) => file.remoteName)).toEqual([
      "qpilot-runtime.service",
      "qpilot-backup.service",
      "qpilot-backup.timer"
    ]);
    expect(updatePlan.summary).toContain("Domain: reuse remote nginx config");
    expect(updatePlan.remoteScript).toContain('if [ -f "$REMOTE_STAGING/qpilot.conf" ]; then');
  });

  it("keeps deploy templates in repo assets", async () => {
    await mkdir(resolve(packagePaths.repoRoot, "infra", "nginx"), { recursive: true });
    await mkdir(resolve(packagePaths.repoRoot, "infra", "systemd"), { recursive: true });

    const nginxTemplate = await import("node:fs/promises").then((fs) =>
      fs.readFile(packagePaths.nginxTemplatePath, "utf8")
    );
    const systemdTemplate = await import("node:fs/promises").then((fs) =>
      fs.readFile(packagePaths.systemdTemplatePath, "utf8")
    );
    const backupSystemdTemplate = await import("node:fs/promises").then((fs) =>
      fs.readFile(packagePaths.backupSystemdTemplatePath, "utf8")
    );
    const backupTimerTemplate = await import("node:fs/promises").then((fs) =>
      fs.readFile(packagePaths.backupTimerTemplatePath, "utf8")
    );

    expect(nginxTemplate).toContain("server_name {{PRIVATE_DOMAIN}};");
    expect(nginxTemplate).toContain("{{PUBLIC_SERVER_BLOCK}}");
    expect(systemdTemplate).toContain("EnvironmentFile={{RUNTIME_ENV_FILE}}");
    expect(backupSystemdTemplate).toContain("ExecStart=/usr/bin/env pnpm --filter @qpilot/runtime run backup:create -- --kind scheduled --prune");
    expect(backupTimerTemplate).toContain("OnCalendar=*-*-* 03:30:00");
  });

  it("creates sortable UTC backup stamps", () => {
    expect(createBackupStamp()).toMatch(/^\d{8}T\d{6}Z$/);
  });
});
