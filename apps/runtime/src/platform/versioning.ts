import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  GatePolicy,
  GatePolicyVersion,
  GatePolicyVersionStatus,
  LoadProfile,
  LoadProfileVersion
} from "@qpilot/shared";
import { GatePolicySchema, LoadProfileSchema } from "@qpilot/shared";
import {
  gatePoliciesTable,
  gatePolicyVersionsTable,
  loadProfilesTable,
  loadProfileVersionsTable
} from "../db/schema.js";
import {
  mapGatePolicyRow,
  mapGatePolicyVersionRow,
  mapLoadProfileRow,
  mapLoadProfileVersionRow,
  type GatePolicyRow,
  type GatePolicyVersionRow,
  type LoadProfileRow,
  type LoadProfileVersionRow
} from "../utils/mappers.js";

const nextVersionNumber = async (
  db: any,
  table: typeof loadProfileVersionsTable | typeof gatePolicyVersionsTable,
  column: typeof loadProfileVersionsTable.profileId | typeof gatePolicyVersionsTable.policyId,
  entityId: string
): Promise<number> => {
  const rows = await db
    .select()
    .from(table)
    .where(eq(column as never, entityId))
    .orderBy(desc((table as typeof loadProfileVersionsTable).versionNumber))
    .limit(1);
  const lastVersion = rows[0] as { versionNumber?: number } | undefined;
  return (lastVersion?.versionNumber ?? 0) + 1;
};

const profileUpdateValues = (profile: LoadProfile, updatedAt: number) => ({
  name: profile.name,
  scenarioLabel: profile.scenarioLabel,
  targetBaseUrl: profile.targetBaseUrl,
  environmentTargetId: profile.environmentTargetId ?? null,
  engine: profile.engine,
  pattern: profile.pattern,
  requestPath: profile.requestPath ?? null,
  httpMethod: profile.httpMethod ?? null,
  headersJson: profile.headersJson ?? null,
  bodyTemplate: profile.bodyTemplate ?? null,
  executionMode: profile.executionMode,
  workerCount: profile.workerCount,
  injectorPoolId: profile.injectorPoolId ?? null,
  arrivalModel: profile.arrivalModel,
  phasePlanJson: profile.phasePlanJson ?? null,
  requestMixJson: profile.requestMixJson ?? null,
  evidencePolicyJson: profile.evidencePolicyJson ?? null,
  gatePolicyId: profile.gatePolicyId ?? null,
  tagsJson: profile.tagsJson ?? null,
  baselineRunId: profile.baselineRunId ?? null,
  virtualUsers: profile.virtualUsers,
  durationSec: profile.durationSec,
  rampUpSec: profile.rampUpSec,
  targetRps: profile.targetRps ?? null,
  thresholdsJson: JSON.stringify(profile.thresholds),
  updatedAt
});

const gatePolicyUpdateValues = (policy: GatePolicy, updatedAt: number) => ({
  name: policy.name,
  requiredFunctionalFlowsJson: JSON.stringify(policy.requiredFunctionalFlows),
  minBenchmarkCoveragePct: Math.round(policy.minBenchmarkCoveragePct),
  minBenchmarkPassRate: Math.round(policy.minBenchmarkPassRate),
  requiredLoadProfileIdsJson: JSON.stringify(policy.requiredLoadProfileIds),
  minimumLoadVerdict: policy.minimumLoadVerdict,
  allowWaiver: policy.allowWaiver ? 1 : 0,
  approverRolesJson: JSON.stringify(policy.approverRoles),
  expiresAt: policy.expiresAt ? Date.parse(policy.expiresAt) : null,
  updatedAt
});

export const createLoadProfileVersionSnapshot = async (params: {
  db: any;
  profile: LoadProfile;
  reason?: string;
}): Promise<LoadProfileVersion> => {
  const versionNumber = await nextVersionNumber(
    params.db,
    loadProfileVersionsTable,
    loadProfileVersionsTable.profileId,
    params.profile.id
  );
  const now = Date.now();
  const payload = LoadProfileSchema.parse(params.profile);
  const profileRows = (await params.db
    .select()
    .from(loadProfilesTable)
    .where(eq(loadProfilesTable.id, params.profile.id))
    .limit(1)) as LoadProfileRow[];
  const profileRow = profileRows[0];
  if (!profileRow?.tenantId) {
    throw new Error("Load profile tenant could not be resolved.");
  }

  await params.db.insert(loadProfileVersionsTable).values({
    id: nanoid(),
    tenantId: profileRow.tenantId,
    profileId: params.profile.id,
    versionNumber,
    reason: params.reason ?? null,
    snapshotJson: JSON.stringify(payload),
    createdAt: now
  });

  const rows = (await params.db
    .select()
    .from(loadProfileVersionsTable)
    .where(eq(loadProfileVersionsTable.profileId, params.profile.id))
    .orderBy(desc(loadProfileVersionsTable.versionNumber))
    .limit(1)) as LoadProfileVersionRow[];

  return mapLoadProfileVersionRow(rows[0]!);
};

export const listLoadProfileVersions = async (
  db: any,
  profileId: string
): Promise<LoadProfileVersion[]> => {
  const rows = (await db
    .select()
    .from(loadProfileVersionsTable)
    .where(eq(loadProfileVersionsTable.profileId, profileId))
    .orderBy(desc(loadProfileVersionsTable.versionNumber))) as LoadProfileVersionRow[];
  return rows.map(mapLoadProfileVersionRow);
};

export const rollbackLoadProfileVersion = async (params: {
  db: any;
  profileId: string;
  versionId: string;
}): Promise<LoadProfile> => {
  const versionRows = (await params.db
    .select()
    .from(loadProfileVersionsTable)
    .where(eq(loadProfileVersionsTable.id, params.versionId))
    .limit(1)) as LoadProfileVersionRow[];
  const versionRow = versionRows[0];
  if (!versionRow || versionRow.profileId !== params.profileId) {
    throw new Error("Load profile version not found.");
  }

  const snapshot = LoadProfileSchema.parse(JSON.parse(versionRow.snapshotJson));
  const updatedAt = Date.now();
  await params.db
    .update(loadProfilesTable)
    .set(profileUpdateValues(snapshot, updatedAt))
    .where(eq(loadProfilesTable.id, params.profileId));

  const profileRows = (await params.db
    .select()
    .from(loadProfilesTable)
    .where(eq(loadProfilesTable.id, params.profileId))
    .limit(1)) as LoadProfileRow[];
  const profileRow = profileRows[0];
  if (!profileRow) {
    throw new Error("Load profile not found.");
  }

  const profile = mapLoadProfileRow(profileRow);
  await createLoadProfileVersionSnapshot({
    db: params.db,
    profile,
    reason: `Rollback to version ${versionRow.versionNumber}`
  });

  return profile;
};

export const createGatePolicyVersionSnapshot = async (params: {
  db: any;
  policy: GatePolicy;
  status: GatePolicyVersionStatus;
  reason?: string;
}): Promise<GatePolicyVersion> => {
  const versionNumber = await nextVersionNumber(
    params.db,
    gatePolicyVersionsTable,
    gatePolicyVersionsTable.policyId,
    params.policy.id
  );
  const now = Date.now();
  const payload = GatePolicySchema.parse(params.policy);
  const policyRows = (await params.db
    .select()
    .from(gatePoliciesTable)
    .where(eq(gatePoliciesTable.id, params.policy.id))
    .limit(1)) as GatePolicyRow[];
  const policyRow = policyRows[0];
  if (!policyRow?.tenantId) {
    throw new Error("Gate policy tenant could not be resolved.");
  }

  await params.db.insert(gatePolicyVersionsTable).values({
    id: nanoid(),
    tenantId: policyRow.tenantId,
    policyId: params.policy.id,
    versionNumber,
    status: params.status,
    reason: params.reason ?? null,
    snapshotJson: JSON.stringify(payload),
    createdAt: now
  });

  const rows = (await params.db
    .select()
    .from(gatePolicyVersionsTable)
    .where(eq(gatePolicyVersionsTable.policyId, params.policy.id))
    .orderBy(desc(gatePolicyVersionsTable.versionNumber))
    .limit(1)) as GatePolicyVersionRow[];
  return mapGatePolicyVersionRow(rows[0]!);
};

export const listGatePolicyVersions = async (
  db: any,
  policyId: string
): Promise<GatePolicyVersion[]> => {
  const rows = (await db
    .select()
    .from(gatePolicyVersionsTable)
    .where(eq(gatePolicyVersionsTable.policyId, policyId))
    .orderBy(desc(gatePolicyVersionsTable.versionNumber))) as GatePolicyVersionRow[];
  return rows.map(mapGatePolicyVersionRow);
};

export const supersedeGatePolicy = async (params: {
  db: any;
  policyId: string;
  nextPolicy: GatePolicy;
  reason?: string;
}): Promise<GatePolicy> => {
  const previousRows = (await params.db
    .select()
    .from(gatePoliciesTable)
    .where(eq(gatePoliciesTable.id, params.policyId))
    .limit(1)) as GatePolicyRow[];
  const previousRow = previousRows[0];
  if (!previousRow) {
    throw new Error("Gate policy not found.");
  }

  const previous = mapGatePolicyRow(previousRow);
  await createGatePolicyVersionSnapshot({
    db: params.db,
    policy: previous,
    status: "superseded",
    reason: params.reason ?? "Superseded by a newer policy snapshot."
  });

  await params.db
    .update(gatePoliciesTable)
    .set(gatePolicyUpdateValues(params.nextPolicy, Date.now()))
    .where(eq(gatePoliciesTable.id, params.policyId));

  const updatedRows = (await params.db
    .select()
    .from(gatePoliciesTable)
    .where(eq(gatePoliciesTable.id, params.policyId))
    .limit(1)) as GatePolicyRow[];
  const updatedRow = updatedRows[0];
  if (!updatedRow) {
    throw new Error("Gate policy not found.");
  }

  const updated = mapGatePolicyRow(updatedRow);
  await createGatePolicyVersionSnapshot({
    db: params.db,
    policy: updated,
    status: "active",
    reason: params.reason ?? "Policy updated."
  });
  return updated;
};
