import type { DiscoveredJob } from "../../domain/schemas.js";
import { GreenhouseAdapter } from "./greenhouse.js";
import { LeverAdapter } from "./lever.js";
import { MokaAdapter } from "./moka.js";
import { PortalAdapter } from "./portal.js";
import type { SiteAdapter } from "./types.js";

const adapters: SiteAdapter[] = [
  new GreenhouseAdapter(),
  new LeverAdapter(),
  new MokaAdapter(),
  new PortalAdapter()
];

export const resolveAdapterForJob = (job: DiscoveredJob): SiteAdapter => {
  switch (job.ats) {
    case "greenhouse":
      return adapters[0] as SiteAdapter;
    case "lever":
      return adapters[1] as SiteAdapter;
    case "moka":
      return adapters[2] as SiteAdapter;
    case "portal":
    case "jsonld":
      return adapters[3] as SiteAdapter;
    default:
      throw new Error(`No browser adapter is available for ${job.ats}.`);
  }
};
