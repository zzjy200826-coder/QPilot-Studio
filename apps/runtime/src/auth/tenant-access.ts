import { and, eq } from "drizzle-orm";
import {
  caseTemplatesTable,
  environmentTargetsTable,
  gatePoliciesTable,
  loadProfilesTable,
  loadRunsTable,
  projectsTable,
  releaseCandidatesTable,
  runsTable
} from "../db/schema.js";
import type {
  CaseTemplateRow,
  EnvironmentTargetRow,
  GatePolicyRow,
  LoadProfileRow,
  LoadRunRow,
  ProjectRow,
  ReleaseCandidateRow,
  RunRow
} from "../utils/mappers.js";

export const getTenantProjectRow = async (
  db: any,
  tenantId: string,
  projectId: string
): Promise<ProjectRow | undefined> => {
  const rows = (await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.id, projectId), eq(projectsTable.tenantId, tenantId)))
    .limit(1)) as ProjectRow[];
  return rows[0];
};

export const listTenantProjectRows = async (
  db: any,
  tenantId: string
): Promise<ProjectRow[]> =>
  (await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.tenantId, tenantId))) as ProjectRow[];

export const getTenantRunRow = async (
  db: any,
  tenantId: string,
  runId: string
): Promise<RunRow | undefined> => {
  const rows = (await db
    .select()
    .from(runsTable)
    .where(and(eq(runsTable.id, runId), eq(runsTable.tenantId, tenantId)))
    .limit(1)) as RunRow[];
  return rows[0];
};

export const getTenantCaseRow = async (
  db: any,
  tenantId: string,
  caseId: string
): Promise<CaseTemplateRow | undefined> => {
  const rows = (await db
    .select()
    .from(caseTemplatesTable)
    .where(and(eq(caseTemplatesTable.id, caseId), eq(caseTemplatesTable.tenantId, tenantId)))
    .limit(1)) as CaseTemplateRow[];
  return rows[0];
};

export const getTenantLoadProfileRow = async (
  db: any,
  tenantId: string,
  profileId: string
): Promise<LoadProfileRow | undefined> => {
  const rows = (await db
    .select()
    .from(loadProfilesTable)
    .where(and(eq(loadProfilesTable.id, profileId), eq(loadProfilesTable.tenantId, tenantId)))
    .limit(1)) as LoadProfileRow[];
  return rows[0];
};

export const getTenantLoadRunRow = async (
  db: any,
  tenantId: string,
  runId: string
): Promise<LoadRunRow | undefined> => {
  const rows = (await db
    .select()
    .from(loadRunsTable)
    .where(and(eq(loadRunsTable.id, runId), eq(loadRunsTable.tenantId, tenantId)))
    .limit(1)) as LoadRunRow[];
  return rows[0];
};

export const getTenantGatePolicyRow = async (
  db: any,
  tenantId: string,
  policyId: string
): Promise<GatePolicyRow | undefined> => {
  const rows = (await db
    .select()
    .from(gatePoliciesTable)
    .where(and(eq(gatePoliciesTable.id, policyId), eq(gatePoliciesTable.tenantId, tenantId)))
    .limit(1)) as GatePolicyRow[];
  return rows[0];
};

export const getTenantReleaseRow = async (
  db: any,
  tenantId: string,
  releaseId: string
): Promise<ReleaseCandidateRow | undefined> => {
  const rows = (await db
    .select()
    .from(releaseCandidatesTable)
    .where(
      and(
        eq(releaseCandidatesTable.id, releaseId),
        eq(releaseCandidatesTable.tenantId, tenantId)
      )
    )
    .limit(1)) as ReleaseCandidateRow[];
  return rows[0];
};

export const getTenantEnvironmentRow = async (
  db: any,
  tenantId: string,
  environmentId: string
): Promise<EnvironmentTargetRow | undefined> => {
  const rows = (await db
    .select()
    .from(environmentTargetsTable)
    .where(
      and(
        eq(environmentTargetsTable.id, environmentId),
        eq(environmentTargetsTable.tenantId, tenantId)
      )
    )
    .limit(1)) as EnvironmentTargetRow[];
  return rows[0];
};
