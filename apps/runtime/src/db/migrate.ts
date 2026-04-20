import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createDatabase, resolveDatabasePath } from "./client.js";

const envSchema = z.object({
  DATABASE_URL: z.string().default("./data/qpilot.db")
});

export const migrateDatabase = async (): Promise<void> => {
  const env = envSchema.parse(process.env);
  const currentFile = fileURLToPath(import.meta.url);
  const runtimeRoot = resolve(dirname(currentFile), "..", "..");
  const dbPath = resolveDatabasePath(env.DATABASE_URL, runtimeRoot);
  const { client } = await createDatabase(dbPath);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      username_cipher TEXT,
      username_iv TEXT,
      username_tag TEXT,
      password_cipher TEXT,
      password_iv TEXT,
      password_tag TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      target_url TEXT NOT NULL,
      goal TEXT NOT NULL,
      model TEXT,
      config_json TEXT NOT NULL,
      startup_page_url TEXT,
      startup_page_title TEXT,
      startup_screenshot_path TEXT,
      startup_observation TEXT,
      challenge_kind TEXT,
      challenge_reason TEXT,
      recorded_video_path TEXT,
      llm_last_json TEXT,
      error_message TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      created_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS steps (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL REFERENCES runs(id),
      step_index INTEGER NOT NULL,
      page_url TEXT NOT NULL,
      page_title TEXT NOT NULL,
      dom_summary_json TEXT NOT NULL,
      screenshot_path TEXT NOT NULL,
      action_json TEXT NOT NULL,
      action_status TEXT NOT NULL,
      observation_summary TEXT NOT NULL,
      verification_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS test_cases (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL REFERENCES runs(id),
      module TEXT NOT NULL,
      title TEXT NOT NULL,
      preconditions TEXT,
      steps_json TEXT NOT NULL,
      expected TEXT,
      actual TEXT,
      status TEXT NOT NULL,
      priority TEXT,
      method TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS reports (
      run_id TEXT PRIMARY KEY NOT NULL REFERENCES runs(id),
      html_path TEXT NOT NULL,
      xlsx_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS case_templates (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      run_id TEXT NOT NULL REFERENCES runs(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      entry_url TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      case_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS load_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      scenario_label TEXT NOT NULL,
      target_base_url TEXT NOT NULL,
      environment_target_id TEXT,
      engine TEXT NOT NULL,
      pattern TEXT NOT NULL,
      request_path TEXT,
      http_method TEXT,
      headers_json TEXT,
      body_template TEXT,
      execution_mode TEXT NOT NULL DEFAULT 'local',
      worker_count INTEGER NOT NULL DEFAULT 1,
      injector_pool_id TEXT,
      arrival_model TEXT NOT NULL DEFAULT 'closed',
      phase_plan_json TEXT,
      request_mix_json TEXT,
      evidence_policy_json TEXT,
      gate_policy_id TEXT,
      tags_json TEXT,
      baseline_run_id TEXT,
      virtual_users INTEGER NOT NULL,
      duration_sec INTEGER NOT NULL,
      ramp_up_sec INTEGER NOT NULL,
      target_rps INTEGER,
      thresholds_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS load_runs (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      profile_id TEXT NOT NULL REFERENCES load_profiles(id),
      profile_name TEXT NOT NULL,
      scenario_label TEXT NOT NULL,
      target_base_url TEXT NOT NULL,
      environment_id TEXT,
      engine TEXT NOT NULL,
      pattern TEXT NOT NULL,
      environment_label TEXT NOT NULL,
      status TEXT NOT NULL,
      verdict TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'synthetic',
      metrics_json TEXT NOT NULL,
      notes TEXT,
      engine_version TEXT,
      executor_label TEXT,
      raw_summary_path TEXT,
      compare_baseline_run_id TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      created_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS load_profile_baseline_events (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL REFERENCES load_profiles(id),
      run_id TEXT NOT NULL REFERENCES load_runs(id),
      action TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS load_profile_versions (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL REFERENCES load_profiles(id),
      version_number INTEGER NOT NULL,
      reason TEXT,
      snapshot_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS load_run_workers (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL REFERENCES load_runs(id),
      worker_index INTEGER NOT NULL,
      worker_label TEXT NOT NULL,
      injector_pool_id TEXT,
      injector_worker_id TEXT,
      status TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      notes TEXT,
      engine_version TEXT,
      executor_label TEXT,
      raw_summary_path TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      created_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS load_run_sample_windows (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL REFERENCES load_runs(id),
      ts INTEGER NOT NULL,
      p95_ms INTEGER NOT NULL,
      error_rate_pct INTEGER NOT NULL,
      throughput_rps INTEGER NOT NULL,
      active_workers INTEGER NOT NULL,
      note TEXT
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS environment_targets (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT REFERENCES projects(id),
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      auth_type TEXT NOT NULL DEFAULT 'none',
      owner TEXT,
      risk_level TEXT NOT NULL DEFAULT 'medium',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS environment_service_nodes (
      id TEXT PRIMARY KEY NOT NULL,
      environment_id TEXT NOT NULL REFERENCES environment_targets(id),
      name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      base_url TEXT NOT NULL,
      health_path TEXT,
      depends_on_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS injector_pools (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      concurrency_limit INTEGER NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS injector_workers (
      id TEXT PRIMARY KEY NOT NULL,
      pool_id TEXT NOT NULL REFERENCES injector_pools(id),
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'online',
      current_run_count INTEGER NOT NULL DEFAULT 0,
      capacity INTEGER NOT NULL,
      last_heartbeat_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS gate_policies (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      required_functional_flows_json TEXT NOT NULL DEFAULT '[]',
      min_benchmark_coverage_pct INTEGER NOT NULL DEFAULT 0,
      min_benchmark_pass_rate INTEGER NOT NULL DEFAULT 0,
      required_load_profile_ids_json TEXT NOT NULL DEFAULT '[]',
      minimum_load_verdict TEXT NOT NULL DEFAULT 'watch',
      allow_waiver INTEGER NOT NULL DEFAULT 0,
      approver_roles_json TEXT NOT NULL DEFAULT '[]',
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS gate_policy_versions (
      id TEXT PRIMARY KEY NOT NULL,
      policy_id TEXT NOT NULL REFERENCES gate_policies(id),
      version_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      reason TEXT,
      snapshot_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS release_candidates (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id),
      environment_id TEXT REFERENCES environment_targets(id),
      gate_policy_id TEXT NOT NULL REFERENCES gate_policies(id),
      name TEXT NOT NULL,
      build_label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS release_gate_results (
      id TEXT PRIMARY KEY NOT NULL,
      release_id TEXT NOT NULL REFERENCES release_candidates(id),
      verdict TEXT NOT NULL,
      summary TEXT NOT NULL,
      blockers_json TEXT NOT NULL DEFAULT '[]',
      signals_json TEXT NOT NULL DEFAULT '[]',
      waiver_count INTEGER NOT NULL DEFAULT 0,
      evaluated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS waivers (
      id TEXT PRIMARY KEY NOT NULL,
      release_id TEXT NOT NULL REFERENCES release_candidates(id),
      blocker_key TEXT NOT NULL,
      reason TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      approved_by TEXT,
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS approval_events (
      id TEXT PRIMARY KEY NOT NULL,
      release_id TEXT NOT NULL REFERENCES release_candidates(id),
      waiver_id TEXT REFERENCES waivers(id),
      actor TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  const ensureColumn = async (
    tableName: string,
    columnName: string,
    columnDefinition: string
  ): Promise<void> => {
    const result = await client.execute(`PRAGMA table_info(${tableName});`);
    const columns = result.rows.map((row) => String(row.name));
    if (columns.includes(columnName)) {
      return;
    }

    await client.execute(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`
    );
  };

  await ensureColumn("runs", "startup_page_url", "TEXT");
  await ensureColumn("runs", "startup_page_title", "TEXT");
  await ensureColumn("runs", "startup_screenshot_path", "TEXT");
  await ensureColumn("runs", "startup_observation", "TEXT");
  await ensureColumn("runs", "challenge_kind", "TEXT");
  await ensureColumn("runs", "challenge_reason", "TEXT");
  await ensureColumn("runs", "recorded_video_path", "TEXT");
  await ensureColumn("load_profiles", "request_path", "TEXT");
  await ensureColumn("load_profiles", "http_method", "TEXT");
  await ensureColumn("load_profiles", "headers_json", "TEXT");
  await ensureColumn("load_profiles", "body_template", "TEXT");
  await ensureColumn("load_profiles", "environment_target_id", "TEXT");
  await ensureColumn("load_profiles", "execution_mode", "TEXT DEFAULT 'local'");
  await ensureColumn("load_profiles", "worker_count", "INTEGER DEFAULT 1");
  await ensureColumn("load_profiles", "injector_pool_id", "TEXT");
  await ensureColumn("load_profiles", "arrival_model", "TEXT DEFAULT 'closed'");
  await ensureColumn("load_profiles", "phase_plan_json", "TEXT");
  await ensureColumn("load_profiles", "request_mix_json", "TEXT");
  await ensureColumn("load_profiles", "evidence_policy_json", "TEXT");
  await ensureColumn("load_profiles", "gate_policy_id", "TEXT");
  await ensureColumn("load_profiles", "tags_json", "TEXT");
  await ensureColumn("load_profiles", "baseline_run_id", "TEXT");
  await ensureColumn("load_runs", "source", "TEXT DEFAULT 'synthetic'");
  await ensureColumn("load_runs", "engine_version", "TEXT");
  await ensureColumn("load_runs", "executor_label", "TEXT");
  await ensureColumn("load_runs", "raw_summary_path", "TEXT");
  await ensureColumn("load_runs", "environment_id", "TEXT");
  await ensureColumn("load_runs", "compare_baseline_run_id", "TEXT");

  client.close();
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrateDatabase().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
