import { useState } from "react";
import type { Run } from "@qpilot/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { api, isRuntimeUnavailableError } from "../lib/api";

type PickFn = (english: string, chinese: string) => string;

const statusTone: Record<string, string> = {
  queued: "border-amber-200 bg-amber-50 text-amber-700",
  running: "border-sky-200 bg-sky-50 text-sky-700",
  passed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
  stopped: "border-slate-300 bg-slate-100 text-slate-600"
};

const describeQueryError = (
  error: unknown,
  runtimeBase: string,
  pick: PickFn
): string => {
  if (isRuntimeUnavailableError(error)) {
    return pick(
      `QPilot runtime is unavailable at ${runtimeBase}. Start the runtime service and retry.`,
      `QPilot runtime 当前无法连接：${runtimeBase}。请先启动 runtime 服务后再重试。`
    );
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return pick("Request failed.", "请求失败。");
};

const statusLabel = (status: Run["status"], pick: PickFn): string => {
  switch (status) {
    case "queued":
      return pick("Queued", "排队中");
    case "running":
      return pick("Running", "运行中");
    case "passed":
      return pick("Passed", "已通过");
    case "failed":
      return pick("Failed", "失败");
    case "stopped":
      return pick("Stopped", "已停止");
    default:
      return status;
  }
};

const describeRun = (run: Run, pick: PickFn): string => {
  switch (run.status) {
    case "queued":
      return pick(
        "The run is waiting in the queue before execution starts.",
        "这条运行正在排队，等待开始执行。"
      );
    case "running":
      return pick(
        "The agent is still working on the current page.",
        "代理仍在处理当前页面。"
      );
    case "passed":
      return pick(
        "The run completed successfully.",
        "这条运行已经顺利完成。"
      );
    case "failed":
      return pick(
        "The run stopped with a failure and may need review.",
        "这条运行以失败结束，可能需要回看。"
      );
    case "stopped":
      return pick(
        "The run was stopped before completion.",
        "这条运行在完成前被停止了。"
      );
    default:
      return run.status;
  }
};

const describeProject = (runCount: number, pick: PickFn): string => {
  if (runCount === 0) {
    return pick(
      "No runs yet. Create one when you're ready.",
      "还没有运行，准备好后就可以开始。"
    );
  }

  if (runCount === 1) {
    return pick(
      "This project already has 1 saved run you can revisit.",
      "这个项目已经保存了 1 条运行，可以直接回看。"
    );
  }

  return pick(
    `This project already has ${runCount} saved runs you can reuse.`,
    `这个项目已经保存了 ${runCount} 条运行，可以直接复用。`
  );
};

const getRunTimestamp = (run: Run): number =>
  Date.parse(run.startedAt ?? run.createdAt);

export const ProjectsPage = () => {
  const { formatRelativeTime, pick } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://example.com");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
    retry: false
  });

  const runsQuery = useQuery({
    queryKey: ["runs", "all-projects"],
    queryFn: () => api.listRuns(),
    refetchInterval: 2500,
    retry: false
  });

  const createProjectMutation = useMutation({
    mutationFn: api.createProject,
    onSuccess: () => {
      setName("");
      setBaseUrl("https://example.com");
      setUsername("");
      setPassword("");
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    }
  });

  const projects = projectsQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const sortedRuns = [...runs].sort((left, right) => getRunTimestamp(right) - getRunTimestamp(left));
  const latestRun = sortedRuns[0];
  const runningCount = runs.filter((run) => run.status === "running").length;
  const passedCount = runs.filter((run) => run.status === "passed").length;
  const activeProjectCount = new Set(runs.map((run) => run.projectId)).size;
  const runtimeUnavailable =
    isRuntimeUnavailableError(projectsQuery.error) || isRuntimeUnavailableError(runsQuery.error);

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <aside className="space-y-4">
        <section className="rounded-[28px] border border-slate-200 bg-white p-5">
          <p className="text-[11px] uppercase tracking-[0.32em] text-slate-400">
            {pick("Quick Start", "快速开始")}
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">
            {pick("Start with only two pieces of information", "只填两项就能开始")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {pick(
              "For most cases, a project name and base URL are enough. Credentials can be added now or later.",
              "大多数情况下，只要项目名和基础 URL 就够了。账号密码可以现在填，也可以后面再补。"
            )}
          </p>

          <div className="mt-4 grid gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Step 1", "第 1 步")}
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {pick("Create a reusable project entry", "先创建一个可复用项目")}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Step 2", "第 2 步")}
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {pick("Start a run when you're ready to test", "准备好测试时再开始运行")}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Only if needed", "需要时")}
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {pick("Open live view or report for deeper diagnosis", "只有排障时再看实时页或报告")}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">
            {pick("Create Project", "创建项目")}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {pick(
              "Save the base URL and encrypted credentials for repeated runs.",
              "保存基础 URL 和加密后的凭据，方便后续反复运行。"
            )}
          </p>

          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              createProjectMutation.mutate({
                name,
                baseUrl,
                username: username || undefined,
                password: password || undefined
              });
            }}
          >
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={pick("Project name", "项目名称")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={pick("Base URL", "基础 URL")}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              required
            />
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={pick("Username (optional)", "用户名（可选）")}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <input
              type="password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder={pick("Password (optional)", "密码（可选）")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="submit"
              disabled={createProjectMutation.isPending}
              className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {createProjectMutation.isPending
                ? pick("Creating...", "创建中...")
                : pick("Create Project", "创建项目")}
            </button>
          </form>
        </section>
      </aside>

      <section className="space-y-4">
        {runtimeUnavailable ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>
                {pick(
                  `The local runtime is offline, so projects and runs cannot load. Endpoint: ${api.runtimeBase}`,
                  `本地 runtime 当前离线，项目和运行列表无法加载。接口地址：${api.runtimeBase}`
                )}
              </p>
              <button
                type="button"
                onClick={() => {
                  void projectsQuery.refetch();
                  void runsQuery.refetch();
                }}
                className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900"
              >
                {pick("Retry", "重试")}
              </button>
            </div>
          </div>
        ) : null}

        <section className="rounded-[28px] border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.32em] text-slate-400">
                {pick("Overview", "概览")}
              </p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">
                {pick("See the important signals first", "先看最重要的信号")}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {pick(
                  "How many projects you have, how many runs are still active, and what happened most recently.",
                  "你现在有多少项目、多少运行还在进行中，以及最近一次运行发生了什么。"
                )}
              </p>
            </div>
            <Link
              to="/runs/new"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
            >
              {pick("Start New Run", "开始新运行")}
            </Link>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Projects", "项目数")}
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{projects.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Running", "运行中")}
              </p>
              <p className="mt-2 text-2xl font-semibold text-sky-700">{runningCount}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Passed", "已通过")}
              </p>
              <p className="mt-2 text-2xl font-semibold text-emerald-700">{passedCount}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Active Projects", "有运行记录的项目")}
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{activeProjectCount}</p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {latestRun
              ? pick(
                  `Most recent run: ${latestRun.goal} · ${statusLabel(latestRun.status, pick)} · ${formatRelativeTime(latestRun.startedAt ?? latestRun.createdAt, pick("just now", "刚刚"))}`,
                  `最近一次运行：${latestRun.goal} · ${statusLabel(latestRun.status, pick)} · ${formatRelativeTime(latestRun.startedAt ?? latestRun.createdAt, pick("刚刚", "刚刚"))}`
                )
              : pick(
                  "No recent runs yet. Create a project first, then start a run when you're ready.",
                  "还没有最近运行。先建项目，准备好后再开始运行。"
                )}
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {pick("Projects", "项目")}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {pick(
                  "Each card focuses on whether the project is ready and how much history it already has.",
                  "每张卡片只强调项目是否就绪，以及已经积累了多少历史。"
                )}
              </p>
            </div>
          </div>

          {projectsQuery.isLoading ? (
            <p className="text-sm text-slate-500">
              {pick("Loading projects...", "正在加载项目...")}
            </p>
          ) : projectsQuery.error ? (
            <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              <p>{describeQueryError(projectsQuery.error, api.runtimeBase, pick)}</p>
              <button
                type="button"
                onClick={() => void projectsQuery.refetch()}
                className="rounded-md border border-rose-300 bg-white px-3 py-1 text-xs font-medium text-rose-900"
              >
                {pick("Retry projects", "重试项目加载")}
              </button>
            </div>
          ) : projects.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {projects.map((project) => {
                const projectRuns = sortedRuns.filter((run) => run.projectId === project.id);
                const latestProjectRun = projectRuns[0];

                return (
                  <div
                    key={project.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-slate-900">
                          {project.name}
                        </h3>
                        <p className="mt-1 truncate text-xs text-slate-500">{project.baseUrl}</p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                        {pick(`${projectRuns.length} runs`, `${projectRuns.length} 条运行`)}
                      </span>
                    </div>

                    <p className="mt-3 text-sm text-slate-700">
                      {describeProject(projectRuns.length, pick)}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {latestProjectRun
                        ? pick(
                            `Latest result: ${statusLabel(latestProjectRun.status, pick)} · ${formatRelativeTime(latestProjectRun.startedAt ?? latestProjectRun.createdAt, pick("just now", "刚刚"))}`,
                            `最近结果：${statusLabel(latestProjectRun.status, pick)} · ${formatRelativeTime(latestProjectRun.startedAt ?? latestProjectRun.createdAt, pick("刚刚", "刚刚"))}`
                          )
                        : pick("No runs yet.", "还没有运行记录。")}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              {pick(
                "No projects yet. Create your first project on the left, then come back here to see its history.",
                "还没有项目。先在左侧创建第一个项目，这里就会开始积累它的历史。"
              )}
            </div>
          )}
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-5">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {pick("Recent Runs", "最近运行")}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {pick(
                  "Only the latest conclusion and the entry point are shown here. Open the runs page for everything else.",
                  "这里只展示最近结论和入口，更多历史再去运行页看。"
                )}
              </p>
            </div>
            <Link to="/runs" className="text-xs font-medium text-slate-700 hover:underline">
              {pick("View all", "查看全部")}
            </Link>
          </div>

          {runsQuery.isLoading ? (
            <p className="text-sm text-slate-500">
              {pick("Loading runs...", "正在加载运行...")}
            </p>
          ) : runsQuery.error ? (
            <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              <p>{describeQueryError(runsQuery.error, api.runtimeBase, pick)}</p>
              <button
                type="button"
                onClick={() => void runsQuery.refetch()}
                className="rounded-md border border-rose-300 bg-white px-3 py-1 text-xs font-medium text-rose-900"
              >
                {pick("Retry runs", "重试运行加载")}
              </button>
            </div>
          ) : sortedRuns.length > 0 ? (
            <ul className="space-y-3">
              {sortedRuns.slice(0, 6).map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{run.goal}</p>
                      <span
                        className={`rounded-full border px-3 py-1 text-[11px] font-medium ${
                          statusTone[run.status] ?? "border-slate-300 bg-slate-100 text-slate-600"
                        }`}
                      >
                        {statusLabel(run.status, pick)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{describeRun(run, pick)}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {pick(
                        `Current page: ${run.currentPageTitle ?? run.currentPageUrl ?? run.targetUrl}`,
                        `当前页面：${run.currentPageTitle ?? run.currentPageUrl ?? run.targetUrl}`
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 text-xs text-slate-500">
                    <span>
                      {formatRelativeTime(
                        run.startedAt ?? run.createdAt,
                        pick("just now", "刚刚")
                      )}
                    </span>
                    <Link to={`/runs/${run.id}`} className="text-sky-700 hover:underline">
                      {pick("Open Live", "打开实时页")}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              {pick("No runs yet.", "还没有运行记录。")}
            </div>
          )}
        </section>
      </section>
    </div>
  );
};
