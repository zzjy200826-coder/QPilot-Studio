import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  type AnswerLibraryItem,
  type ApplicationAttempt,
  type ApplicationAttemptSettings,
  type ApplicationEvent,
  type CandidateProfile,
  type DiscoveredJob,
  type FillPlan,
  type FormField,
  type JobSnapshot,
  type JobSource,
  AnswerLibraryItemSchema,
  ApplicationAttemptSchema,
  ApplicationAttemptSettingsSchema,
  ApplicationEventSchema,
  CandidateProfileSchema,
  DiscoveredJobSchema,
  FillPlanSchema,
  FormFieldSchema,
  JobSnapshotSchema,
  JobSourceSchema
} from "../domain/schemas.js";
import { discoveryUtils } from "../domain/discovery.js";

const nowIso = (): string => new Date().toISOString();

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const normalizeSearch = (value: string | undefined): string =>
  (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export class JobAssistantDatabase {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.init();
  }

  close(): void {
    this.database.close();
  }

  private init(): void {
    this.database.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS candidate_profiles (
        id TEXT PRIMARY KEY,
        profile_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS file_references (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        label TEXT NOT NULL,
        path TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS answer_library (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        question_key TEXT NOT NULL,
        answer TEXT NOT NULL,
        synonyms_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_sources (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        seed_url TEXT NOT NULL,
        kind TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_scan_at TEXT,
        last_scan_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS discovered_jobs (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        external_job_id TEXT,
        ats TEXT NOT NULL,
        company TEXT NOT NULL,
        title TEXT NOT NULL,
        location TEXT NOT NULL,
        apply_url TEXT NOT NULL,
        hosted_url TEXT,
        description TEXT,
        metadata_json TEXT NOT NULL,
        source_seed_url TEXT NOT NULL,
        posted_at TEXT,
        remote_updated_at TEXT,
        status TEXT NOT NULL,
        discovered_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_dedupe_keys (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        dedupe_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_states (
        id TEXT PRIMARY KEY,
        site_key TEXT NOT NULL UNIQUE,
        storage_path TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS application_attempts (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        job_snapshot_json TEXT NOT NULL,
        status TEXT NOT NULL,
        settings_json TEXT NOT NULL DEFAULT '{}',
        adapter_kind TEXT,
        form_fields_json TEXT NOT NULL,
        fill_plan_json TEXT,
        current_screenshot_path TEXT,
        error_message TEXT,
        manual_prompt TEXT,
        submit_gate_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT
      );

      CREATE TABLE IF NOT EXISTS application_events (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        screenshot_path TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS review_confirmations (
        id TEXT PRIMARY KEY,
        attempt_id TEXT NOT NULL,
        confirmation_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    this.ensureColumn("application_attempts", "settings_json", "TEXT NOT NULL DEFAULT '{}'");
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const columns = this.database
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;

    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    this.database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  getProfile(): CandidateProfile | null {
    const row = this.database
      .prepare("SELECT profile_json FROM candidate_profiles WHERE id = ? LIMIT 1")
      .get("default") as { profile_json?: string } | undefined;
    return row?.profile_json
      ? CandidateProfileSchema.parse(JSON.parse(row.profile_json))
      : null;
  }

  saveProfile(input: CandidateProfile): CandidateProfile {
    const profile = CandidateProfileSchema.parse({
      ...input,
      id: "default"
    });
    const timestamp = nowIso();
    const existing = this.database
      .prepare("SELECT created_at FROM candidate_profiles WHERE id = ? LIMIT 1")
      .get("default") as { created_at?: string } | undefined;

    this.database
      .prepare(
        `
          INSERT INTO candidate_profiles (id, profile_json, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            profile_json = excluded.profile_json,
            updated_at = excluded.updated_at
        `
      )
      .run("default", JSON.stringify(profile), existing?.created_at ?? timestamp, timestamp);

    this.database.prepare("DELETE FROM file_references WHERE profile_id = ?").run("default");

    const insertFileReference = this.database.prepare(
      `
        INSERT INTO file_references (id, profile_id, label, path, kind, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    );

    const fileRefs = [
      profile.files.resumePath
        ? { label: "Resume", path: profile.files.resumePath, kind: "resume" }
        : null,
      profile.files.coverLetterPath
        ? { label: "Cover Letter", path: profile.files.coverLetterPath, kind: "cover_letter" }
        : null,
      profile.files.transcriptPath
        ? { label: "Transcript", path: profile.files.transcriptPath, kind: "transcript" }
        : null,
      ...profile.files.otherFiles.map((item) => ({
        label: item.label,
        path: item.path,
        kind: "other"
      }))
    ].filter(Boolean) as Array<{ label: string; path: string; kind: string }>;

    for (const fileRef of fileRefs) {
      insertFileReference.run(
        randomUUID(),
        "default",
        fileRef.label,
        fileRef.path,
        fileRef.kind,
        timestamp,
        timestamp
      );
    }

    return profile;
  }

  listAnswers(): AnswerLibraryItem[] {
    const rows = this.database
      .prepare(
        "SELECT id, label, question_key, answer, synonyms_json, created_at, updated_at FROM answer_library ORDER BY updated_at DESC"
      )
      .all() as Array<{
      id: string;
      label: string;
      question_key: string;
      answer: string;
      synonyms_json: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) =>
      AnswerLibraryItemSchema.parse({
        id: row.id,
        label: row.label,
        questionKey: row.question_key,
        answer: row.answer,
        synonyms: parseJson<string[]>(row.synonyms_json, []),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })
    );
  }

  upsertAnswer(input: {
    id?: string;
    label: string;
    questionKey: string;
    answer: string;
    synonyms: string[];
  }): AnswerLibraryItem {
    const timestamp = nowIso();
    const id = input.id ?? randomUUID();
    const existing = this.database
      .prepare("SELECT created_at FROM answer_library WHERE id = ? LIMIT 1")
      .get(id) as { created_at?: string } | undefined;

    this.database
      .prepare(
        `
          INSERT INTO answer_library (id, label, question_key, answer, synonyms_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            label = excluded.label,
            question_key = excluded.question_key,
            answer = excluded.answer,
            synonyms_json = excluded.synonyms_json,
            updated_at = excluded.updated_at
        `
      )
      .run(
        id,
        input.label,
        input.questionKey,
        input.answer,
        JSON.stringify(input.synonyms),
        existing?.created_at ?? timestamp,
        timestamp
      );

    return AnswerLibraryItemSchema.parse({
      ...input,
      id,
      createdAt: existing?.created_at ?? timestamp,
      updatedAt: timestamp
    });
  }

  deleteAnswer(id: string): void {
    this.database.prepare("DELETE FROM answer_library WHERE id = ?").run(id);
  }

  listSources(): JobSource[] {
    const rows = this.database
      .prepare(
        "SELECT id, label, seed_url, kind, enabled, last_scan_at, last_scan_error, created_at, updated_at FROM job_sources ORDER BY created_at DESC"
      )
      .all() as Array<{
      id: string;
      label: string;
      seed_url: string;
      kind: string;
      enabled: number;
      last_scan_at?: string;
      last_scan_error?: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) =>
      JobSourceSchema.parse({
        id: row.id,
        label: row.label,
        seedUrl: row.seed_url,
        kind: row.kind,
        enabled: Boolean(row.enabled),
        lastScanAt: row.last_scan_at ?? undefined,
        lastScanError: row.last_scan_error ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })
    );
  }

  getSource(id: string): JobSource | null {
    return this.listSources().find((source) => source.id === id) ?? null;
  }

  createSource(input: Pick<JobSource, "label" | "seedUrl" | "kind">): JobSource {
    const timestamp = nowIso();
    const source = JobSourceSchema.parse({
      id: randomUUID(),
      label: input.label,
      seedUrl: input.seedUrl,
      kind: input.kind,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    this.database
      .prepare(
        `
          INSERT INTO job_sources (id, label, seed_url, kind, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        source.id,
        source.label,
        source.seedUrl,
        source.kind,
        source.enabled ? 1 : 0,
        source.createdAt,
        source.updatedAt
      );

    return source;
  }

  deleteSource(id: string): void {
    this.database.prepare("DELETE FROM job_sources WHERE id = ?").run(id);
  }

  markSourceScan(sourceId: string, errorMessage?: string): void {
    const timestamp = nowIso();
    this.database
      .prepare(
        `
          UPDATE job_sources
          SET last_scan_at = ?, last_scan_error = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(timestamp, errorMessage ?? null, timestamp, sourceId);
  }

  listJobs(filters?: { status?: string; query?: string }): DiscoveredJob[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, source_id, fingerprint, external_job_id, ats, company, title, location, apply_url, hosted_url, description,
                 metadata_json, source_seed_url, posted_at, remote_updated_at, status, discovered_at, updated_at
          FROM discovered_jobs
          ORDER BY discovered_at DESC, company ASC, title ASC
        `
      )
      .all() as Array<Record<string, string | null>>;

    const jobs = rows.map((row) =>
      DiscoveredJobSchema.parse({
        id: row.id,
        sourceId: row.source_id,
        fingerprint: row.fingerprint,
        externalJobId: row.external_job_id ?? undefined,
        ats: row.ats,
        company: row.company,
        title: row.title,
        location: row.location,
        applyUrl: row.apply_url,
        hostedUrl: row.hosted_url ?? undefined,
        description: row.description ?? undefined,
        metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
        sourceSeedUrl: row.source_seed_url,
        postedAt: row.posted_at ?? undefined,
        remoteUpdatedAt: row.remote_updated_at ?? undefined,
        status: row.status,
        discoveredAt: row.discovered_at,
        updatedAt: row.updated_at
      })
    );

    return jobs.filter((job) => {
      const statusMatch = filters?.status ? job.status === filters.status : true;
      const queryText = normalizeSearch(filters?.query);
      if (!statusMatch) {
        return false;
      }
      if (!queryText) {
        return true;
      }
      const haystack = normalizeSearch(
        `${job.company} ${job.title} ${job.location} ${job.description ?? ""}`
      );
      return haystack.includes(queryText);
    });
  }

  getJob(jobId: string): DiscoveredJob | null {
    return this.listJobs().find((job) => job.id === jobId) ?? null;
  }

  upsertJobs(jobs: DiscoveredJob[]): DiscoveredJob[] {
    const selectExisting = this.database.prepare(
      "SELECT id, status, discovered_at FROM discovered_jobs WHERE fingerprint = ? LIMIT 1"
    );
    const upsertJob = this.database.prepare(
      `
        INSERT INTO discovered_jobs (
          id, source_id, fingerprint, external_job_id, ats, company, title, location, apply_url,
          hosted_url, description, metadata_json, source_seed_url, posted_at, remote_updated_at,
          status, discovered_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fingerprint) DO UPDATE SET
          source_id = excluded.source_id,
          external_job_id = excluded.external_job_id,
          ats = excluded.ats,
          company = excluded.company,
          title = excluded.title,
          location = excluded.location,
          apply_url = excluded.apply_url,
          hosted_url = excluded.hosted_url,
          description = excluded.description,
          metadata_json = excluded.metadata_json,
          source_seed_url = excluded.source_seed_url,
          posted_at = excluded.posted_at,
          remote_updated_at = excluded.remote_updated_at,
          updated_at = excluded.updated_at
      `
    );
    const upsertKey = this.database.prepare(
      `
        INSERT OR IGNORE INTO job_dedupe_keys (id, job_id, dedupe_key, created_at)
        VALUES (?, ?, ?, ?)
      `
    );

    const saved: DiscoveredJob[] = [];
    for (const job of jobs) {
      const existing = selectExisting.get(job.fingerprint) as
        | { id: string; status: string; discovered_at: string }
        | undefined;

      const nextJob = DiscoveredJobSchema.parse({
        ...job,
        id: existing?.id ?? job.id,
        status: existing?.status ?? job.status,
        discoveredAt: existing?.discovered_at ?? job.discoveredAt
      });

      upsertJob.run(
        nextJob.id,
        nextJob.sourceId,
        nextJob.fingerprint,
        nextJob.externalJobId ?? null,
        nextJob.ats,
        nextJob.company,
        nextJob.title,
        nextJob.location,
        nextJob.applyUrl,
        nextJob.hostedUrl ?? null,
        nextJob.description ?? null,
        JSON.stringify(nextJob.metadata),
        nextJob.sourceSeedUrl,
        nextJob.postedAt ?? null,
        nextJob.remoteUpdatedAt ?? null,
        nextJob.status,
        nextJob.discoveredAt,
        nextJob.updatedAt
      );

      upsertKey.run(randomUUID(), nextJob.id, nextJob.fingerprint, nextJob.discoveredAt);
      saved.push(nextJob);
    }

    return saved;
  }

  pruneSourceJobs(sourceId: string, keepFingerprints: string[]): number {
    const staleRows = (
      keepFingerprints.length > 0
        ? this.database
            .prepare(
              `
                SELECT id
                FROM discovered_jobs
                WHERE source_id = ?
                  AND fingerprint NOT IN (${keepFingerprints.map(() => "?").join(", ")})
                  AND NOT EXISTS (
                    SELECT 1
                    FROM application_attempts
                    WHERE application_attempts.job_id = discovered_jobs.id
                  )
              `
            )
            .all(sourceId, ...keepFingerprints)
        : this.database
            .prepare(
              `
                SELECT id
                FROM discovered_jobs
                WHERE source_id = ?
                  AND NOT EXISTS (
                    SELECT 1
                    FROM application_attempts
                    WHERE application_attempts.job_id = discovered_jobs.id
                  )
              `
            )
            .all(sourceId)
    ) as Array<{ id: string }>;

    if (staleRows.length === 0) {
      return 0;
    }

    const deleteJobDedupeKeys = this.database.prepare(
      "DELETE FROM job_dedupe_keys WHERE job_id = ?"
    );
    const deleteJob = this.database.prepare("DELETE FROM discovered_jobs WHERE id = ?");

    for (const row of staleRows) {
      deleteJobDedupeKeys.run(row.id);
      deleteJob.run(row.id);
    }

    return staleRows.length;
  }

  updateJobStatus(jobId: string, status: DiscoveredJob["status"]): void {
    this.database
      .prepare("UPDATE discovered_jobs SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, nowIso(), jobId);
  }

  createDirectJob(input: {
    ats: "greenhouse" | "lever" | "moka" | "portal";
    applyUrl: string;
    title: string;
    company: string;
    location?: string;
  }): DiscoveredJob {
    const timestamp = nowIso();
    const fingerprint = discoveryUtils.buildFingerprint({
      company: input.company,
      title: input.title,
      location: input.location ?? "远程 / 未注明",
      applyUrl: input.applyUrl
    });
    const existing = this.database
      .prepare("SELECT id, status, discovered_at FROM discovered_jobs WHERE fingerprint = ? LIMIT 1")
      .get(fingerprint) as { id: string; status: string; discovered_at: string } | undefined;

    const job = DiscoveredJobSchema.parse({
      id: existing?.id ?? randomUUID(),
      sourceId: `direct-${input.ats}`,
      fingerprint,
      ats: input.ats,
      company: input.company,
      title: input.title,
      location: input.location ?? "远程 / 未注明",
      applyUrl: input.applyUrl,
      hostedUrl: input.applyUrl,
      metadata: {
        origin: "direct_url"
      },
      sourceSeedUrl: input.applyUrl,
      status: existing?.status ?? "new",
      discoveredAt: existing?.discovered_at ?? timestamp,
      updatedAt: timestamp
    });

    this.upsertJobs([job]);
    return this.getJob(job.id) ?? job;
  }

  createAttempt(
    jobSnapshot: JobSnapshot,
    settings?: Partial<ApplicationAttemptSettings>
  ): ApplicationAttempt {
    const timestamp = nowIso();
    const attempt = ApplicationAttemptSchema.parse({
      id: randomUUID(),
      jobId: jobSnapshot.jobId,
      jobSnapshot,
      status: "queued",
      settings,
      formFields: [],
      createdAt: timestamp,
      updatedAt: timestamp
    });

    this.database
      .prepare(
        `
          INSERT INTO application_attempts (
            id, job_id, job_snapshot_json, status, settings_json, form_fields_json, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        attempt.id,
        attempt.jobId,
        JSON.stringify(attempt.jobSnapshot),
        attempt.status,
        JSON.stringify(attempt.settings),
        "[]",
        attempt.createdAt,
        attempt.updatedAt
      );

    return attempt;
  }

  listAttempts(statuses?: string[]): ApplicationAttempt[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, job_id, job_snapshot_json, status, adapter_kind, form_fields_json, fill_plan_json,
                 settings_json,
                 current_screenshot_path, error_message, manual_prompt, submit_gate_message,
                 created_at, updated_at, started_at, ended_at
          FROM application_attempts
          ORDER BY created_at DESC
        `
      )
      .all() as Array<Record<string, string | null>>;

    const attempts = rows.map((row) => this.parseAttemptRow(row));
    return statuses?.length
      ? attempts.filter((attempt) => statuses.includes(attempt.status))
      : attempts;
  }

  getAttempt(id: string): ApplicationAttempt | null {
    return this.listAttempts().find((attempt) => attempt.id === id) ?? null;
  }

  updateAttempt(
    attemptId: string,
    patch: Partial<{
      status: ApplicationAttempt["status"];
      settings: ApplicationAttemptSettings;
      adapterKind: ApplicationAttempt["adapterKind"];
      formFields: FormField[];
      fillPlan: FillPlan;
      currentScreenshotPath: string | null;
      errorMessage: string | null;
      manualPrompt: string | null;
      submitGateMessage: string | null;
      startedAt: string | null;
      endedAt: string | null;
    }>
  ): ApplicationAttempt {
    const existing = this.getAttempt(attemptId);
    if (!existing) {
      throw new Error(`未找到尝试 ${attemptId}。`);
    }

    const nextAttempt = ApplicationAttemptSchema.parse({
      ...existing,
      status: patch.status ?? existing.status,
      settings: patch.settings ?? existing.settings,
      adapterKind: patch.adapterKind ?? existing.adapterKind,
      formFields: patch.formFields ?? existing.formFields,
      fillPlan: patch.fillPlan ?? existing.fillPlan,
      currentScreenshotPath:
        patch.currentScreenshotPath === undefined
          ? existing.currentScreenshotPath
          : patch.currentScreenshotPath ?? undefined,
      errorMessage:
        patch.errorMessage === undefined ? existing.errorMessage : patch.errorMessage ?? undefined,
      manualPrompt:
        patch.manualPrompt === undefined ? existing.manualPrompt : patch.manualPrompt ?? undefined,
      submitGateMessage:
        patch.submitGateMessage === undefined
          ? existing.submitGateMessage
          : patch.submitGateMessage ?? undefined,
      startedAt:
        patch.startedAt === undefined ? existing.startedAt : patch.startedAt ?? undefined,
      endedAt: patch.endedAt === undefined ? existing.endedAt : patch.endedAt ?? undefined,
      updatedAt: nowIso()
    });

    this.database
      .prepare(
        `
          UPDATE application_attempts
          SET status = ?,
              settings_json = ?,
              adapter_kind = ?,
              form_fields_json = ?,
              fill_plan_json = ?,
              current_screenshot_path = ?,
              error_message = ?,
              manual_prompt = ?,
              submit_gate_message = ?,
              started_at = ?,
              ended_at = ?,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        nextAttempt.status,
        JSON.stringify(nextAttempt.settings),
        nextAttempt.adapterKind ?? null,
        JSON.stringify(nextAttempt.formFields),
        nextAttempt.fillPlan ? JSON.stringify(nextAttempt.fillPlan) : null,
        nextAttempt.currentScreenshotPath ?? null,
        nextAttempt.errorMessage ?? null,
        nextAttempt.manualPrompt ?? null,
        nextAttempt.submitGateMessage ?? null,
        nextAttempt.startedAt ?? null,
        nextAttempt.endedAt ?? null,
        nextAttempt.updatedAt,
        attemptId
      );

    return nextAttempt;
  }

  addEvent(
    attemptId: string,
    type: ApplicationEvent["type"],
    message: string,
    payload: Record<string, unknown> = {},
    screenshotPath?: string
  ): ApplicationEvent {
    const event = ApplicationEventSchema.parse({
      id: randomUUID(),
      attemptId,
      type,
      message,
      payload,
      screenshotPath,
      createdAt: nowIso()
    });

    this.database
      .prepare(
        `
          INSERT INTO application_events (id, attempt_id, type, message, payload_json, screenshot_path, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        event.id,
        event.attemptId,
        event.type,
        event.message,
        JSON.stringify(event.payload),
        event.screenshotPath ?? null,
        event.createdAt
      );

    return event;
  }

  listEvents(attemptId: string): ApplicationEvent[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, attempt_id, type, message, payload_json, screenshot_path, created_at
          FROM application_events
          WHERE attempt_id = ?
          ORDER BY created_at ASC
        `
      )
      .all(attemptId) as Array<Record<string, string | null>>;

    return rows.map((row) =>
      ApplicationEventSchema.parse({
        id: row.id,
        attemptId: row.attempt_id,
        type: row.type,
        message: row.message,
        payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
        screenshotPath: row.screenshot_path ?? undefined,
        createdAt: row.created_at
      })
    );
  }

  addReviewConfirmation(
    attemptId: string,
    confirmationType: string,
    payload: Record<string, unknown>
  ): void {
    this.database
      .prepare(
        `
          INSERT INTO review_confirmations (id, attempt_id, confirmation_type, payload_json, created_at)
          VALUES (?, ?, ?, ?, ?)
        `
      )
      .run(randomUUID(), attemptId, confirmationType, JSON.stringify(payload), nowIso());
  }

  getSessionState(siteKey: string): string | null {
    const row = this.database
      .prepare("SELECT storage_path FROM session_states WHERE site_key = ? LIMIT 1")
      .get(siteKey) as { storage_path?: string } | undefined;
    return row?.storage_path ?? null;
  }

  upsertSessionState(siteKey: string, storagePath: string): void {
    const timestamp = nowIso();
    this.database
      .prepare(
        `
          INSERT INTO session_states (id, site_key, storage_path, last_used_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(site_key) DO UPDATE SET
            storage_path = excluded.storage_path,
            last_used_at = excluded.last_used_at,
            updated_at = excluded.updated_at
        `
      )
      .run(randomUUID(), siteKey, storagePath, timestamp, timestamp, timestamp);
  }

  private parseAttemptRow(row: Record<string, string | null>): ApplicationAttempt {
    return ApplicationAttemptSchema.parse({
      id: row.id,
      jobId: row.job_id,
      jobSnapshot: JobSnapshotSchema.parse(parseJson<JobSnapshot>(row.job_snapshot_json, {} as JobSnapshot)),
      status: row.status,
      settings: ApplicationAttemptSettingsSchema.parse(
        parseJson<ApplicationAttemptSettings>(row.settings_json, {
          origin: "discovered",
          submissionMode: "submit_enabled",
          automationMode: "manual",
          manualInterventionOccurred: false
        })
      ),
      adapterKind: row.adapter_kind ?? undefined,
      formFields: parseJson<FormField[]>(row.form_fields_json, []).map((field) =>
        FormFieldSchema.parse(field)
      ),
      fillPlan: row.fill_plan_json
        ? FillPlanSchema.parse(parseJson<FillPlan>(row.fill_plan_json, {} as FillPlan))
        : undefined,
      currentScreenshotPath: row.current_screenshot_path ?? undefined,
      errorMessage: row.error_message ?? undefined,
      manualPrompt: row.manual_prompt ?? undefined,
      submitGateMessage: row.submit_gate_message ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at ?? undefined,
      endedAt: row.ended_at ?? undefined
    });
  }
}
