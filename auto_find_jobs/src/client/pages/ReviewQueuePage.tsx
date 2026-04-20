import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";

const getSubmissionModeLabel = (mode: "submit_enabled" | "prefill_only"): string =>
  mode === "prefill_only" ? "仅预填" : "允许最终提交";

const getAutomationModeLabel = (mode: "manual" | "safe_auto_apply"): string =>
  mode === "safe_auto_apply" ? "满足条件时自动投递" : "手动推进";

const getAutomationDecisionLabel = (eligible: boolean): string =>
  eligible ? "自动投递策略已通过" : "自动投递策略已拦截";

const getStartButtonLabel = (activeAttemptId: string | undefined, selectedAttemptId: string): string =>
  activeAttemptId === selectedAttemptId ? "继续浏览器填写" : "开始浏览器填写";

export const ReviewQueuePage = () => {
  const queryClient = useQueryClient();
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 4_000
  });
  const attemptsQuery = useQuery({
    queryKey: ["applications", "review-queue"],
    queryFn: () =>
      api.listApplications([
        "awaiting_review",
        "ready_to_fill",
        "awaiting_manual",
        "prefill_completed",
        "awaiting_submit_confirmation"
      ]),
    refetchInterval: 4_000
  });

  const [selectedAttemptId, setSelectedAttemptId] = useState("");
  const [resolutions, setResolutions] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!selectedAttemptId && attemptsQuery.data?.[0]) {
      setSelectedAttemptId(attemptsQuery.data[0].id);
    }
  }, [attemptsQuery.data, selectedAttemptId]);

  const selectedAttempt = useMemo(
    () => attemptsQuery.data?.find((attempt) => attempt.id === selectedAttemptId),
    [attemptsQuery.data, selectedAttemptId]
  );

  useEffect(() => {
    if (!selectedAttempt?.fillPlan?.reviewItems) {
      setResolutions({});
      return;
    }

    setResolutions(
      selectedAttempt.fillPlan.reviewItems.reduce<Record<string, string>>((accumulator, item) => {
        accumulator[item.fieldId] = item.suggestedValue ?? "";
        return accumulator;
      }, {})
    );
  }, [selectedAttempt]);

  const saveReviewMutation = useMutation({
    mutationFn: ({
      attemptId,
      nextResolutions
    }: {
      attemptId: string;
      nextResolutions: Record<string, string>;
    }) =>
      api.saveReview(
        attemptId,
        Object.entries(nextResolutions).map(([fieldId, value]) => ({
          fieldId,
          value
        }))
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
    }
  });

  const startMutation = useMutation({
    mutationFn: api.startApplication,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
    }
  });

  const resumeMutation = useMutation({
    mutationFn: api.resumeApplication,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
    }
  });

  const confirmSubmitMutation = useMutation({
    mutationFn: api.confirmSubmit,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    }
  });

  const enableFinalSubmitMutation = useMutation({
    mutationFn: api.enableFinalSubmit,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
    }
  });

  return (
    <div className="workspace-two-column workspace-two-column-wide">
      <div className="subsection">
        <div className="subsection-head">
          <div>
            <p className="workspace-kicker">确认队列</p>
            <h4>所有高风险、不确定或与最终提交相关的步骤都会先停在这里。</h4>
          </div>
          <div className="queue-chip-stack">
            <div className="workspace-header-chip">
              {healthQuery.data?.llmConfigured
                ? `LLM 预填已启用${healthQuery.data.llmModel ? `：${healthQuery.data.llmModel}` : ""}`
                : "当前仅使用规则预填；模糊字段会进入人工确认"}
            </div>
            {healthQuery.data?.activeAttemptId ? (
              <div className="workspace-header-chip">
                活跃浏览器：{healthQuery.data.activeAttemptId.slice(0, 8)}
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
              {attempt.fillPlan?.reviewItems?.length ? (
                <p className="list-card-copy">待确认字段：{attempt.fillPlan.reviewItems.length}</p>
              ) : null}
              <p className="list-card-copy">
                提交模式：{getSubmissionModeLabel(attempt.settings.submissionMode)}
              </p>
              <p className="list-card-copy">
                投递策略：{getAutomationModeLabel(attempt.settings.automationMode)}
              </p>
              {attempt.settings.automationDecision ? (
                <p className="list-card-copy">
                  策略结果：{getAutomationDecisionLabel(attempt.settings.automationDecision.eligible)}
                </p>
              ) : null}
              {attempt.manualPrompt ? (
                <p className="list-card-copy list-card-copy-danger">{attempt.manualPrompt}</p>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="subsection">
        {selectedAttempt ? (
          <div className="workspace-stack">
            <div className="subsection-head">
              <div>
                <p className="workspace-kicker">当前尝试</p>
                <h4>{selectedAttempt.jobSnapshot.title}</h4>
              </div>
              <StatusBadge status={selectedAttempt.status} />
            </div>

            <div className="queue-chip-stack">
              <div className="workspace-header-chip">
                {getSubmissionModeLabel(selectedAttempt.settings.submissionMode)}
              </div>
              <div className="workspace-header-chip">
                {getAutomationModeLabel(selectedAttempt.settings.automationMode)}
              </div>
              <div className="workspace-header-chip">
                {selectedAttempt.settings.origin === "direct_url" ? "直接真实链接" : "发现队列岗位"}
              </div>
            </div>

            {selectedAttempt.currentScreenshotPath ? (
              <img
                className="review-shot"
                src={`${api.runtimeBase}${selectedAttempt.currentScreenshotPath}`}
                alt="最新申请截图"
              />
            ) : null}

            <article className="list-card">
              <p className="list-card-title">自动投递策略</p>
              <p className="list-card-copy">
                当前模式：{getAutomationModeLabel(selectedAttempt.settings.automationMode)}
              </p>
              <p className="list-card-copy">
                人工介入：{selectedAttempt.settings.manualInterventionOccurred ? "已发生" : "未发生"}
              </p>
              {selectedAttempt.settings.automationDecision ? (
                <>
                  <p className="list-card-copy">
                    策略结果：
                    {getAutomationDecisionLabel(selectedAttempt.settings.automationDecision.eligible)}
                  </p>
                  <p className="list-card-copy">
                    原因：{selectedAttempt.settings.automationDecision.reason}
                  </p>
                </>
              ) : (
                <p className="list-card-copy">当前流程还没有完成自动投递资格评估。</p>
              )}
            </article>

            {selectedAttempt.fillPlan?.reviewItems?.length ? (
              <div className="workspace-stack">
                {selectedAttempt.fillPlan.reviewItems.map((item) => (
                  <article key={item.fieldId} className="list-card">
                    <div className="list-card-row">
                      <div>
                        <p className="list-card-title">{item.label}</p>
                        <p className="list-card-copy">{item.reason}</p>
                        {item.suggestedValue ? (
                          <p className="list-card-copy">建议值：{item.suggestedValue}</p>
                        ) : null}
                        <p className="list-card-copy">
                          置信度：{Math.round(item.confidence * 100)}%
                        </p>
                      </div>
                      <StatusBadge status={item.type} />
                    </div>
                    {item.options.length > 0 ? (
                      <select
                        value={resolutions[item.fieldId] ?? ""}
                        onChange={(event) =>
                          setResolutions({
                            ...resolutions,
                            [item.fieldId]: event.target.value
                          })
                        }
                      >
                        <option value="">请选择答案</option>
                        {item.options.map((option) => (
                          <option key={`${item.fieldId}-${option.value}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={resolutions[item.fieldId] ?? ""}
                        onChange={(event) =>
                          setResolutions({
                            ...resolutions,
                            [item.fieldId]: event.target.value
                          })
                        }
                      />
                    )}
                  </article>
                ))}
                <button
                  type="button"
                  data-testid="save-review-button"
                  className="button button-primary"
                  onClick={() =>
                    saveReviewMutation.mutate({
                      attemptId: selectedAttempt.id,
                      nextResolutions: resolutions
                    })
                  }
                >
                  {saveReviewMutation.isPending ? "保存中..." : "保存确认答案"}
                </button>
              </div>
            ) : null}

            {selectedAttempt.status === "ready_to_fill" ? (
              <button
                type="button"
                data-testid="review-start-button"
                className="button button-primary"
                onClick={() => startMutation.mutate(selectedAttempt.id)}
              >
                {startMutation.isPending
                  ? "启动中..."
                  : getStartButtonLabel(healthQuery.data?.activeAttemptId, selectedAttempt.id)}
              </button>
            ) : null}

            {selectedAttempt.status === "awaiting_manual" ? (
              <div className="workspace-stack">
                <p className="list-card-copy list-card-copy-danger">
                  {selectedAttempt.manualPrompt ??
                    "请先在可见浏览器中完成人工步骤，然后回到这里继续。"}
                </p>
                <button
                  type="button"
                  data-testid="resume-application-button"
                  className="button button-primary"
                  onClick={() => resumeMutation.mutate(selectedAttempt.id)}
                >
                  {resumeMutation.isPending ? "继续中..." : "人工处理后继续"}
                </button>
              </div>
            ) : null}

            {selectedAttempt.status === "awaiting_submit_confirmation" ? (
              <div className="workspace-stack">
                <p className="list-card-copy">
                  {selectedAttempt.submitGateMessage ??
                    "表单已填写完成。请先检查浏览器中的页面，再在准备好时确认最终提交。"}
                </p>
                <button
                  type="button"
                  data-testid="confirm-submit-button"
                  className="button button-primary"
                  onClick={() => confirmSubmitMutation.mutate(selectedAttempt.id)}
                >
                  {confirmSubmitMutation.isPending ? "提交中..." : "确认最终提交"}
                </button>
              </div>
            ) : null}

            {selectedAttempt.status === "prefill_completed" ? (
              <div className="workspace-stack">
                <p className="list-card-copy">
                  {selectedAttempt.submitGateMessage ??
                    "仅预填模式已经完成。请保持真实浏览器页面开启，只有在你确定要正式投递时再启用最终提交。"}
                </p>
                <button
                  type="button"
                  data-testid="enable-final-submit-button"
                  className="button button-primary"
                  onClick={() => enableFinalSubmitMutation.mutate(selectedAttempt.id)}
                >
                  {enableFinalSubmitMutation.isPending ? "启用中..." : "为当前真实会话启用最终提交"}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="workspace-empty">当前没有等待确认的申请项。</div>
        )}
      </div>
    </div>
  );
};
