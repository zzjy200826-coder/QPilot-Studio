import type {
  AnswerLibraryItem,
  ApplicationAttempt,
  ApplicationEvent,
  CandidateProfile,
  DiscoveredJob,
  HealthResponse,
  JobSource,
  ReviewResolution
} from "../../domain/schemas.js";

const resolveRuntimeBase = (): string => {
  const configuredBaseUrl = import.meta.env.VITE_AUTO_FIND_JOBS_RUNTIME_BASE_URL;
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  if (typeof window !== "undefined") {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.port === "8790") {
      return currentUrl.origin;
    }

    currentUrl.port = "8790";
    return currentUrl.origin;
  }

  return "http://127.0.0.1:8790";
};

const runtimeBase = resolveRuntimeBase();

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const toJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const body = await response.text();
    let parsedBody: unknown;
    try {
      parsedBody = body ? JSON.parse(body) : undefined;
    } catch {
      parsedBody = body;
    }

    const message =
      typeof parsedBody === "object" && parsedBody && "message" in parsedBody
        ? String(parsedBody.message)
        : body || `HTTP ${response.status}`;
    throw new ApiError(message, response.status, parsedBody);
  }
  return (await response.json()) as T;
};

const runtimeFetch = (path: string, init?: RequestInit): Promise<Response> =>
  fetch(`${runtimeBase}${path}`, init);

export const api = {
  runtimeBase,
  async health(): Promise<HealthResponse> {
    return toJson(await runtimeFetch("/api/health"));
  },
  async getProfile(): Promise<CandidateProfile> {
    return toJson(await runtimeFetch("/api/profile"));
  },
  async saveProfile(payload: CandidateProfile): Promise<CandidateProfile> {
    return toJson(
      await runtimeFetch("/api/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      })
    );
  },
  async listAnswers(): Promise<AnswerLibraryItem[]> {
    return toJson(await runtimeFetch("/api/answers"));
  },
  async saveAnswer(payload: {
    id?: string;
    label: string;
    questionKey: string;
    answer: string;
    synonyms: string[];
  }): Promise<AnswerLibraryItem> {
    return toJson(
      await runtimeFetch("/api/answers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      })
    );
  },
  async deleteAnswer(id: string): Promise<void> {
    await runtimeFetch(`/api/answers/${id}`, {
      method: "DELETE"
    });
  },
  async listSources(): Promise<JobSource[]> {
    return toJson(await runtimeFetch("/api/sources"));
  },
  async createSource(payload: {
    label: string;
    seedUrl: string;
    kind?: JobSource["kind"];
  }): Promise<JobSource> {
    return toJson(
      await runtimeFetch("/api/sources", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      })
    );
  },
  async deleteSource(id: string): Promise<void> {
    await runtimeFetch(`/api/sources/${id}`, {
      method: "DELETE"
    });
  },
  async discoverSources(sourceId?: string): Promise<{ jobs: DiscoveredJob[] }> {
    return toJson(
      await runtimeFetch("/api/sources/discover", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ sourceId })
      })
    );
  },
  async listJobs(filters?: { status?: string; query?: string }): Promise<DiscoveredJob[]> {
    const search = new URLSearchParams();
    if (filters?.status) {
      search.set("status", filters.status);
    }
    if (filters?.query) {
      search.set("query", filters.query);
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return toJson(await runtimeFetch(`/api/jobs${suffix}`));
  },
  async updateJobStatus(jobId: string, status: DiscoveredJob["status"]): Promise<void> {
    await runtimeFetch(`/api/jobs/${jobId}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status })
    });
  },
  async prepareApplication(
    jobId: string,
    options?: {
      automationMode?: "manual" | "safe_auto_apply";
      submissionMode?: "submit_enabled" | "prefill_only";
    }
  ): Promise<ApplicationAttempt> {
    return toJson(
      await runtimeFetch(`/api/jobs/${jobId}/prepare`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(options ?? {})
      })
    );
  },
  async prepareDirectApplication(payload: {
    applyUrl: string;
    ats?: "greenhouse" | "lever" | "moka" | "portal";
    title?: string;
    company?: string;
    location?: string;
    submissionMode?: "submit_enabled" | "prefill_only";
    automationMode?: "manual" | "safe_auto_apply";
  }): Promise<ApplicationAttempt> {
    return toJson(
      await runtimeFetch("/api/applications/direct-prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      })
    );
  },
  async listApplications(status?: string[]): Promise<ApplicationAttempt[]> {
    const search = new URLSearchParams();
    if (status && status.length > 0) {
      search.set("status", status.join(","));
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return toJson(await runtimeFetch(`/api/applications${suffix}`));
  },
  async getApplication(id: string): Promise<ApplicationAttempt> {
    return toJson(await runtimeFetch(`/api/applications/${id}`));
  },
  async listApplicationEvents(id: string): Promise<ApplicationEvent[]> {
    return toJson(await runtimeFetch(`/api/applications/${id}/events`));
  },
  async saveReview(id: string, resolutions: ReviewResolution[]): Promise<ApplicationAttempt> {
    return toJson(
      await runtimeFetch(`/api/applications/${id}/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ resolutions })
      })
    );
  },
  async startApplication(id: string): Promise<ApplicationAttempt> {
    return toJson(
      await runtimeFetch(`/api/applications/${id}/start`, {
        method: "POST"
      })
    );
  },
  async resumeApplication(id: string): Promise<ApplicationAttempt> {
    return toJson(
      await runtimeFetch(`/api/applications/${id}/resume`, {
        method: "POST"
      })
    );
  },
  async confirmSubmit(id: string): Promise<ApplicationAttempt> {
    return toJson(
      await runtimeFetch(`/api/applications/${id}/confirm-submit`, {
        method: "POST"
      })
    );
  },
  async enableFinalSubmit(id: string): Promise<ApplicationAttempt> {
    return toJson(
      await runtimeFetch(`/api/applications/${id}/enable-final-submit`, {
        method: "POST"
      })
    );
  },
  createApplicationStream(id: string): EventSource {
    return new EventSource(`${runtimeBase}/api/applications/${id}/stream`);
  }
};
