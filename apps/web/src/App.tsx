import { Suspense, lazy } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { DesktopControlDock } from "./components/DesktopControlDock";
import { useI18n } from "./i18n/I18nProvider";
import {
  PlatformDensityProvider,
  usePlatformDensity
} from "./platform/PlatformDensity";

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
const RunCreatePage = lazy(() =>
  import("./pages/RunCreatePage").then((module) => ({ default: module.RunCreatePage }))
);
const RunDetailPage = lazy(() =>
  import("./pages/RunDetailPage").then((module) => ({ default: module.RunDetailPage }))
);
const ReportPage = lazy(() =>
  import("./pages/ReportPage").then((module) => ({ default: module.ReportPage }))
);

const platformNavGroups = [
  {
    key: "ops",
    label: { en: "Ops", zh: "Ops" },
    links: [
      { to: "/platform/control", label: { en: "Control Tower", zh: "Control Tower" } },
      { to: "/platform/load", label: { en: "Load Studio", zh: "Load Studio" } },
      { to: "/platform/gates", label: { en: "Gate Center", zh: "Gate Center" } }
    ]
  },
  {
    key: "admin",
    label: { en: "Admin", zh: "Admin" },
    links: [
      { to: "/projects", label: { en: "Projects", zh: "Projects" } },
      {
        to: "/platform/environments",
        label: { en: "Environment Registry", zh: "Environment Registry" }
      }
    ]
  }
] as const;

const auxLinks = [
  { to: "/runs", label: { en: "Runs", zh: "Runs" } },
  { to: "/runs/new", label: { en: "New Run", zh: "New Run" } },
  { to: "/platform", label: { en: "Blueprint", zh: "Blueprint" } }
] as const;

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3 py-1 text-sm font-medium transition ${
    isActive
      ? "bg-slate-900 text-white"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
  }`;

const AppShell = () => {
  const { language, pick, setLanguage } = useI18n();
  const { density, setDensity } = usePlatformDensity();
  const isDesktop =
    typeof window !== "undefined" && Boolean(window.qpilotDesktop?.desktopMode);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_0%_0%,#e0f2fe_0,#f8fafc_38%,#f8fafc_100%)] text-ink">
      <header className="border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-6 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="truncate text-xl font-semibold tracking-tight">QPilot Studio</h1>
                {isDesktop ? (
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.25em] text-sky-700">
                    {pick("Desktop", "Desktop")}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {pick("Local AI test control plane", "Local AI test control plane")}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 shadow-sm">
                <span className="px-2">{pick("Density", "Density")}</span>
                <button
                  type="button"
                  onClick={() => setDensity("comfortable")}
                  className={`rounded-full px-3 py-1 font-medium transition ${
                    density === "comfortable"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {pick("Comfortable", "Comfortable")}
                </button>
                <button
                  type="button"
                  onClick={() => setDensity("dense")}
                  className={`rounded-full px-3 py-1 font-medium transition ${
                    density === "dense"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Dense
                </button>
              </div>

              <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 shadow-sm">
                <span className="px-2">{pick("Language", "Language")}</span>
                <button
                  type="button"
                  onClick={() => setLanguage("en")}
                  className={`rounded-full px-3 py-1 font-medium transition ${
                    language === "en"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage("zh-CN")}
                  className={`rounded-full px-3 py-1 font-medium transition ${
                    language === "zh-CN"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  中文
                </button>
              </div>
            </div>
          </div>

          <nav className="flex flex-wrap items-start gap-3 text-sm text-slate-600">
            {platformNavGroups.map((group) => (
              <div
                key={group.key}
                className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-3 py-2"
              >
                <span className="text-[10px] font-medium uppercase tracking-[0.26em] text-slate-400">
                  {language === "zh-CN" ? group.label.zh : group.label.en}
                </span>
                {group.links.map((link) => (
                  <NavLink key={link.to} to={link.to} className={navLinkClass}>
                    {language === "zh-CN" ? link.label.zh : link.label.en}
                  </NavLink>
                ))}
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-3 py-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.26em] text-slate-400">
                {pick("Flows", "Flows")}
              </span>
              {auxLinks.map((link) => (
                <NavLink key={link.to} to={link.to} className={navLinkClass}>
                  {language === "zh-CN" ? link.label.zh : link.label.en}
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
      </header>

      <main className={`mx-auto max-w-[1440px] px-6 py-6 ${isDesktop ? "pb-28" : ""}`}>
        <Suspense
          fallback={
            <div className="rounded-[28px] border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">
              {pick("Loading workspace...", "Loading workspace...")}
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/runs" element={<RunsPage />} />
            <Route path="/benchmarks/:caseId" element={<BenchmarkScenarioPage />} />
            <Route path="/platform" element={<PlatformBlueprintPage />} />
            <Route path="/platform/control" element={<ControlTowerPage />} />
            <Route path="/platform/load" element={<LoadStudioPage />} />
            <Route path="/platform/load/runs/:runId" element={<LoadRunDetailPage />} />
            <Route path="/platform/environments" element={<EnvironmentPage />} />
            <Route path="/platform/gates" element={<ReleaseGatePage />} />
            <Route path="/runs/new" element={<RunCreatePage />} />
            <Route path="/runs/:runId" element={<RunDetailPage />} />
            <Route path="/reports/:runId" element={<ReportPage />} />
          </Routes>
        </Suspense>
      </main>

      {isDesktop ? <DesktopControlDock /> : null}
    </div>
  );
};

export default function App() {
  return (
    <PlatformDensityProvider>
      <AppShell />
    </PlatformDensityProvider>
  );
}
