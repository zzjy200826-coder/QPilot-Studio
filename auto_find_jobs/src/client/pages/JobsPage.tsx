import { useDeferredValue, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DiscoveredJob } from "../../domain/schemas.js";
import { StatusBadge, getStatusLabel } from "../components/StatusBadge";
import { ApiError, api } from "../lib/api";

type AutomationMode = "manual" | "safe_auto_apply";
type SubmissionMode = "submit_enabled" | "prefill_only";
type DirectAts = "" | "greenhouse" | "lever" | "moka" | "portal";

const getAutomationModeLabel = (mode: AutomationMode): string =>
  mode === "safe_auto_apply" ? "满足条件时自动投递" : "手动推进";

const supportsApplicationAssist = (job: DiscoveredJob): boolean => {
  const explicitFlag = job.metadata.autoApplyEligible;
  if (explicitFlag === true) {
    return true;
  }
  return (
    job.ats === "greenhouse" ||
    job.ats === "lever" ||
    job.ats === "moka" ||
    job.ats === "portal" ||
    job.ats === "jsonld"
  );
};

const readReferralCode = (job: DiscoveredJob): string | undefined => {
  const code = job.metadata.referralCode;
  return typeof code === "string" && code.trim().length > 0 ? code : undefined;
};

const readSourceKind = (job: DiscoveredJob): string | undefined => {
  const sourceKind = job.metadata.sourceKind;
  return typeof sourceKind === "string" ? sourceKind : undefined;
};

export const JobsPage = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [jobAutomationMode, setJobAutomationMode] = useState<AutomationMode>("manual");
  const [jobNotice, setJobNotice] = useState<{
    tone: "warning" | "info";
    message: string;
  } | null>(null);
  const [directDraft, setDirectDraft] = useState({
    applyUrl: "",
    ats: "" as DirectAts,
    title: "",
    company: "",
    location: "",
    submissionMode: "prefill_only" as SubmissionMode,
    automationMode: "manual" as AutomationMode
  });
  const [duplicateNotice, setDuplicateNotice] = useState<{
    jobId: string;
    attemptId: string;
    status: string;
    message: string;
  } | null>(null);
  const [directNotice, setDirectNotice] = useState<{
    tone: "warning" | "info";
    attemptId?: string;
    status?: string;
    message: string;
  } | null>(null);
  const deferredSearch = useDeferredValue(search);

  const jobsQuery = useQuery({
    queryKey: ["jobs", status, deferredSearch],
    queryFn: () =>
      api.listJobs({
        status: status || undefined,
        query: deferredSearch || undefined
      })
  });

  const prepareMutation = useMutation({
    mutationFn: ({
      jobId,
      options
    }: {
      jobId: string;
      options?: {
        automationMode?: AutomationMode;
        submissionMode?: SubmissionMode;
      };
    }) => api.prepareApplication(jobId, options),
    onSuccess: () => {
      setDuplicateNotice(null);
      setJobNotice({
        tone: "info",
        message: "已创建申请尝试，请前往确认队列继续。"
      });
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error, variables) => {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        typeof error.data === "object" &&
        error.data &&
        "existingAttempt" in error.data
      ) {
        const existingAttempt = error.data.existingAttempt as {
          id: string;
          status: string;
        };
        setDuplicateNotice({
          jobId: variables.jobId,
          attemptId: existingAttempt.id,
          status: existingAttempt.status,
          message: error.message
        });
        return;
      }

      setJobNotice({
        tone: "warning",
        message: error instanceof ApiError ? error.message : "准备申请失败，请稍后再试。"
      });
    }
  });

  const directPrepareMutation = useMutation({
    mutationFn: api.prepareDirectApplication,
    onSuccess: () => {
      setDirectNotice({
        tone: "info",
        message: "已创建真实投递尝试，请前往确认队列继续。"
      });
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        typeof error.data === "object" &&
        error.data &&
        "existingAttempt" in error.data
      ) {
        const existingAttempt = error.data.existingAttempt as {
          id: string;
          status: string;
        };
        setDirectNotice({
          tone: "warning",
          attemptId: existingAttempt.id,
          status: existingAttempt.status,
          message: error.message
        });
        return;
      }

      setDirectNotice({
        tone: "warning",
        message: error instanceof ApiError ? error.message : "准备真实投递链接失败，请稍后再试。"
      });
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ jobId, nextStatus }: { jobId: string; nextStatus: "seen" | "skipped" }) =>
      api.updateJobStatus(jobId, nextStatus),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    }
  });

  const directSubmissionMode =
    directDraft.automationMode === "safe_auto_apply" ? "submit_enabled" : directDraft.submissionMode;

  return (
    <div className="workspace-stack">
      <section className="section-headline">
        <div>
          <p className="workspace-kicker">岗位列表</p>
          <h3>飞书导入的岗位入口和 ATS 发现结果都会汇总在这里，再按可投递能力分流。</h3>
        </div>
      </section>

      {jobNotice ? (
        <div className={`inline-alert${jobNotice.tone === "warning" ? " inline-alert-warning" : ""}`}>
          <p className="list-card-copy">{jobNotice.message}</p>
        </div>
      ) : null}

      <section className="workspace-two-column">
        <div className="subsection">
          <div className="subsection-head">
            <div>
              <p className="workspace-kicker">直接发起真实投递</p>
              <h4>粘贴 Greenhouse 或 Lever 的 hosted apply 链接，立即准备一个真实浏览器会话。</h4>
            </div>
          </div>

          <div className="workspace-stack">
            <label className="form-field">
              <span>Hosted apply 链接</span>
              <input
                data-testid="direct-apply-url"
                placeholder="https://boards.greenhouse.io/... 或 https://jobs.lever.co/..."
                value={directDraft.applyUrl}
                onChange={(event) =>
                  setDirectDraft({
                    ...directDraft,
                    applyUrl: event.target.value
                  })
                }
              />
            </label>

            <div className="workspace-two-column">
              <label className="form-field">
                <span>ATS 覆盖</span>
                <select
                  value={directDraft.ats}
                  onChange={(event) =>
                    setDirectDraft({
                      ...directDraft,
                      ats: event.target.value as DirectAts
                    })
                  }
                >
                  <option value="">自动识别</option>
                  <option value="greenhouse">Greenhouse</option>
                  <option value="lever">Lever</option>
                  <option value="moka">Moka</option>
                  <option value="portal">通用入口/职位页</option>
                </select>
              </label>

              <label className="form-field">
                <span>投递策略</span>
                <select
                  value={directDraft.automationMode}
                  onChange={(event) =>
                    setDirectDraft({
                      ...directDraft,
                      automationMode: event.target.value as AutomationMode
                    })
                  }
                >
                  <option value="manual">手动推进</option>
                  <option value="safe_auto_apply">满足条件时自动投递</option>
                </select>
              </label>
            </div>

            <div className="workspace-two-column">
              <label className="form-field">
                <span>最终提交权限</span>
                <select
                  value={directSubmissionMode}
                  disabled={directDraft.automationMode === "safe_auto_apply"}
                  onChange={(event) =>
                    setDirectDraft({
                      ...directDraft,
                      submissionMode: event.target.value as SubmissionMode
                    })
                  }
                >
                  <option value="prefill_only">仅预填</option>
                  <option value="submit_enabled">允许最终提交</option>
                </select>
              </label>

              <div className="workspace-header-chip">
                当前模式：{getAutomationModeLabel(directDraft.automationMode)}
              </div>
            </div>

            {directDraft.automationMode === "safe_auto_apply" ? (
              <div className="inline-alert">
                <p className="list-card-copy">
                  安全自动投递会自动启用“允许最终提交”，但只有在没有高风险字段、没有人工介入、也没有 LLM 推断的情况下才会真正自动发出申请。
                </p>
              </div>
            ) : null}

            <div className="workspace-two-column">
              <label className="form-field">
                <span>公司名称</span>
                <input
                  placeholder="可选"
                  value={directDraft.company}
                  onChange={(event) =>
                    setDirectDraft({
                      ...directDraft,
                      company: event.target.value
                    })
                  }
                />
              </label>
              <label className="form-field">
                <span>岗位名称</span>
                <input
                  placeholder="可选"
                  value={directDraft.title}
                  onChange={(event) =>
                    setDirectDraft({
                      ...directDraft,
                      title: event.target.value
                    })
                  }
                />
              </label>
            </div>

            <label className="form-field">
              <span>地点</span>
              <input
                placeholder="可选"
                value={directDraft.location}
                onChange={(event) =>
                  setDirectDraft({
                    ...directDraft,
                    location: event.target.value
                  })
                }
              />
            </label>

            {directNotice ? (
              <div
                className={`inline-alert${
                  directNotice.tone === "warning" ? " inline-alert-warning" : ""
                }`}
              >
                <p className="list-card-title">
                  {directNotice.tone === "warning" ? "真实投递准备被阻止" : "真实投递已创建"}
                </p>
                <p className="list-card-copy">
                  {directNotice.message}
                  {directNotice.attemptId
                    ? ` 已存在尝试：${directNotice.attemptId}（${getStatusLabel(
                        directNotice.status ?? ""
                      )}）。`
                    : ""}
                </p>
              </div>
            ) : null}

            <button
              type="button"
              data-testid="direct-prepare-button"
              className="button button-primary"
              onClick={() =>
                directPrepareMutation.mutate({
                  applyUrl: directDraft.applyUrl,
                  ats:
                    directDraft.ats === "greenhouse" ||
                    directDraft.ats === "lever" ||
                    directDraft.ats === "moka" ||
                    directDraft.ats === "portal"
                      ? directDraft.ats
                      : undefined,
                  title: directDraft.title || undefined,
                  company: directDraft.company || undefined,
                  location: directDraft.location || undefined,
                  submissionMode: directSubmissionMode,
                  automationMode: directDraft.automationMode
                })
              }
            >
              {directPrepareMutation.isPending ? "正在准备真实链接..." : "准备真实投递链接"}
            </button>
          </div>
        </div>
      </section>

      <section className="toolbar">
        <label className="toolbar-field">
          <span>搜索</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>

        <label className="toolbar-field">
          <span>状态</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">全部状态</option>
            <option value="new">新发现</option>
            <option value="seen">已查看</option>
            <option value="applied">已投递</option>
            <option value="skipped">已跳过</option>
          </select>
        </label>

        <label className="toolbar-field">
          <span>准备策略</span>
          <select
            data-testid="job-prepare-mode"
            value={jobAutomationMode}
            onChange={(event) => setJobAutomationMode(event.target.value as AutomationMode)}
          >
            <option value="manual">手动推进</option>
            <option value="safe_auto_apply">满足条件时自动投递</option>
          </select>
        </label>
      </section>

      <div className="workspace-header-chip">
        当前岗位准备策略：{getAutomationModeLabel(jobAutomationMode)}
      </div>

      <div className="workspace-stack">
        {jobsQuery.data?.length === 0 ? (
          <div className="workspace-empty">当前还没有岗位。先去“来源”页面扫描一次。</div>
        ) : null}

        {jobsQuery.data?.map((job) => {
          const eligible = supportsApplicationAssist(job);
          const referralCode = readReferralCode(job);
          const sourceKind = readSourceKind(job);

          return (
            <article key={job.id} className="job-card">
              <div className="job-card-main">
                <div className="job-card-row">
                  <div>
                    <p className="job-title">{job.title}</p>
                    <p className="job-meta">
                      {job.company} / {job.location}
                    </p>
                  </div>
                  <div className="job-card-row">
                    <StatusBadge status={job.status} />
                    <StatusBadge status={job.ats} />
                    {sourceKind ? <StatusBadge status={sourceKind} /> : null}
                  </div>
                </div>

                {job.description ? <p className="job-description">{job.description}</p> : null}

                <div className="job-card-row">
                  <div className="workspace-stack" style={{ gap: "0.35rem" }}>
                    <a href={job.applyUrl} target="_blank" rel="noreferrer" className="job-link">
                      打开投递页面
                    </a>
                    {referralCode ? <span className="job-meta">内推码：{referralCode}</span> : null}
                    {!eligible ? (
                      <span className="job-meta">
                        这条记录只是岗位入口链接，当前还不支持直接自动投递。
                      </span>
                    ) : null}
                    {eligible && (job.ats === "portal" || job.ats === "jsonld") ? (
                      <span className="job-meta">
                        这类入口页现在支持半自动模式：系统会先打开真实浏览器；你手动选岗、登录或进入真实申请表后，可以回到确认队列继续自动填写。
                      </span>
                    ) : null}
                  </div>
                  <span className="job-meta">发现时间：{job.discoveredAt}</span>
                </div>

                {duplicateNotice?.jobId === job.id ? (
                  <div className="inline-alert inline-alert-warning">
                    <p className="list-card-title">已阻止重复准备</p>
                    <p className="list-card-copy">
                      {duplicateNotice.message} 已存在尝试：{duplicateNotice.attemptId}（
                      {getStatusLabel(duplicateNotice.status)}）。
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="button-column">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={!eligible}
                  onClick={() =>
                    prepareMutation.mutate({
                      jobId: job.id,
                      options: {
                        automationMode: jobAutomationMode
                      }
                    })
                  }
                >
                  {!eligible
                    ? "暂不支持自动投递"
                    : prepareMutation.isPending
                      ? "准备中..."
                      : "准备申请"}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => updateStatusMutation.mutate({ jobId: job.id, nextStatus: "seen" })}
                >
                  标记为已查看
                </button>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={() =>
                    updateStatusMutation.mutate({ jobId: job.id, nextStatus: "skipped" })
                  }
                >
                  跳过
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};
