import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ExecutionMode, Language } from "@qpilot/shared";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { api } from "../lib/api";

const buildModePresets = (
  language: Language
): Record<"general" | "login" | "admin", { goal: string; steps: number }> => ({
  general: {
    goal:
      language === "zh-CN"
        ? "验证核心交互以及页面结果是否符合预期。"
        : "Validate core interactions and expected page outcomes.",
    steps: 16
  },
  login: {
    goal:
      language === "zh-CN"
        ? "验证登录边界场景以及最终成功登录流程。"
        : "Validate login edge cases and the final successful authentication flow.",
    steps: 18
  },
  admin: {
    goal:
      language === "zh-CN"
        ? "检查后台控制台，验证导航路径和可见运营状态。"
        : "Inspect the admin console, verify navigation, and validate visible operational states.",
    steps: 20
  }
});

export const RunCreatePage = () => {
  const { language, pick } = useI18n();
  const navigate = useNavigate();
  const [runLanguage, setRunLanguage] = useState<Language>(language);
  const [runLanguageTouched, setRunLanguageTouched] = useState(false);
  const modePresets = useMemo(() => buildModePresets(runLanguage), [runLanguage]);
  const previousPresetsRef = useRef(modePresets);

  const [projectId, setProjectId] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"general" | "login" | "admin">("general");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("auto_batch");
  const [confirmDraft, setConfirmDraft] = useState(false);
  const [goal, setGoal] = useState(modePresets.general.goal);
  const [maxSteps, setMaxSteps] = useState(modePresets.general.steps);
  const [urlTouched, setUrlTouched] = useState(false);
  const [headed, setHeaded] = useState(true);
  const [manualTakeover, setManualTakeover] = useState(true);
  const [sessionProfile, setSessionProfile] = useState("default");
  const [saveSession, setSaveSession] = useState(true);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects
  });
  const activeRunQuery = useQuery({
    queryKey: ["runtime", "active-run"],
    queryFn: api.getActiveRun,
    refetchInterval: 2000
  });

  const selectedProject = useMemo(
    () => projectsQuery.data?.find((item) => item.id === projectId),
    [projectId, projectsQuery.data]
  );
  const activeRun = activeRunQuery.data?.activeRun ?? null;
  const activeControl = activeRunQuery.data?.control ?? null;

  useEffect(() => {
    if (!runLanguageTouched) {
      setRunLanguage(language);
    }
  }, [language, runLanguageTouched]);

  useEffect(() => {
    const previousPresets = previousPresetsRef.current;
    const wasUsingPreviousPreset = Object.values(previousPresets).some(
      (preset) => preset.goal === goal
    );

    if (wasUsingPreviousPreset) {
      setGoal(modePresets[mode].goal);
    }

    previousPresetsRef.current = modePresets;
  }, [goal, mode, modePresets]);

  useEffect(() => {
    if (!projectsQuery.data || projectsQuery.data.length === 0) {
      return;
    }

    if (!projectId) {
      const firstProject = projectsQuery.data[0];
      if (!firstProject) {
        return;
      }
      setProjectId(firstProject.id);
      setTargetUrl(firstProject.baseUrl);
      setUrlTouched(false);
    }
  }, [projectId, projectsQuery.data]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }

    if (!urlTouched || targetUrl.trim() === "") {
      setTargetUrl(selectedProject.baseUrl);
      return;
    }

    const previousProject = projectsQuery.data?.find((item) => item.baseUrl === targetUrl);
    if (previousProject && previousProject.id !== selectedProject.id) {
      setTargetUrl(selectedProject.baseUrl);
      setUrlTouched(false);
    }
  }, [projectsQuery.data, selectedProject, targetUrl, urlTouched]);

  const runCreateMutation = useMutation({
    mutationFn: api.createRun,
    onSuccess: (run) => {
      navigate(`/runs/${run.id}`);
    },
    onError: () => {
      activeRunQuery.refetch();
    }
  });
  const stopActiveRunMutation = useMutation({
    mutationFn: (runId: string) => api.abortRun(runId),
    onSuccess: () => {
      void activeRunQuery.refetch();
    }
  });

  const effectiveHeaded = headed || manualTakeover;
  const effectiveSaveSession = saveSession || sessionProfile.trim().length > 0;
  const createError =
    runCreateMutation.error instanceof Error ? runCreateMutation.error.message.trim() : "";
  const busyConflict =
    activeRun && activeRun.status === "running"
      ? pick(
          `Runtime is already busy with "${activeRun.goal}". Open that run or stop it before starting a new one.`,
          `当前 runtime 正在执行“${activeRun.goal}”，需要先打开这条 run 或终止它，才能开始新的运行。`
        )
      : "";
  const visibleCreateError =
    createError.length > 0
      ? createError.includes("Runtime is busy with run")
        ? busyConflict || createError
        : createError
      : "";
  const stopError =
    stopActiveRunMutation.error instanceof Error
      ? stopActiveRunMutation.error.message.trim()
      : "";
  const visibleError = stopError || visibleCreateError;

  return (
    <section className="mx-auto max-w-5xl rounded-[30px] border border-slate-200 bg-white/92 p-6 shadow-[0_30px_90px_rgba(15,23,42,0.08)]">
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">
            {pick("Run Composer", "运行编排")}
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-slate-900">
            {pick("Create a live local test run", "创建本地实时测试运行")}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            {pick(
              "This flow now defaults to a visible browser, manual takeover on challenge pages, and reusable session storage so you can keep momentum instead of staring at a black box.",
              "这个流程现在默认启用可见浏览器、挑战页人工接管和可复用会话存储，让你不用再盯着黑盒干等。"
            )}
          </p>
        </div>

        <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(180deg,#f8fbff_0%,#eef5ff_100%)] p-5">
          <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
            {pick("Recommended Setup", "推荐配置")}
          </p>
          <div className="mt-4 space-y-3 text-sm text-slate-700">
            <div className="rounded-2xl border border-slate-200 bg-white/80 p-3">
              <p className="font-medium text-slate-900">{pick("Visible browser", "可见浏览器")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {pick("Lets you watch the real page while the agent works.", "代理执行时，你可以直接看到真实页面。")}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/80 p-3">
              <p className="font-medium text-slate-900">{pick("Manual takeover", "人工接管")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {pick(
                  "Pause on captcha or login walls, solve them yourself, then resume.",
                  "遇到验证码或登录墙时先暂停，你处理完后再继续。"
                )}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/80 p-3">
              <p className="font-medium text-slate-900">{pick("Session reuse", "会话复用")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {pick(
                  "Persist cookies and login state under a named profile for future runs.",
                  "把 cookie 和登录态保存到命名 profile 下，供后续运行复用。"
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      <form
        className="mt-8 space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (activeRun) {
            navigate(`/runs/${activeRun.id}`);
            return;
          }
          runCreateMutation.mutate({
            projectId,
            targetUrl,
            username: username || undefined,
            password: password || undefined,
            mode,
            language: runLanguage,
            goal,
            maxSteps,
            executionMode,
            confirmDraft,
            headed: effectiveHeaded,
            manualTakeover,
            sessionProfile: sessionProfile.trim() || undefined,
            saveSession: effectiveSaveSession
          });
        }}
      >
        {activeRun ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-900">
            <p className="font-medium">
              {pick("A live run is already active.", "当前已经有一条实时运行正在进行中。")}
            </p>
            <p className="mt-1 leading-6">{busyConflict}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate(`/runs/${activeRun.id}`)}
                className="rounded-full border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-900 transition hover:border-amber-500"
              >
                {pick("Open current run", "打开当前 run")}
              </button>
              <button
                type="button"
                onClick={() => stopActiveRunMutation.mutate(activeRun.id)}
                disabled={stopActiveRunMutation.isPending}
                className="rounded-full border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 transition hover:border-rose-400 hover:bg-rose-100"
              >
                {stopActiveRunMutation.isPending
                  ? pick("Stopping current run...", "正在终止当前 run...")
                  : pick("Stop current run", "终止当前 run")}
              </button>
              {activeControl?.phase ? (
                <span className="rounded-full border border-amber-200 bg-white px-3 py-2 text-xs font-medium text-amber-800">
                  {pick(`Phase: ${activeControl.phase}`, `阶段：${activeControl.phase}`)}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {visibleError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50/90 p-4 text-sm text-rose-800">
            {visibleError}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              {pick("Project", "项目")}
            </label>
            <select
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-slate-900"
              value={projectId}
              onChange={(event) => {
                const nextProjectId = event.target.value;
                const nextProject = projectsQuery.data?.find((item) => item.id === nextProjectId);
                setProjectId(nextProjectId);
                if (
                  nextProject &&
                  (!urlTouched || !targetUrl.trim() || targetUrl === selectedProject?.baseUrl)
                ) {
                  setTargetUrl(nextProject.baseUrl);
                  setUrlTouched(false);
                }
              }}
              required
            >
              <option value="">{pick("Select project", "选择项目")}</option>
              {projectsQuery.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              {pick("Mode", "模式")}
            </label>
            <select
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-slate-900"
              value={mode}
              onChange={(event) => {
                const nextMode = event.target.value as "general" | "login" | "admin";
                setMode(nextMode);
                setGoal(modePresets[nextMode].goal);
                setMaxSteps(modePresets[nextMode].steps);
              }}
            >
              <option value="general">{pick("general", "通用")}</option>
              <option value="login">{pick("login", "登录")}</option>
              <option value="admin">{pick("admin", "后台")}</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            {pick("Target URL", "目标 URL")}
          </label>
          <input
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-slate-900"
            value={targetUrl}
            autoComplete="url"
            onChange={(event) => {
              setTargetUrl(event.target.value);
              setUrlTouched(true);
            }}
            placeholder="https://..."
            required
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              {selectedProject
                ? pick(
                    `Saved project URL: ${selectedProject.baseUrl}`,
                    `项目已保存 URL：${selectedProject.baseUrl}`
                  )
                : pick("Select a project to use its saved URL", "选择项目后可使用它保存的 URL")}
            </span>
            {selectedProject ? (
              <button
                type="button"
                onClick={() => {
                  setTargetUrl(selectedProject.baseUrl);
                  setUrlTouched(false);
                }}
                className="rounded-full border border-slate-300 px-3 py-1 font-medium text-slate-600 transition hover:border-slate-900 hover:text-slate-900"
              >
                {pick("Use saved URL", "使用保存的 URL")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-slate-50/90 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">{pick("Execution surface", "执行界面")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {pick(
                  "Tune how visible, recoverable, and stateful this run should be.",
                  "配置这次运行的可见性、可恢复性和状态复用方式。"
                )}
              </p>
            </div>
            <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              {pick("Local-first mode enabled", "已启用本地优先模式")}
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            <label className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{pick("Visible browser", "可见浏览器")}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {pick(
                      "Open a real Chromium window so progress is inspectable.",
                      "打开真实的 Chromium 窗口，便于你直接观察执行进度。"
                    )}
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={effectiveHeaded}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setHeaded(next);
                    if (!next) {
                      setManualTakeover(false);
                    }
                  }}
                />
              </div>
            </label>

            <label className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {pick("Pause for manual takeover", "暂停并人工接管")}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {pick(
                      "Stop on captcha or login walls and let you resume after solving them.",
                      "遇到验证码或登录墙时先停下来，等你处理完再继续。"
                    )}
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={manualTakeover}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setManualTakeover(next);
                    if (next) {
                      setHeaded(true);
                    }
                  }}
                />
              </div>
            </label>

            <label className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{pick("Persist session state", "持久化会话状态")}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {pick(
                      "Save cookies and login state to reuse on the next run.",
                      "保存 cookie 和登录状态，供下次运行复用。"
                    )}
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={effectiveSaveSession}
                  onChange={(event) => setSaveSession(event.target.checked)}
                />
              </div>
            </label>

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-medium text-slate-900">{pick("Run language", "运行语言")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {pick(
                  "Choose the planner and report language for this run independently from the global UI if you want.",
                  "这次 Run 可以单独选择规划与报告的语言，不必完全跟随全局界面。"
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRunLanguage("en");
                    setRunLanguageTouched(true);
                  }}
                  className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
                    runLanguage === "en"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-900"
                  }`}
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRunLanguage("zh-CN");
                    setRunLanguageTouched(true);
                  }}
                  className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
                    runLanguage === "zh-CN"
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-900"
                  }`}
                >
                  简体中文
                </button>
                {runLanguageTouched && runLanguage !== language ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRunLanguage(language);
                      setRunLanguageTouched(false);
                    }}
                    className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-900 hover:text-slate-900"
                  >
                    {pick("Use UI language", "使用界面语言")}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-medium text-slate-900">{pick("Execution mode", "执行模式")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {pick(
                  "Auto Batch runs the full AI plan. Stepwise Replan executes one action, verifies it, and asks AI for the next action from the current page.",
                  "Auto Batch 会连续执行完整 AI 计划，Stepwise Replan 则每次只执行一步、校验，然后基于当前页面重新生成下一步。"
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {([
                  ["auto_batch", pick("Auto Batch", "自动整批执行")],
                  ["stepwise_replan", pick("Stepwise Replan", "单步重规划")]
                ] as Array<[ExecutionMode, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setExecutionMode(value);
                      if (value === "auto_batch") {
                        setConfirmDraft(false);
                      }
                    }}
                    className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
                      executionMode === value
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-900"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <label className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{pick("Approve draft before run", "执行前批准草案")}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {pick(
                      "In Stepwise Replan, pause on each drafted action so you can approve, edit, or skip the next move.",
                      "在单步重规划模式下，每一条草案动作都会先暂停，让你决定批准、修改后执行，还是直接跳过。"
                    )}
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={confirmDraft}
                  disabled={executionMode !== "stepwise_replan"}
                  onChange={(event) => setConfirmDraft(event.target.checked)}
                />
              </div>
            </label>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_220px]">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                {pick("Session Profile", "会话 Profile")}
              </label>
              <input
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-slate-900"
                value={sessionProfile}
                onChange={(event) => setSessionProfile(event.target.value)}
                placeholder="default"
              />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-500">
              {pick(
                "Reuse the same profile name across runs to carry cookies, auth state, and solved login gates forward.",
                "多次运行使用同一个 profile 名称，就能延续 cookie、登录态和已解决的登录关卡。"
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              {pick("Username (optional)", "用户名（可选）")}
            </label>
            <input
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-slate-900"
              value={username}
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              {pick("Password (optional)", "密码（可选）")}
            </label>
            <input
              type="password"
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-slate-900"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        </div>

        <p className="text-xs text-slate-500">
          {pick(
            "Leave username and password empty to use the credentials already saved on the selected project.",
            "如果留空用户名和密码，就会直接使用该项目里已经保存的凭据。"
          )}
        </p>

        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              {pick("Goal", "目标")}
            </label>
            <textarea
              className="h-32 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-slate-900"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              {pick("Max Steps", "最大步数")}
            </label>
            <input
              type="number"
              min={1}
              max={60}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm shadow-sm outline-none transition focus:border-slate-900"
              value={maxSteps}
              onChange={(event) => setMaxSteps(Number(event.target.value))}
            />
            <p className="mt-3 text-xs leading-5 text-slate-500">
              {pick(
                "Keep this tight for fast feedback. The runtime stops once the cap is reached.",
                "建议先把步数控制紧一点，便于快速拿到反馈。达到上限后 runtime 会自动停止。"
              )}
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={runCreateMutation.isPending || !projectId}
          className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {runCreateMutation.isPending
            ? pick("Starting live run...", "正在启动实时运行...")
            : pick("Start Live Run", "开始实时运行")}
        </button>
      </form>
    </section>
  );
};
