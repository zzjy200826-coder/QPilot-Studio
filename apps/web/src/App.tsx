import { Suspense, lazy, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate
} from "react-router-dom";
import { useAuth, AuthProvider } from "./auth/AuthProvider";
import { DesktopControlDock } from "./components/DesktopControlDock";
import { useI18n } from "./i18n/I18nProvider";
import { isMarketingHost } from "./lib/host-routing";
import {
  PlatformDensityProvider,
  usePlatformDensity
} from "./platform/PlatformDensity";

const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((module) => ({ default: module.LoginPage }))
);
const MaintenancePage = lazy(() =>
  import("./pages/MaintenancePage").then((module) => ({ default: module.MaintenancePage }))
);
const ProjectsPage = lazy(() =>
  import("./pages/ProjectsPage").then((module) => ({ default: module.ProjectsPage }))
);
const RunsPage = lazy(() =>
  import("./pages/RunsPage").then((module) => ({ default: module.RunsPage }))
);
const BenchmarkScenarioPage = lazy(() =>
  import("./pages/BenchmarkScenarioPage").then((module) => ({
    default: module.BenchmarkScenarioPage
  }))
);
const PlatformBlueprintPage = lazy(() =>
  import("./pages/PlatformBlueprintPage").then((module) => ({
    default: module.PlatformBlueprintPage
  }))
);
const ControlTowerPage = lazy(() =>
  import("./pages/ControlTowerPage").then((module) => ({
    default: module.ControlTowerPage
  }))
);
const OpsPage = lazy(() =>
  import("./pages/OpsPage").then((module) => ({ default: module.OpsPage }))
);
const BackupsPage = lazy(() =>
  import("./pages/BackupsPage").then((module) => ({ default: module.BackupsPage }))
);
const LoadStudioPage = lazy(() =>
  import("./pages/LoadStudioPage").then((module) => ({ default: module.LoadStudioPage }))
);
const LoadRunDetailPage = lazy(() =>
  import("./pages/LoadRunDetailPage").then((module) => ({
    default: module.LoadRunDetailPage
  }))
);
const EnvironmentPage = lazy(() =>
  import("./pages/EnvironmentPage").then((module) => ({
    default: module.EnvironmentPage
  }))
);
const ReleaseGatePage = lazy(() =>
  import("./pages/ReleaseGatePage").then((module) => ({
    default: module.ReleaseGatePage
  }))
);
const ReleaseDetailPage = lazy(() =>
  import("./pages/ReleaseDetailPage").then((module) => ({
    default: module.ReleaseDetailPage
  }))
);
const RunCreatePage = lazy(() =>
  import("./pages/RunCreatePage").then((module) => ({ default: module.RunCreatePage }))
);
const RunDetailPage = lazy(() =>
  import("./pages/RunDetailPage").then((module) => ({ default: module.RunDetailPage }))
);
const ReportPage = lazy(() =>
  import("./pages/ReportPage").then((module) => ({ default: module.ReportPage }))
);
const MarketingHomePage = lazy(() =>
  import("./pages/MarketingHomePage").then((module) => ({
    default: module.MarketingHomePage
  }))
);

type NavLinkItem = {
  to: string;
  label: { en: string; zh: string };
  description: { en: string; zh: string };
  matchPrefixes?: string[];
  ownerOnly?: boolean;
};

const workspaceNavGroups: Array<{
  key: string;
  label: { en: string; zh: string };
  links: NavLinkItem[];
}> = [
  {
    key: "control",
    label: { en: "Control", zh: "控制" },
    links: [
      {
        to: "/platform/control",
        label: { en: "Control Tower", zh: "指挥台" },
        description: { en: "Release, queue, and infra posture", zh: "发布、队列与基础态势" }
      },
      {
        to: "/platform/load",
        label: { en: "Load Studio", zh: "压测台" },
        description: { en: "Profiles, queue, and capacity checks", zh: "压测配置、队列与容量验证" },
        matchPrefixes: ["/platform/load"]
      },
      {
        to: "/platform/gates",
        label: { en: "Gate Center", zh: "门禁中心" },
        description: { en: "Release verdicts, waivers, approvals", zh: "发布结论、豁免与审批" },
        matchPrefixes: ["/platform/gates", "/platform/releases"]
      }
    ]
  },
  {
    key: "execution",
    label: { en: "Execution", zh: "执行" },
    links: [
      {
        to: "/projects",
        label: { en: "Projects", zh: "项目" },
        description: { en: "Workspace registry and setup", zh: "工作区项目与入口配置" }
      },
      {
        to: "/runs",
        label: { en: "Runs", zh: "运行" },
        description: { en: "Journeys, reports, replay history", zh: "运行、报告与回放历史" },
        matchPrefixes: ["/runs", "/reports", "/benchmarks"]
      },
      {
        to: "/runs/new",
        label: { en: "New Run", zh: "新建运行" },
        description: { en: "Launch an interactive browser run", zh: "启动新的浏览器运行" }
      }
    ]
  },
  {
    key: "infrastructure",
    label: { en: "Infrastructure", zh: "基础设施" },
    links: [
      {
        to: "/platform/ops",
        label: { en: "Ops Summary", zh: "运维摘要" },
        description: { en: "Readiness, alerts, backup health", zh: "就绪状态、告警与备份健康" },
        ownerOnly: true
      },
      {
        to: "/platform/ops/backups",
        label: { en: "Backups", zh: "备份恢复" },
        description: { en: "Snapshots, restore, recovery controls", zh: "快照、恢复与灾备控制" },
        ownerOnly: true
      },
      {
        to: "/platform/environments",
        label: { en: "Environment Registry", zh: "环境注册表" },
        description: { en: "Shared environments and injector pools", zh: "共享环境与执行资源" }
      }
    ]
  },
  {
    key: "blueprint",
    label: { en: "Blueprint", zh: "蓝图" },
    links: [
      {
        to: "/platform",
        label: { en: "Platform Builder", zh: "平台构建器" },
        description: {
          en: "Configure, package, and deploy your control plane",
          zh: "配置、打包并部署你的控制平面"
        }
      }
    ]
  }
];

const findActiveLink = (pathname: string): NavLinkItem | null => {
  for (const group of workspaceNavGroups) {
    for (const link of group.links) {
      const prefixes = [link.to, ...(link.matchPrefixes ?? [])];
      if (prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
        return link;
      }
    }
  }

  return null;
};

const isLinkActive = (pathname: string, link: NavLinkItem): boolean => {
  const prefixes = [link.to, ...(link.matchPrefixes ?? [])];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
};

const LoadingPanel = () => {
  const { pick } = useI18n();

  return (
    <div className="console-panel px-5 py-4 text-sm text-slate-600">
      {pick("Loading workspace...", "正在加载工作区...")}
    </div>
  );
};

const LoginRoute = () => {
  const { status } = useAuth();

  return (
    <Suspense fallback={<LoadingPanel />}>
      {status === "loading" ? (
        <LoadingPanel />
      ) : status === "maintenance" ? (
        <MaintenancePage />
      ) : (
        <LoginPage />
      )}
    </Suspense>
  );
};

const ProtectedWorkspace = () => {
  const { auth, status, logout } = useAuth();
  const { language, pick, setLanguage } = useI18n();
  const { density, setDensity } = usePlatformDensity();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isDesktop =
    typeof window !== "undefined" && Boolean(window.qpilotDesktop?.desktopMode);

  const activeLink = useMemo(() => findActiveLink(location.pathname), [location.pathname]);
  const currentLabel = activeLink
    ? language === "zh-CN"
      ? activeLink.label.zh
      : activeLink.label.en
    : pick("Workspace", "工作区");
  const currentDescription = activeLink
    ? language === "zh-CN"
      ? activeLink.description.zh
      : activeLink.description.en
    : pick("Tenant-scoped AI testing control plane", "租户级 AI 测试控制平面");

  if (status === "loading") {
    return (
      <div className="console-app-frame px-6 py-10">
        <div className="mx-auto max-w-[1640px]">
          <LoadingPanel />
        </div>
      </div>
    );
  }

  if (status === "maintenance") {
    return (
      <Suspense fallback={<LoadingPanel />}>
        <MaintenancePage />
      </Suspense>
    );
  }

  if (status !== "authenticated" || !auth) {
    const redirect = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(redirect || "/projects")}`}
        replace
      />
    );
  }

  const visibleGroups = workspaceNavGroups.map((group) => ({
    ...group,
    links: group.links.filter(
      (link) => !link.ownerOnly || auth.membership.role === "owner"
    )
  }));

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="console-app-frame">
      <a href="#workspace-main" className="skip-link">
        {pick("Skip to main content", "跳到主要内容")}
      </a>

      <div className="mx-auto max-w-[1680px] px-4 py-4 sm:px-6 sm:py-6">
        <div className="relative lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-6">
          <button
            type="button"
            aria-label={pick("Open navigation", "打开导航")}
            onClick={() => setMobileNavOpen(true)}
            className="console-button-secondary mb-4 lg:hidden"
          >
            {pick("Open control rail", "打开控制导航")}
          </button>

          <div
            aria-hidden={!mobileNavOpen}
            onClick={() => setMobileNavOpen(false)}
            className={`fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-[2px] transition ${
              mobileNavOpen ? "opacity-100" : "pointer-events-none opacity-0"
            } lg:hidden`}
          />

          <aside
            className={`console-sidebar fixed inset-y-4 left-4 z-40 flex w-[min(82vw,320px)] flex-col rounded-[32px] p-4 transition-transform duration-200 lg:sticky lg:top-6 lg:z-auto lg:h-[calc(100vh-3rem)] lg:w-auto ${
              mobileNavOpen ? "translate-x-0" : "-translate-x-[115%]"
            } lg:translate-x-0`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 font-data text-sm font-semibold text-white">
                    QP
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-white">QPilot Studio</p>
                    <p className="console-sidebar-muted mt-1 text-xs">
                      {pick("Precision control plane", "精准测试控制台")}
                    </p>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="console-nav-link px-3 py-2 text-xs lg:hidden"
              >
                {pick("Close", "关闭")}
              </button>
            </div>

            <div className="console-context-card mt-5 px-4 py-4 text-sm">
              <p className="font-data text-[11px] uppercase tracking-[0.26em] text-slate-400">
                {pick("Tenant scope", "租户范围")}
              </p>
              <p className="mt-2 truncate text-base font-semibold text-slate-950">{auth.tenant.name}</p>
              <p className="mt-1 truncate text-xs text-slate-500">{auth.user.email}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {isDesktop ? <span className="console-data-pill px-3 py-1 text-[11px] font-medium text-sky-800">{pick("Desktop", "桌面端")}</span> : null}
                <span className="console-data-pill px-3 py-1 font-data text-[11px] uppercase tracking-[0.18em] text-emerald-800">
                  {auth.membership.role}
                </span>
              </div>
            </div>

            <nav className="mt-5 flex-1 space-y-5 overflow-y-auto pr-1">
              {visibleGroups.map((group) => (
                <section key={group.key}>
                  <p className="console-sidebar-muted px-3 font-data text-[11px] uppercase tracking-[0.28em]">
                    {language === "zh-CN" ? group.label.zh : group.label.en}
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {group.links.map((link) => {
                      const active = isLinkActive(location.pathname, link);
                      return (
                        <Link
                          key={link.to}
                          to={link.to}
                          onClick={() => setMobileNavOpen(false)}
                          className={`console-nav-link flex items-start gap-3 px-3 py-3 ${
                            active ? "console-nav-link-active" : ""
                          }`}
                        >
                          <span
                            className={`mt-0.5 h-2.5 w-2.5 rounded-full ${
                              active ? "bg-sky-300" : "bg-slate-500/70"
                            }`}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">
                              {language === "zh-CN" ? link.label.zh : link.label.en}
                            </span>
                            <span className="mt-1 block text-xs text-slate-300/75">
                              {language === "zh-CN" ? link.description.zh : link.description.en}
                            </span>
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
            </nav>

            <div className="console-sidebar-divider mt-4 border-t pt-4">
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="console-nav-link flex w-full items-center justify-between px-3 py-3 text-sm"
              >
                <span>{pick("Sign out", "退出登录")}</span>
                <span className="font-data text-[11px] uppercase tracking-[0.22em] text-slate-300/70">
                  ESC
                </span>
              </button>
            </div>
          </aside>

          <div className={`min-w-0 ${isDesktop ? "pb-28" : ""}`}>
            <header className="console-topbar rounded-[30px] px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <p className="font-data text-[11px] uppercase tracking-[0.28em] text-slate-400">
                    {pick("Current workspace surface", "当前工作台")}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-[1.9rem] font-semibold tracking-tight text-slate-950">
                      {currentLabel}
                    </h1>
                    <span className="console-data-pill px-3 py-1 text-[11px] font-medium text-slate-600">
                      {pick("Tenant-scoped", "租户隔离")}
                    </span>
                  </div>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                    {currentDescription}
                  </p>
                </div>

                <div className="flex flex-col gap-3 xl:items-end">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="console-context-card flex items-center gap-2 px-2 py-2 text-xs text-slate-500">
                      <span className="px-2">{pick("Density", "密度")}</span>
                      <button
                        type="button"
                        onClick={() => setDensity("comfortable")}
                        className={`rounded-full px-3 py-1.5 font-medium transition ${
                          density === "comfortable"
                            ? "bg-slate-950 text-white"
                            : "text-slate-600 hover:text-slate-950"
                        }`}
                      >
                        {pick("Comfortable", "舒适")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDensity("dense")}
                        className={`rounded-full px-3 py-1.5 font-medium transition ${
                          density === "dense"
                            ? "bg-slate-950 text-white"
                            : "text-slate-600 hover:text-slate-950"
                        }`}
                      >
                        {pick("Dense", "紧凑")}
                      </button>
                    </div>

                    <div className="console-context-card flex items-center gap-2 px-2 py-2 text-xs text-slate-500">
                      <span className="px-2">{pick("Language", "语言")}</span>
                      <button
                        type="button"
                        onClick={() => setLanguage("en")}
                        className={`rounded-full px-3 py-1.5 font-medium transition ${
                          language === "en"
                            ? "bg-slate-950 text-white"
                            : "text-slate-600 hover:text-slate-950"
                        }`}
                      >
                        EN
                      </button>
                      <button
                        type="button"
                        onClick={() => setLanguage("zh-CN")}
                        className={`rounded-full px-3 py-1.5 font-medium transition ${
                          language === "zh-CN"
                            ? "bg-slate-950 text-white"
                            : "text-slate-600 hover:text-slate-950"
                        }`}
                      >
                        中文
                      </button>
                    </div>

                    <Link to="/runs/new" className="console-button-primary text-sm">
                      {pick("Launch Run", "发起运行")}
                    </Link>
                  </div>

                  <div className="console-context-card px-4 py-3 text-right">
                    <p className="text-sm font-semibold text-slate-900">
                      {auth.user.displayName || auth.user.email}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {auth.tenant.name} 路 {auth.user.email}
                    </p>
                  </div>
                </div>
              </div>
            </header>

            <main
              id="workspace-main"
              className="console-workspace mt-4 rounded-[30px] border border-white/50 bg-white/28 p-3 backdrop-blur-[2px] sm:p-4"
            >
              <Suspense fallback={<LoadingPanel />}>
                <Outlet />
              </Suspense>
            </main>
          </div>
        </div>
      </div>

      {isDesktop ? <DesktopControlDock /> : null}
    </div>
  );
};

export default function App() {
  const renderMarketingSite =
    typeof window !== "undefined" && isMarketingHost(window.location.host);

  if (renderMarketingSite) {
    return (
      <Routes>
        <Route
          path="*"
          element={
            <Suspense fallback={<LoadingPanel />}>
              <MarketingHomePage />
            </Suspense>
          }
        />
      </Routes>
    );
  }

  return (
    <PlatformDensityProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route element={<ProtectedWorkspace />}>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/runs" element={<RunsPage />} />
            <Route path="/benchmarks/:caseId" element={<BenchmarkScenarioPage />} />
            <Route path="/platform" element={<PlatformBlueprintPage />} />
            <Route path="/platform/control" element={<ControlTowerPage />} />
            <Route path="/platform/ops" element={<OpsPage />} />
            <Route path="/platform/ops/backups" element={<BackupsPage />} />
            <Route path="/platform/load" element={<LoadStudioPage />} />
            <Route path="/platform/load/runs/:runId" element={<LoadRunDetailPage />} />
            <Route path="/platform/environments" element={<EnvironmentPage />} />
            <Route path="/platform/gates" element={<ReleaseGatePage />} />
            <Route path="/platform/releases/:releaseId" element={<ReleaseDetailPage />} />
            <Route path="/runs/new" element={<RunCreatePage />} />
            <Route path="/runs/:runId" element={<RunDetailPage />} />
            <Route path="/reports/:runId" element={<ReportPage />} />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </PlatformDensityProvider>
  );
}
