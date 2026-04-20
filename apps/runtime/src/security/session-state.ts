import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const sanitizeSegment = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

export const resolveSessionStatePath = async (
  sessionsRoot: string,
  projectId: string,
  sessionProfile?: string
): Promise<string | null> => {
  if (!sessionProfile) {
    return null;
  }

  const safeProjectId = sanitizeSegment(projectId) || "project";
  const safeProfile = sanitizeSegment(sessionProfile) || "default";
  const dir = join(sessionsRoot, safeProjectId);
  await mkdir(dir, { recursive: true });
  return join(dir, `${safeProfile}.json`);
};
