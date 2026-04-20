import type { LoadProfile, LoadRun } from "@qpilot/shared";
import { simulateLoadRun } from "../analytics/load-insights.js";
import { executeK6LoadRun } from "./k6-runner.js";

export interface ExecuteLoadRunOptions {
  environmentLabel: string;
  notes?: string;
  startedAt?: string;
}

export const executeLoadRun = async (
  profile: LoadProfile,
  options: ExecuteLoadRunOptions
): Promise<LoadRun> => {
  switch (profile.engine) {
    case "k6_http":
      return executeK6LoadRun(profile, options);
    case "browser_probe":
    case "synthetic":
    default:
      return simulateLoadRun(profile, options);
  }
};
