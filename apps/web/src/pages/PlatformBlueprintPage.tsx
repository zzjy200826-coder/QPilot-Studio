import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";

type PickFn = (english: string, chinese: string) => string;

type CapabilityCard = {
  title: string;
  summary: string;
  status: "existing" | "missing" | "next";
};

type PlatformLane = {
  eyebrow: string;
  title: string;
  summary: string;
  bullets: string[];
};

type ArchitectureLayer = {
  title: string;
  summary: string;
  items: string[];
};

const toneClass = (status: CapabilityCard["status"]): string => {
  switch (status) {
    case "existing":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "next":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-800";
  }
};

const statusLabel = (status: CapabilityCard["status"], pick: PickFn): string => {
  switch (status) {
    case "existing":
      return pick("Already In Product", "当前已有");
    case "next":
      return pick("Recommended Next", "下一步优先");
    default:
      return pick("Missing For Platform", "平台级仍缺");
  }
};

export const PlatformBlueprintPage = () => {
  const { pick } = useI18n();

  const capabilityCards = useMemo<CapabilityCard[]>(
    () => [
      {
        title: pick("AI browser functional runs", "AI 浏览器功能回归"),
        summary: pick(
          "The current product already owns browser execution, evidence capture, human diagnosis, replay, benchmark scenarios, rerun, and diff.",
          "当前产品已经具备浏览器执行、证据采集、人话诊断、回放、benchmark 场景、重跑和 diff。"
        ),
        status: "existing"
      },
      {
        title: pick("Load and capacity studio", "压测与容量工作台"),
        summary: pick(
          "This is the biggest platform gap. There is no load profile, no traffic injector pool, no SLA view, and no release gate across concurrency levels yet.",
          "这是当前离整套测试平台最远的一块：还没有负载配置、压测执行池、SLA 看板和并发级别的发布门禁。"
        ),
        status: "missing"
      },
      {
        title: pick("Unified release gate", "统一发布门禁"),
        summary: pick(
          "The next product milestone should join functional, benchmark, and load signals into one release verdict instead of leaving them as separate pages.",
          "下一阶段最值得做的是把功能、benchmark、压测信号合成一套统一发布结论，而不是散落在不同页面。"
        ),
        status: "next"
      }
    ],
    [pick]
  );

  const platformLanes = useMemo<PlatformLane[]>(
    () => [
      {
        eyebrow: pick("1. Control Tower", "1. 控制塔"),
        title: pick("Single place to see risk before release", "发布前统一看风险的总控台"),
        summary: pick(
          "One dashboard should answer: did the core user flows pass, did benchmarks regress, did service latency hold, and can this build ship.",
          "总控台要回答四件事：核心用户路径过没过、benchmark 有没有回归、服务延迟稳不稳、这版能不能发。"
        ),
        bullets: [
          pick("Release readiness score with fail-open and fail-close rules", "发布就绪分数，支持 fail-open / fail-close 规则"),
          pick("Cross-module health strip: functional, benchmark, load, reliability", "跨模块健康带：功能、benchmark、压测、稳定性"),
          pick("One-click jump into the failing scenario, API, or environment", "一键跳进失败场景、接口或环境")
        ]
      },
      {
        eyebrow: pick("2. Functional Lab", "2. 功能实验室"),
        title: pick("Browser journeys, login chains, and guided repair", "浏览器链路、登录流程和修复闭环"),
        summary: pick(
          "This is your current strongest area and should remain the product anchor rather than being diluted by generic load dashboards.",
          "这是你现在最强的能力，应该继续做成平台锚点，而不是被泛化压测面板稀释掉。"
        ),
        bullets: [
          pick("Run live detail, report, rerun, compare, benchmark scenario cockpit", "实时详情、报告、重跑、对比、benchmark 场景工作台"),
          pick("Template extraction, replay, repair draft, manual takeover", "模板提取、回放、修复草案、人工接管"),
          pick("Structured stage and memory for planner, refiner, verifier, halt", "规划、收敛、验证、停机共享的结构化 stage/memory")
        ]
      },
      {
        eyebrow: pick("3. Load Studio", "3. 压测工作台"),
        title: pick("Capacity, latency, and degradation under traffic", "并发、延迟和退化行为的专属工作台"),
        summary: pick(
          "Load should become a first-class citizen with scenario profiles, environment targeting, injector pools, SLO assertions, and replayable evidence.",
          "压测要成为一等公民：有场景配置、环境选择、压测执行池、SLO 断言和可复盘证据。"
        ),
        bullets: [
          pick("Profile builder: ramp-up, steady-state, spike, soak, breakpoint search", "压测配置器：爬坡、稳态、突刺、耐久、拐点搜索"),
          pick("Engine adapters: k6 for API load, Playwright micro-browser load, synthetic workflow mix", "执行引擎适配：k6 API 压测、Playwright 微量浏览器压测、混合工作流"),
          pick("SLO views: p50/p95/p99, error rate, saturation, business throughput", "SLO 视图：p50/p95/p99、错误率、饱和度、业务吞吐")
        ]
      },
      {
        eyebrow: pick("4. Gate Center", "4. 门禁中心"),
        title: pick("Turn evidence into release decisions", "把证据转成发布决策"),
        summary: pick(
          "A real test platform should end in a verdict, not just in a report. Gate Center is where checks, thresholds, waivers, and approvals meet.",
          "真正的平台不是停在报告，而是落到结论。门禁中心要把检查、阈值、豁免和审批汇在一起。"
        ),
        bullets: [
          pick("Policy packs by product area, environment, and release ring", "按产品线、环境、发布环分层的门禁策略包"),
          pick("Waiver workflow with audit trail and expiration", "带审计轨迹和到期时间的豁免流程"),
          pick("Webhook, CI, and issue-tracker outputs for actionability", "连接 CI、Webhook、缺陷系统，直接可执行")
        ]
      }
    ],
    [pick]
  );

  const architectureLayers = useMemo<ArchitectureLayer[]>(
    () => [
      {
        title: pick("Experience Layer", "体验层"),
        summary: pick(
          "Keep one surface, but split the jobs clearly: control tower, functional lab, benchmark cockpit, load studio, evidence hub, gate center.",
          "保持一个产品入口，但把职责拆清：控制塔、功能实验室、benchmark 工作台、压测工作台、证据中心、门禁中心。"
        ),
        items: [
          pick("React web console and desktop cockpit", "React Web 控制台和桌面 cockpit"),
          pick("Role-based entry views for QA, dev, release manager", "按 QA、研发、发布负责人分角色视图"),
          pick("Scenario, service, and release-centric navigation", "按场景、服务、发布三种视角导航")
        ]
      },
      {
        title: pick("Control Plane", "控制面"),
        summary: pick(
          "This becomes the orchestration brain across all test types instead of only browser runs.",
          "控制面要从“浏览器 run 调度器”升级成“全类型测试编排器”。"
        ),
        items: [
          pick("Scheduler and queue for functional, benchmark, and load jobs", "统一调度功能、benchmark、压测任务的队列"),
          pick("Scenario registry with versioned templates and load profiles", "带版本的场景注册表，包含模板和压测配置"),
          pick("Policy engine for SLO, release gates, and environment rules", "SLO、发布门禁、环境规则的策略引擎")
        ]
      },
      {
        title: pick("Execution Plane", "执行面"),
        summary: pick(
          "Do not force one engine to solve every problem. The platform should run browser, API, and load engines side by side.",
          "不要让一个执行器包打天下。浏览器、API、压测要并行成为不同执行平面。"
        ),
        items: [
          pick("Browser agent runtime for real user journeys", "真实用户链路的浏览器 agent runtime"),
          pick("API and synthetic runners for fast checks and contract probes", "快速检查和契约探测的 API / synthetic runner"),
          pick("Load injectors and distributed worker pools for scale tests", "用于规模压测的 injector 和分布式 worker 池")
        ]
      },
      {
        title: pick("Evidence and Metrics Plane", "证据与指标面"),
        summary: pick(
          "A platform needs both forensic evidence and time-series metrics. Today you mostly own the first half.",
          "整套平台既要取证能力，也要时间序列指标。你现在已经有前半部分，后半部分要补上。"
        ),
        items: [
          pick("Artifacts: screenshot, video, DOM summary, step diff, report", "制品：截图、录像、DOM 摘要、step diff、报告"),
          pick("Metrics TSDB for latency, throughput, error, saturation, Apdex", "时间序列指标库：延迟、吞吐、错误、饱和度、Apdex"),
          pick("Correlation graph between runs, services, deploys, and incidents", "把 run、服务、发布、事故串起来的关联图")
        ]
      }
    ],
    [pick]
  );

  const roadmap = useMemo(
    () => [
      {
        phase: pick("Phase 1", "阶段 1"),
        title: pick("Load Studio MVP", "压测工作台 MVP"),
        detail: pick(
          "Add load profile CRUD, k6 adapter, run history, metric charts, and a release summary page.",
          "先补压测配置管理、k6 适配器、运行历史、指标图表和基础发布摘要页。"
        )
      },
      {
        phase: pick("Phase 2", "阶段 2"),
        title: pick("Unified release gate", "统一发布门禁"),
        detail: pick(
          "Join functional verdicts, benchmark regressions, and load SLO failures into one gate model.",
          "把功能通过率、benchmark 回归和压测 SLO 一起汇成统一门禁模型。"
        )
      },
      {
        phase: pick("Phase 3", "阶段 3"),
        title: pick("Environment and service map", "环境与服务地图"),
        detail: pick(
          "Track dependencies, release rings, service ownership, and blast radius across environments.",
          "把环境、依赖服务、负责人、发布环和影响范围一起建模。"
        )
      },
      {
        phase: pick("Phase 4", "阶段 4"),
        title: pick("Enterprise packaging", "企业级包装"),
        detail: pick(
          "Add audit log, approval workflow, RBAC, webhook, CI bridge, and private deployment story.",
          "最后补审计日志、审批流、RBAC、Webhook、CI 集成和私有化部署方案。"
        )
      }
    ],
    [pick]
  );

  return (
    <section className="space-y-6">
      <div className="rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_35%),linear-gradient(135deg,#ffffff,#f8fafc)] p-6 shadow-sm">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_420px]">
          <div>
            <p className="text-[11px] uppercase tracking-[0.34em] text-slate-400">
              {pick("Testing Platform Blueprint", "测试平台蓝图")}
            </p>
            <h2 className="mt-3 max-w-4xl text-3xl font-semibold tracking-tight text-slate-950">
              {pick(
                "Turn QPilot from a browser QA agent into a full testing control tower with functional, benchmark, and load intelligence.",
                "把 QPilot 从浏览器 QA Agent 升级成一套覆盖功能、benchmark 和压测的统一测试控制塔。"
              )}
            </h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">
              {pick(
                "The key product move is not to bolt on a generic load chart. It is to let every release answer one question in one place: are the flows correct, are they stable, and are they still safe under traffic.",
                "关键不是再拼一个通用压测面板，而是让每次发布都能在一个地方回答：链路对不对、最近稳不稳、上量之后还能不能扛住。"
              )}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {capabilityCards.map((card) => (
                <span
                  key={card.title}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${toneClass(card.status)}`}
                >
                  {statusLabel(card.status, pick)}
                </span>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                to="/platform/load"
                className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                {pick("Open Load Studio", "进入压测工作台")}
              </Link>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white/80 p-5 backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
              {pick("Platform North Star", "平台北极星")}
            </p>
            <div className="mt-4 grid gap-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-3xl font-semibold text-slate-950">1</p>
                <p className="mt-2 text-sm text-slate-600">
                  {pick(
                    "One release verdict per build, not five unrelated reports.",
                    "每个构建只给一个发布结论，而不是五份互不相干的报告。"
                  )}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-3xl font-semibold text-slate-950">3</p>
                <p className="mt-2 text-sm text-slate-600">
                  {pick(
                    "Three core signals in one graph: correctness, stability, capacity.",
                    "把正确性、稳定性、容量三类信号统一进一张图。"
                  )}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-3xl font-semibold text-slate-950">0</p>
                <p className="mt-2 text-sm text-slate-600">
                  {pick(
                    "Zero blind spots between user journey failures and service bottlenecks.",
                    "用户链路失败和服务瓶颈之间不再出现盲区。"
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {capabilityCards.map((card) => (
          <article key={card.title} className="rounded-[28px] border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-slate-900">{card.title}</h3>
              <span className={`rounded-full border px-3 py-1 text-[11px] font-medium ${toneClass(card.status)}`}>
                {statusLabel(card.status, pick)}
              </span>
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-600">{card.summary}</p>
          </article>
        ))}
      </div>

      <div className="rounded-[32px] border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
              {pick("Proposed Product IA", "建议中的产品信息架构")}
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-950">
              {pick("Five lanes, one testing platform", "五条产品主线，组成一套测试平台")}
            </h3>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600">
            {pick("Current product maps mostly to lane 2 and part of lane 1", "当前产品主要落在第 2 条线，以及第 1 条线的一部分")}
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {platformLanes.map((lane) => (
            <article key={lane.title} className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{lane.eyebrow}</p>
              <h4 className="mt-2 text-lg font-semibold text-slate-900">{lane.title}</h4>
              <p className="mt-3 text-sm leading-7 text-slate-600">{lane.summary}</p>
              <div className="mt-4 space-y-2">
                {lane.bullets.map((bullet) => (
                  <div key={bullet} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    {bullet}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_380px]">
        <div className="rounded-[32px] border border-slate-200 bg-white p-6">
          <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
            {pick("Platform Architecture", "平台架构")}
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-slate-950">
            {pick("Add a load tool as a new execution plane, not as a disconnected sidecar", "把压测能力做成新的执行平面，而不是一个孤立外挂")}
          </h3>
          <div className="mt-5 space-y-4">
            {architectureLayers.map((layer) => (
              <article key={layer.title} className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h4 className="text-lg font-semibold text-slate-900">{layer.title}</h4>
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-600">{layer.summary}</p>
                <div className="mt-4 grid gap-2 md:grid-cols-3">
                  {layer.items.map((item) => (
                    <div key={item} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                      {item}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
              {pick("Load Tool Recommendation", "压测工具建议")}
            </p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">
              {pick("Use a pluggable load engine instead of baking everything into Playwright", "压测部分建议做成可插拔引擎，而不是全塞进 Playwright")}
            </h3>
            <div className="mt-4 space-y-3 text-sm leading-7 text-slate-600">
              <p>
                {pick(
                  "k6 should be the primary API and service load engine because it is cheap to run, scriptable, and easy to distribute.",
                  "k6 适合作为 API 与服务压测的主引擎，成本低、脚本化强、分布式扩展也简单。"
                )}
              </p>
              <p>
                {pick(
                  "Playwright browser load should stay as a low-concurrency realism probe for critical user journeys, not as the main high-volume injector.",
                  "Playwright 浏览器压测更适合作为低并发但高真实性的链路探针，不应该承担高体量主压测。"
                )}
              </p>
              <p>
                {pick(
                  "The platform should unify results from both, then decide release gates at the policy layer.",
                  "平台层负责把两种结果汇总，再在策略层做发布门禁。"
                )}
              </p>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5">
            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
              {pick("What Needs To Be Built", "需要新增的核心能力")}
            </p>
            <div className="mt-4 space-y-2">
              {[
                pick("Load profile schema and scenario registry", "压测 profile schema 和场景注册表"),
                pick("Distributed injector pool and job orchestration", "分布式 injector 池和任务编排"),
                pick("Metrics store and SLO evaluation engine", "指标存储和 SLO 评估引擎"),
                pick("Release gate policies across test types", "跨测试类型的发布门禁策略"),
                pick("Environment-aware service topology and ownership mapping", "带环境语义的服务拓扑与负责人映射")
              ].map((item) => (
                <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <div className="rounded-[32px] border border-slate-200 bg-white p-6">
        <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
          {pick("Delivery Roadmap", "交付路线")}
        </p>
        <h3 className="mt-2 text-2xl font-semibold text-slate-950">
          {pick("Build the platform in four product phases", "分四个产品阶段把平台做完整")}
        </h3>
        <div className="mt-5 grid gap-4 xl:grid-cols-4">
          {roadmap.map((item) => (
            <article key={item.phase} className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{item.phase}</p>
              <h4 className="mt-2 text-lg font-semibold text-slate-900">{item.title}</h4>
              <p className="mt-3 text-sm leading-7 text-slate-600">{item.detail}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};
