import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";

const readPayloadString = (
  payload: Record<string, unknown> | undefined,
  key: string
): string | undefined => {
  const value = payload?.[key];
  return typeof value === "string" ? value : undefined;
};

const getSubmissionModeLabel = (mode: "submit_enabled" | "prefill_only"): string =>
  mode === "prefill_only" ? "仅预填" : "允许最终提交";

const getAutomationModeLabel = (mode: "manual" | "safe_auto_apply"): string =>
  mode === "safe_auto_apply" ? "满足条件时自动投递" : "手动推进";

export const ApplicationsPage = () => {
  const queryClient = useQueryClient();
  const attemptsQuery = useQuery({
    queryKey: ["applications"],
    queryFn: () => api.listApplications(),
    refetchInterval: 4_000
  });
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 4_000
  });

  const [selectedAttemptId, setSelectedAttemptId] = useState("");

  useEffect(() => {
    if (!selectedAttemptId && attemptsQuery.data?.[0]) {
      setSelectedAttemptId(attemptsQuery.data[0].id);
    }
  }, [attemptsQuery.data, selectedAttemptId]);

  const selectedAttemptQuery = useQuery({
    queryKey: ["application", selectedAttemptId],
    queryFn: () => api.getApplication(selectedAttemptId),
    enabled: Boolean(selectedAttemptId),
    refetchInterval: 4_000
  });

  const selectedEventsQuery = useQuery({
    queryKey: ["application-events", selectedAttemptId],
    queryFn: () => api.listApplicationEvents(selectedAttemptId),
    enabled: Boolean(selectedAttemptId),
    refetchInterval: 4_000
  });

  useEffect(() => {
    if (!selectedAttemptId) {
      return;
    }

    const stream = api.createApplicationStream(selectedAttemptId);
    stream.addEventListener("application-event", () => {
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
      void queryClient.invalidateQueries({ queryKey: ["application", selectedAttemptId] });
      void queryClient.invalidateQueries({ queryKey: ["application-events", selectedAttemptId] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
    });

    return () => {
      stream.close();
    };
  }, [queryClient, selectedAttemptId]);

  return (
    <div className="workspace-two-column workspace-two-column-wide">
      <div className="subsection">
        <div className="subsection-head">
          <div>
            <p className="workspace-kicker">投递记录</p>
            <h4>所有浏览器侧投递尝试都会附带截图、HTML 快照和实时事件轨迹。</h4>
          </div>
          <div className="queue-chip-stack">
            <div className="workspace-header-chip">
              {healthQuery.data?.llmConfigured
                ? `LLM 预填已启用${healthQuery.data.llmModel ? `：${healthQuery.data.llmModel}` : ""}`
                : "当前仅使用规则预填"}
            </div>
            {healthQuery.data?.activeAttemptId ? (
              <div className="workspace-header-chip">
                活跃尝试：{healthQuery.data.activeAttemptId.slice(0, 8)}
              </div>
            ) : null}
          </div>
        </div>
        <div className="workspace-stack">
          {attemptsQuery.data?.map((attempt) => (
            <button
              key={attempt.id}
              type="button"
              className={`queue-card${attempt.id === selectedAttemptId ? " queue-card-active" : ""}`}
              onClick={() => setSelectedAttemptId(attempt.id)}
            >
              <div className="queue-card-row">
                <div>
                  <p className="list-card-title">{attempt.jobSnapshot.title}</p>
                  <p className="list-card-copy">
                    {attempt.jobSnapshot.company} / {attempt.jobSnapshot.location}
                  </p>
                </div>
                <StatusBadge status={attempt.status} />
              </div>
              <p className="list-card-copy">尝试 ID：{attempt.id}</p>
              <p className="list-card-copy">
                投递策略：{getAutomationModeLabel(attempt.settings.automationMode)}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="subsection">
        {selectedAttemptQuery.data ? (
          <div className="workspace-stack">
            <div className="subsection-head">
              <div>
                <p className="workspace-kicker">尝试详情</p>
                <h4>{selectedAttemptQuery.data.jobSnapshot.title}</h4>
              </div>
              <StatusBadge status={selectedAttemptQuery.data.status} />
            </div>

            {selectedAttemptQuery.data.currentScreenshotPath ? (
              <img
                className="review-shot"
                src={`${api.runtimeBase}${selectedAttemptQuery.data.currentScreenshotPath}`}
                alt="当前申请截图"
              />
            ) : null}

            <div className="list-card">
              <p className="list-card-title">尝试摘要</p>
              <p className="list-card-copy">
                公司：{selectedAttemptQuery.data.jobSnapshot.company}
              </p>
              <p className="list-card-copy">
                地点：{selectedAttemptQuery.data.jobSnapshot.location}
              </p>
              <p className="list-card-copy">
                提交模式：{getSubmissionModeLabel(selectedAttemptQuery.data.settings.submissionMode)}
              </p>
              <p className="list-card-copy">
                投递策略：{getAutomationModeLabel(selectedAttemptQuery.data.settings.automationMode)}
              </p>
              <p className="list-card-copy">
                来源：
                {selectedAttemptQuery.data.settings.origin === "direct_url"
                  ? "直接真实链接"
                  : "发现队列岗位"}
              </p>
              <p className="list-card-copy">
                开始时间：{selectedAttemptQuery.data.startedAt ?? "尚未开始"}
              </p>
              <p className="list-card-copy">
                结束时间：{selectedAttemptQuery.data.endedAt ?? "仍在进行中"}
              </p>
              {selectedAttemptQuery.data.settings.automationDecision ? (
                <>
                  <p className="list-card-copy">
                    策略评估：
                    {selectedAttemptQuery.data.settings.automationDecision.eligible ? "通过" : "拦截"}
                  </p>
                  <p className="list-card-copy">
                    策略原因：{selectedAttemptQuery.data.settings.automationDecision.reason}
                  </p>
                </>
              ) : null}
              {selectedAttemptQuery.data.errorMessage ? (
                <p className="list-card-copy list-card-copy-danger">
                  错误：{selectedAttemptQuery.data.errorMessage}
                </p>
              ) : null}
              {selectedAttemptQuery.data.manualPrompt ? (
                <p className="list-card-copy list-card-copy-danger">
                  人工步骤：{selectedAttemptQuery.data.manualPrompt}
                </p>
              ) : null}
              {selectedAttemptQuery.data.submitGateMessage ? (
                <p className="list-card-copy">
                  提交说明：{selectedAttemptQuery.data.submitGateMessage}
                </p>
              ) : null}
            </div>

            <div className="workspace-stack">
              <p className="workspace-kicker">事件轨迹</p>
              {selectedEventsQuery.data?.map((event) => (
                <article key={event.id} className="event-card">
                  <div className="list-card-row">
                    <StatusBadge status={event.type} />
                    <span className="list-card-copy">{event.createdAt}</span>
                  </div>
                  <p className="list-card-title">{event.message}</p>
                  {readPayloadString(event.payload, "pageUrl") ? (
                    <p className="list-card-copy">
                      页面 URL：{readPayloadString(event.payload, "pageUrl")}
                    </p>
                  ) : null}
                  {readPayloadString(event.payload, "automationReason") ? (
                    <p className="list-card-copy">
                      策略说明：{readPayloadString(event.payload, "automationReason")}
                    </p>
                  ) : null}
                  {event.screenshotPath ? (
                    <a
                      className="job-link"
                      href={`${api.runtimeBase}${event.screenshotPath}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开截图
                    </a>
                  ) : null}
                  {readPayloadString(event.payload, "htmlArtifactPath") ? (
                    <a
                      className="job-link"
                      href={`${api.runtimeBase}${readPayloadString(event.payload, "htmlArtifactPath")}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开 HTML 快照
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="workspace-empty">请选择一条投递尝试以查看详情。</div>
        )}
      </div>
    </div>
  );
};
