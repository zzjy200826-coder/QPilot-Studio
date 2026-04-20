import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LLMDecision, Run, Step } from "@qpilot/shared";
import { useI18n } from "../i18n/I18nProvider";
import { api } from "../lib/api";

type EvidenceTab = "summary" | "console" | "network" | "dom" | "planner";

interface RunEvidencePanelProps {
  runId: string;
  status: Run["status"] | "idle";
  selectedStep?: Step;
  latestLLM: LLMDecision | null;
}

const prettyJson = (value: unknown): string => JSON.stringify(value, null, 2);

export const RunEvidencePanel = ({
  runId,
  status,
  selectedStep,
  latestLLM
}: RunEvidencePanelProps) => {
  const { formatDateTime, pick } = useI18n();
  const [tab, setTab] = useState<EvidenceTab>("summary");
  const [showAllConsole, setShowAllConsole] = useState(false);
  const [showAllNetwork, setShowAllNetwork] = useState(false);
  const [showPlannerPrompt, setShowPlannerPrompt] = useState(false);
  const [showPlannerResponse, setShowPlannerResponse] = useState(false);
  const [showPlannerJson, setShowPlannerJson] = useState(false);

  const evidenceQuery = useQuery({
    queryKey: ["run", runId, "evidence"],
    queryFn: () => api.getRunEvidence(runId),
    enabled: Boolean(runId),
    refetchInterval: status === "running" ? 2_000 : false
  });

  const evidence = evidenceQuery.data;
  const consoleEntries = evidence?.console ?? [];
  const networkEntries = evidence?.network ?? [];
  const plannerEntries = evidence?.planners ?? [];
  const plannerTrace = useMemo(
    () => plannerEntries[plannerEntries.length - 1],
    [plannerEntries]
  );
  const plannerTraceMode = plannerTrace?.cacheKey?.startsWith("case-template:")
    ? "template"
    : "planner";
  const plannerDecision = latestLLM ?? plannerTrace?.decision ?? null;
  const domRows = selectedStep?.domSummary ?? [];
  const selectedStepNetworkEntries = useMemo(
    () =>
      selectedStep
        ? networkEntries.filter((entry) => entry.stepIndex === selectedStep.index)
        : [],
    [networkEntries, selectedStep]
  );
  const consoleIssues = useMemo(
    () =>
      consoleEntries.filter(
        (entry) =>
          entry.type === "warning" ||
          entry.type === "error" ||
          entry.type === "pageerror"
      ),
    [consoleEntries]
  );
  const networkFailures = useMemo(
    () =>
      networkEntries.filter(
        (entry) => entry.phase === "failed" || entry.ok === false || (entry.status ?? 0) >= 400
      ),
    [networkEntries]
  );
  const visibleConsoleEntries = useMemo(() => {
    const source =
      showAllConsole
        ? consoleEntries
        : consoleIssues.length > 0
          ? consoleIssues
          : consoleEntries.slice(-8);
    return [...source].reverse();
  }, [consoleEntries, consoleIssues, showAllConsole]);
  const visibleNetworkEntries = useMemo(() => {
    const source =
      showAllNetwork
        ? networkEntries
        : selectedStepNetworkEntries.length > 0
          ? selectedStepNetworkEntries.slice(-12)
          : networkFailures.length > 0
            ? networkFailures
            : networkEntries.slice(-10);
    return [...source].reverse();
  }, [networkEntries, networkFailures, selectedStepNetworkEntries, showAllNetwork]);

  const summaryCards = [
    {
      id: "console" as const,
      title: pick("Console", "控制台"),
      headline:
        consoleIssues.length > 0
          ? pick(
              `${consoleIssues.length} warning/error entries need attention.`,
              `发现 ${consoleIssues.length} 条告警或报错。`
            )
          : pick("No obvious browser console issues right now.", "当前没有明显的浏览器控制台异常。"),
      detail:
        consoleIssues[0]?.text ??
        pick(
          "Open this tab only if you need browser-side JavaScript details.",
          "只有当你需要浏览器侧脚本细节时，再打开这个页签。"
        )
    },
    {
      id: "network" as const,
      title: pick("Network", "网络"),
      headline:
        selectedStepNetworkEntries.length > 0
          ? pick(
              `${selectedStepNetworkEntries.length} requests were linked to the selected step.`,
              `当前步骤关联了 ${selectedStepNetworkEntries.length} 个请求。`
            )
          : networkFailures.length > 0
            ? pick(
                `${networkFailures.length} failed requests were captured in this run.`,
                `本次运行里捕获到 ${networkFailures.length} 个失败请求。`
              )
            : pick("No obvious network anomalies are surfaced yet.", "当前还没有明显的网络异常。"),
      detail:
        networkFailures[0]?.failureText ??
        networkFailures[0]?.url ??
        pick(
          "Open this tab only when the human summary is not enough.",
          "只有当人话摘要不够时，再打开这个页签。"
        )
    },
    {
      id: "planner" as const,
      title: pick("Planner", "规划器"),
      headline:
        plannerDecision?.plan.reason ??
        pick("No planner summary has been captured yet.", "当前还没有抓到规划摘要。"),
      detail:
        plannerDecision?.plan.strategy ??
        pick(
          "This tab explains why the model chose the next action.",
          "这个页签主要解释模型为什么选择下一步动作。"
        )
    },
    {
      id: "dom" as const,
      title: pick("DOM Snapshot", "DOM 快照"),
      headline: selectedStep
        ? pick(
            `${domRows.length} interactive elements were saved for step #${selectedStep.index}.`,
            `步骤 #${selectedStep.index} 保存了 ${domRows.length} 个可交互元素。`
          )
        : pick("Select a recorded step before inspecting the DOM.", "请先选中一个已记录步骤，再查看 DOM。"),
      detail: selectedStep
        ? pick(
            "Use this only when you need to inspect selectors or nearby text.",
            "只有当你需要看选择器或附近文本时，再使用这个页签。"
          )
        : pick(
            "The DOM snapshot is a low-level debugging view.",
            "DOM 快照属于偏底层的调试视图。"
          )
    }
  ];

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white/92 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.05)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">
            {pick("Technical Evidence", "技术证据")}
          </p>
          <h3 className="mt-1 text-xl font-semibold text-slate-900">
            {pick("Summary first, raw traces only when needed", "先看摘要，原始痕迹按需展开")}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {pick(
              "This area now starts with a quick read so you do not have to parse raw JSON first.",
              "这个区域现在会先给快速摘要，你不需要一上来就硬啃原始 JSON。"
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
            {pick(`Console ${consoleEntries.length}`, `控制台 ${consoleEntries.length}`)}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
            {pick(`Network ${networkEntries.length}`, `网络 ${networkEntries.length}`)}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
            {pick(`Planner ${plannerEntries.length}`, `规划 ${plannerEntries.length}`)}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {([
          ["summary", pick("Summary", "总览")],
          ["console", pick("Console", "控制台")],
          ["network", pick("Network", "网络")],
          ["dom", pick("DOM", "DOM")],
          ["planner", pick("Planner", "规划器")]
        ] as Array<[EvidenceTab, string]>).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              tab === id
                ? "bg-slate-900 text-white"
                : "border border-slate-300 bg-white text-slate-600 hover:border-slate-900 hover:text-slate-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {evidenceQuery.isLoading ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          {pick("Loading evidence...", "正在加载证据...")}
        </div>
      ) : null}

      {tab === "summary" ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <button
              key={card.id}
              type="button"
              onClick={() => setTab(card.id)}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-900 hover:bg-white"
            >
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{card.title}</p>
              <h4 className="mt-2 text-sm font-semibold text-slate-900">{card.headline}</h4>
              <p className="mt-2 text-sm leading-6 text-slate-600">{card.detail}</p>
            </button>
          ))}
        </div>
      ) : null}

      {tab === "console" ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">
                {consoleIssues.length > 0
                  ? pick("Warnings and errors are shown first.", "当前优先显示告警和报错。")
                  : pick("No obvious console anomalies were found.", "当前没有明显的控制台异常。")}
              </h4>
              <p className="mt-1 text-sm text-slate-600">
                {pick(
                  "Use “show all” only when you need the full browser console history.",
                  "只有需要完整浏览器控制台历史时，再点“显示全部”。"
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAllConsole((value) => !value)}
              className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
            >
              {showAllConsole ? pick("Show focused view", "回到聚焦视图") : pick("Show all", "显示全部")}
            </button>
          </div>
          <div className="max-h-[44vh] space-y-2 overflow-auto pr-1">
            {visibleConsoleEntries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                        entry.type === "error" || entry.type === "pageerror"
                          ? "bg-rose-100 text-rose-700"
                          : entry.type === "warning"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {entry.type}
                    </span>
                    <span className="text-xs text-slate-500">{formatDateTime(entry.ts)}</span>
                  </div>
                  {entry.location ? (
                    <span className="truncate text-xs text-slate-500">{entry.location}</span>
                  ) : null}
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">
                  {entry.text}
                </p>
              </div>
            ))}
            {visibleConsoleEntries.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                {pick("No browser console evidence has been captured yet.", "暂时还没有捕获到浏览器控制台证据。")}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "network" ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">
                {selectedStepNetworkEntries.length > 0
                  ? pick("The selected step has linked requests.", "当前选中步骤已经有关联请求。")
                  : networkFailures.length > 0
                    ? pick("Failed requests are shown first.", "当前优先显示失败请求。")
                    : pick("No obvious network anomalies were found.", "当前没有明显的网络异常。")}
              </h4>
              <p className="mt-1 text-sm text-slate-600">
                {pick(
                  "This tab now prefers step-scoped or failed requests so you can find the issue faster.",
                  "这个页签现在优先展示当前步骤相关或失败的请求，方便更快定位问题。"
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAllNetwork((value) => !value)}
              className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
            >
              {showAllNetwork ? pick("Show focused view", "回到聚焦视图") : pick("Show all", "显示全部")}
            </button>
          </div>
          <div className="max-h-[44vh] space-y-2 overflow-auto pr-1">
            {visibleNetworkEntries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-slate-900 px-2 py-1 font-medium text-white">
                      {entry.method}
                    </span>
                    <span
                      className={`rounded-full px-2 py-1 font-medium ${
                        entry.phase === "failed" || entry.ok === false
                          ? "bg-rose-100 text-rose-700"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {entry.phase === "failed"
                        ? pick("failed", "失败")
                        : entry.status ?? pick("response", "响应")}
                    </span>
                    {entry.resourceType ? (
                      <span className="rounded-full bg-slate-200 px-2 py-1 text-slate-700">
                        {entry.resourceType}
                      </span>
                    ) : null}
                    {entry.stepIndex ? (
                      <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-700">
                        {pick(`Step #${entry.stepIndex}`, `步骤 #${entry.stepIndex}`)}
                      </span>
                    ) : null}
                    <span className="text-slate-500">{formatDateTime(entry.ts)}</span>
                  </div>
                  {entry.failureText ? (
                    <span className="text-xs text-rose-600">{entry.failureText}</span>
                  ) : null}
                </div>
                <p className="mt-2 break-all text-sm text-slate-700">{entry.pathname ?? entry.url}</p>
                {entry.bodyPreview ? (
                  <pre className="mt-2 max-h-24 overflow-auto rounded-xl bg-slate-950 p-3 text-[11px] text-slate-100">
                    {entry.bodyPreview}
                  </pre>
                ) : null}
              </div>
            ))}
            {visibleNetworkEntries.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                {pick("No network evidence yet.", "暂时还没有网络证据。")}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "dom" ? (
        <div className="mt-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">
              {selectedStep
                ? pick(`DOM summary for step #${selectedStep.index}`, `步骤 #${selectedStep.index} 的 DOM 摘要`)
                : pick("DOM summary", "DOM 摘要")}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {pick(
                "Only use this view when you need selectors, nearby text, or frame context.",
                "只有当你需要看选择器、附近文本或 frame 上下文时，再用这个视图。"
              )}
            </p>
          </div>
          <div className="mt-3 max-h-[40vh] space-y-2 overflow-auto pr-1">
            {domRows.map((item, index) => (
              <div
                key={`${item.selector ?? item.id ?? item.tag}-${index}`}
                className="rounded-2xl border border-slate-200 bg-white p-3"
              >
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-slate-900 px-2 py-1 font-medium text-white">
                    {item.tag}
                  </span>
                  {item.type ? (
                    <span className="rounded-full bg-slate-200 px-2 py-1 text-slate-700">
                      {item.type}
                    </span>
                  ) : null}
                  {item.isVisible !== undefined ? (
                    <span className="rounded-full bg-slate-200 px-2 py-1 text-slate-700">
                      {item.isVisible ? pick("visible", "可见") : pick("hidden", "隐藏")}
                    </span>
                  ) : null}
                  {item.contextType ? (
                    <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-700">
                      {item.contextType}
                    </span>
                  ) : null}
                  {item.framePath ? (
                    <span className="rounded-full bg-violet-100 px-2 py-1 text-violet-700">
                      {item.framePath}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 space-y-1 text-sm text-slate-700">
                  {item.selector ? <p>{item.selector}</p> : null}
                  {item.text ? <p>{item.text}</p> : null}
                  {item.contextLabel ? (
                    <p className="text-xs text-slate-500">
                      {pick("Context", "上下文")}: {item.contextLabel}
                    </p>
                  ) : null}
                  {item.nearbyText ? (
                    <p className="text-xs text-slate-500">
                      {pick("Nearby text", "附近文本")}: {item.nearbyText}
                    </p>
                  ) : null}
                  {item.frameTitle ? (
                    <p className="text-xs text-slate-500">
                      {pick("Frame", "框架")}: {item.frameTitle}
                    </p>
                  ) : null}
                  {item.placeholder ? (
                    <p className="text-xs text-slate-500">
                      {pick("Placeholder", "占位符")}: {item.placeholder}
                    </p>
                  ) : null}
                  {item.testId ? <p className="text-xs text-slate-500">testId: {item.testId}</p> : null}
                </div>
              </div>
            ))}
            {domRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                {pick(
                  "Select a recorded step to inspect the saved DOM snapshot.",
                  "请选择一个已记录的步骤来查看保存下来的 DOM 快照。"
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "planner" ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                    {plannerTraceMode === "template"
                      ? pick("Template Match", "模板命中")
                      : pick("Planner Summary", "规划摘要")}
                  </p>
                  <h4 className="mt-2 text-lg font-semibold text-slate-900">
                    {plannerDecision?.plan.reason ??
                      pick("No planner summary has been captured yet.", "当前还没有抓到规划摘要。")}
                  </h4>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {plannerTrace?.cacheHit ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
                      {plannerTraceMode === "template"
                        ? pick("template hit", "模板命中")
                        : pick("cache hit", "缓存命中")}
                    </span>
                  ) : null}
                  {plannerTrace ? (
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                      {formatDateTime(plannerTrace.ts)}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                    {pick("Page Type", "页面类型")}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {plannerDecision?.page_assessment.page_type ?? pick("Unknown", "未知")}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                    {pick("Risk", "风险")}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {plannerDecision?.page_assessment.risk_level ?? pick("Unknown", "未知")}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                    {pick("Actions", "动作数")}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {plannerDecision?.actions.length ?? 0}
                  </p>
                </div>
              </div>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">
                  {pick("Strategy", "策略")}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {plannerDecision?.plan.strategy ??
                    pick("The planner strategy is not available yet.", "当前还没有拿到规划策略。")}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">
                  {pick("Next Actions", "下一步动作")}
                </p>
                <div className="mt-3 space-y-2">
                  {(plannerDecision?.actions ?? []).slice(0, 4).map((action, index) => (
                    <div
                      key={`${action.type}-${action.target ?? action.note ?? index}`}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
                    >
                      <p className="text-sm font-semibold text-slate-900">
                        {pick(`Action ${index + 1}`, `动作 ${index + 1}`)}: {action.type}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {action.note ?? action.target ?? pick("No extra note", "没有补充说明")}
                      </p>
                    </div>
                  ))}
                  {(plannerDecision?.actions.length ?? 0) === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                      {pick("No next actions are available yet.", "当前还没有可展示的下一步动作。")}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">
                  {pick("Expected Checks", "预期校验")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(plannerDecision?.expected_checks ?? []).map((check) => (
                    <span
                      key={check}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-700"
                    >
                      {check}
                    </span>
                  ))}
                  {(plannerDecision?.expected_checks.length ?? 0) === 0 ? (
                    <span className="text-sm text-slate-500">
                      {pick("No explicit checks captured yet.", "当前还没有明确的校验项。")}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <button
              type="button"
              onClick={() => setShowPlannerJson((value) => !value)}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700"
            >
              {showPlannerJson
                ? pick("Hide planner JSON", "收起规划 JSON")
                : pick("Show planner JSON", "显示规划 JSON")}
            </button>
            <button
              type="button"
              onClick={() => setShowPlannerPrompt((value) => !value)}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700"
            >
              {showPlannerPrompt
                ? pick("Hide prompt payload", "收起 prompt")
                : pick("Show prompt payload", "显示 prompt")}
            </button>
            <button
              type="button"
              onClick={() => setShowPlannerResponse((value) => !value)}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700"
            >
              {showPlannerResponse
                ? pick("Hide raw response", "收起原始响应")
                : pick("Show raw response", "显示原始响应")}
            </button>
          </div>

          {showPlannerJson ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-950 p-3">
              <p className="mb-2 text-xs text-slate-400">
                {pick("Planner JSON", "规划 JSON")}
              </p>
              <pre className="max-h-[28vh] overflow-auto text-xs leading-5 text-slate-100">
                {plannerDecision
                  ? prettyJson(plannerDecision)
                  : pick("// Planner JSON will appear here after the first planning cycle.", "// 首轮规划完成后，这里会显示规划 JSON。")}
              </pre>
            </div>
          ) : null}

          {showPlannerPrompt ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-950 p-3">
              <p className="mb-2 text-xs text-slate-400">
                {pick("Prompt payload", "Prompt 载荷")}
              </p>
              <pre className="max-h-[22vh] overflow-auto text-xs leading-5 text-slate-100">
                {plannerTrace?.prompt ??
                  pick("// Prompt payload will appear here after the planner is called.", "// 调用规划器后，这里会显示 prompt 载荷。")}
              </pre>
            </div>
          ) : null}

          {showPlannerResponse ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-950 p-3">
              <p className="mb-2 text-xs text-slate-400">
                {pick("Raw planner response", "原始规划响应")}
              </p>
              <pre className="max-h-[22vh] overflow-auto text-xs leading-5 text-slate-100">
                {plannerTrace?.rawResponse ??
                  pick("// Raw planner response will appear here.", "// 这里会显示规划器的原始响应。")}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};
