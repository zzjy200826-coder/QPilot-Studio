import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { PlatformAdvancedPanel } from "../platform/PlatformAdvancedPanel";
import { PlatformFormField } from "../platform/PlatformFormField";
import { PlatformMetricCard } from "../platform/PlatformMetricCard";
import { PlatformPageShell } from "../platform/PlatformPageShell";
import { PlatformSectionHeader } from "../platform/PlatformSectionHeader";

type PickFn = (english: string, chinese: string) => string;

type BuilderPreset = "internal-qa" | "release-readiness" | "full-control-plane";
type DeploymentMode = "single-host-ssh" | "internal-preview" | "private-prod";
type AccentTone = "sky" | "emerald" | "rose";
type ModuleKey =
  | "functional"
  | "benchmark"
  | "load"
  | "gates"
  | "ops"
  | "backups"
  | "environments"
  | "desktop";

type BuilderState = {
  preset: BuilderPreset;
  platformName: string;
  shortName: string;
  industry: string;
  tagline: string;
  tenantName: string;
  domain: string;
  host: string;
  sshUser: string;
  repoUrl: string;
  gitRef: string;
  certEmail: string;
  deploymentMode: DeploymentMode;
  accent: AccentTone;
  modules: ModuleKey[];
  metricsEnabled: boolean;
  alertsEnabled: boolean;
  backupsEnabled: boolean;
  desktopEnabled: boolean;
};

type ModuleDefinition = {
  key: ModuleKey;
  title: { en: string; zh: string };
  summary: { en: string; zh: string };
  lane: { en: string; zh: string };
};

type PresetDefinition = {
  key: BuilderPreset;
  title: { en: string; zh: string };
  summary: { en: string; zh: string };
  config: BuilderState;
};

type GeneratedBundle = {
  manifestJson: string;
  envTemplate: string;
  bootstrapCommand: string;
  updateCommand: string;
  smokeCommand: string;
};

const builderStorageKey = "qpilot:platform-builder-v1";

const moduleCatalog: ModuleDefinition[] = [
  {
    key: "functional",
    title: { en: "Functional Lab", zh: "功能实验室" },
    summary: {
      en: "Interactive browser runs, evidence capture, replay, and repair.",
      zh: "交互式浏览器运行、证据采集、回放与修复。"
    },
    lane: { en: "Execution", zh: "执行" }
  },
  {
    key: "benchmark",
    title: { en: "Benchmark Cockpit", zh: "基准驾驶舱" },
    summary: {
      en: "Scenario comparison, regression checks, and case baselines.",
      zh: "场景对比、回归检查与基准基线。"
    },
    lane: { en: "Execution", zh: "执行" }
  },
  {
    key: "load",
    title: { en: "Load Studio", zh: "压测工作台" },
    summary: {
      en: "Profiles, injector pools, capacity runs, and SLO evidence.",
      zh: "压测配置、注入池、容量运行与 SLO 证据。"
    },
    lane: { en: "Control", zh: "控制" }
  },
  {
    key: "gates",
    title: { en: "Gate Center", zh: "门禁中心" },
    summary: {
      en: "Release verdicts, approvals, waivers, and policy packs.",
      zh: "发布结论、审批、豁免与策略包。"
    },
    lane: { en: "Control", zh: "控制" }
  },
  {
    key: "ops",
    title: { en: "Ops Summary", zh: "运维总览" },
    summary: {
      en: "Readiness, dependencies, alerts, and backup health.",
      zh: "就绪状态、依赖、告警与备份健康。"
    },
    lane: { en: "Infrastructure", zh: "基础设施" }
  },
  {
    key: "backups",
    title: { en: "Backup Recovery", zh: "备份恢复" },
    summary: {
      en: "Snapshot control, restore preflight, and recovery windows.",
      zh: "快照控制、恢复预检与维护窗口。"
    },
    lane: { en: "Infrastructure", zh: "基础设施" }
  },
  {
    key: "environments",
    title: { en: "Environment Registry", zh: "环境注册" },
    summary: {
      en: "Targets, topology, service map, and injector assignment.",
      zh: "目标环境、拓扑、服务地图与注入分配。"
    },
    lane: { en: "Infrastructure", zh: "基础设施" }
  },
  {
    key: "desktop",
    title: { en: "Desktop Companion", zh: "桌面伴随端" },
    summary: {
      en: "Operator shortcuts, run control dock, and local pairing mode.",
      zh: "操作快捷入口、运行控制坞与本地协作模式。"
    },
    lane: { en: "Blueprint", zh: "蓝图" }
  }
];

const presetCatalog: PresetDefinition[] = [
  {
    key: "internal-qa",
    title: { en: "Internal QA Platform", zh: "内部 QA 平台" },
    summary: {
      en: "Fastest path for teams that mainly need browser runs, reports, and environments.",
      zh: "适合主要关注浏览器运行、报告和环境管理的团队。"
    },
    config: {
      preset: "internal-qa",
      platformName: "QPilot QA Console",
      shortName: "QQC",
      industry: "Internal tooling",
      tagline: "Fast browser validation, replay, and evidence in one internal workspace.",
      tenantName: "Delivery Team",
      domain: "qa.yourcompany.com",
      host: "203.0.113.10",
      sshUser: "ubuntu",
      repoUrl: "git@github.com:your-org/QPilot-Studio.git",
      gitRef: "main",
      certEmail: "ops@yourcompany.com",
      deploymentMode: "internal-preview",
      accent: "sky",
      modules: ["functional", "benchmark", "environments", "ops"],
      metricsEnabled: true,
      alertsEnabled: false,
      backupsEnabled: false,
      desktopEnabled: false
    }
  },
  {
    key: "release-readiness",
    title: { en: "Release Readiness Hub", zh: "发布就绪中枢" },
    summary: {
      en: "Best when your goal is one release verdict combining runs, regressions, and approvals.",
      zh: "适合需要把运行结果、回归与审批汇成一个发布结论的团队。"
    },
    config: {
      preset: "release-readiness",
      platformName: "QPilot Release Hub",
      shortName: "QRH",
      industry: "SaaS / B2B delivery",
      tagline: "One release command surface for verdicts, blockers, waivers, and evidence.",
      tenantName: "Release Office",
      domain: "release.yourcompany.com",
      host: "203.0.113.20",
      sshUser: "ubuntu",
      repoUrl: "git@github.com:your-org/QPilot-Studio.git",
      gitRef: "main",
      certEmail: "release-ops@yourcompany.com",
      deploymentMode: "single-host-ssh",
      accent: "emerald",
      modules: ["functional", "benchmark", "gates", "ops", "backups", "environments"],
      metricsEnabled: true,
      alertsEnabled: true,
      backupsEnabled: true,
      desktopEnabled: false
    }
  },
  {
    key: "full-control-plane",
    title: { en: "Full Testing Control Plane", zh: "完整测试控制平面" },
    summary: {
      en: "The most complete package: browser, benchmark, load, gates, ops, and recovery.",
      zh: "最完整的一套：浏览器、基准、压测、门禁、运维和恢复全部接入。"
    },
    config: {
      preset: "full-control-plane",
      platformName: "QPilot Control Plane",
      shortName: "QCP",
      industry: "Platform engineering",
      tagline: "A precision control plane for correctness, stability, and capacity before every release.",
      tenantName: "Platform Engineering",
      domain: "control.yourcompany.com",
      host: "203.0.113.30",
      sshUser: "ubuntu",
      repoUrl: "git@github.com:your-org/QPilot-Studio.git",
      gitRef: "main",
      certEmail: "platform-ops@yourcompany.com",
      deploymentMode: "private-prod",
      accent: "rose",
      modules: [
        "functional",
        "benchmark",
        "load",
        "gates",
        "ops",
        "backups",
        "environments",
        "desktop"
      ],
      metricsEnabled: true,
      alertsEnabled: true,
      backupsEnabled: true,
      desktopEnabled: true
    }
  }
];

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "qpilot-platform";

const ensureUniqueModules = (modules: ModuleKey[], desktopEnabled: boolean): ModuleKey[] => {
  const set = new Set(modules);
  if (desktopEnabled) {
    set.add("desktop");
  } else {
    set.delete("desktop");
  }
  return moduleCatalog.map((module) => module.key).filter((key) => set.has(key));
};

const buildRuntimeEnvTemplate = (state: BuilderState): string => {
  const origin = state.domain ? `https://${state.domain}` : "https://your-domain.example.com";
  const lines = [
    `# ${state.platformName} runtime configuration`,
    "NODE_ENV=production",
    "HOST=127.0.0.1",
    "PORT=8787",
    `CORS_ORIGIN=${origin}`,
    "AUTH_SECURE_COOKIES=true",
    "OPENAI_API_KEY=<replace-me>",
    "CREDENTIAL_MASTER_KEY=<64-char-hex>",
    state.metricsEnabled ? "METRICS_BEARER_TOKEN=<replace-me>" : "# METRICS_BEARER_TOKEN=<optional>",
    `OPS_ALERTS_ENABLED=${state.alertsEnabled ? "true" : "false"}`,
    state.alertsEnabled ? "OPS_ALERT_WEBHOOK_URL=<replace-me>" : "# OPS_ALERT_WEBHOOK_URL=<optional>",
    "OPS_ALERT_POLL_INTERVAL_MS=60000",
    "OPS_ALERT_COOLDOWN_MS=900000"
  ];

  if (state.backupsEnabled) {
    lines.push(
      "BACKUP_SHARED_ROOT=/opt/qpilot-studio/shared",
      "BACKUP_OPS_ROOT=/opt/qpilot-studio/ops",
      "BACKUP_S3_ENDPOINT=<replace-me>",
      "BACKUP_S3_REGION=<replace-me>",
      "BACKUP_S3_BUCKET=<replace-me>",
      "BACKUP_S3_PREFIX=backups",
      "BACKUP_S3_ACCESS_KEY_ID=<replace-me>",
      "BACKUP_S3_SECRET_ACCESS_KEY=<replace-me>",
      "BACKUP_ENCRYPTION_KEY=<replace-me>",
      "BACKUP_RETENTION_DAYS=14",
      "BACKUP_STALE_AFTER_HOURS=36"
    );
  } else {
    lines.push(
      "# BACKUP_S3_BUCKET=<optional>",
      "# BACKUP_ENCRYPTION_KEY=<optional>",
      "# BACKUP_RETENTION_DAYS=14",
      "# BACKUP_STALE_AFTER_HOURS=36"
    );
  }

  return lines.join("\n");
};

const buildBootstrapCommand = (state: BuilderState, envPath: string): string => {
  const ref = state.gitRef || "main";
  return [
    "pnpm deploy:bootstrap -- `",
    `  --host ${state.host || "YOUR_SERVER_IP"} \``,
    `  --ssh-user ${state.sshUser || "ubuntu"} \``,
    `  --domain ${state.domain || "platform.example.com"} \``,
    `  --repo-url ${state.repoUrl || "git@github.com:your-org/QPilot-Studio.git"} \``,
    `  --ref ${ref} \``,
    `  --cert-email ${state.certEmail || "ops@example.com"} \``,
    `  --runtime-env-source ${envPath}`
  ].join("\n");
};

const buildUpdateCommand = (state: BuilderState, envPath: string): string => {
  const ref = state.gitRef || "main";
  return [
    "pnpm deploy:update -- `",
    `  --host ${state.host || "YOUR_SERVER_IP"} \``,
    `  --ssh-user ${state.sshUser || "ubuntu"} \``,
    `  --ref ${ref} \``,
    `  --domain ${state.domain || "platform.example.com"} \``,
    `  --runtime-env-source ${envPath}`
  ].join("\n");
};

const buildSmokeCommand = (state: BuilderState): string => {
  const baseUrl = state.domain ? `https://${state.domain}` : "https://platform.example.com";
  return [
    "pnpm deploy:smoke -- `",
    `  --base-url ${baseUrl} \``,
    "  --metrics-token <METRICS_BEARER_TOKEN>"
  ].join("\n");
};

const buildGeneratedBundle = (state: BuilderState, pick: PickFn): GeneratedBundle => {
  const slug = slugify(state.platformName);
  const envPath = `C:\\deploy\\${slug}.env.production`;
  const selectedModules = moduleCatalog.filter((module) => state.modules.includes(module.key));
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    platform: {
      name: state.platformName,
      shortName: state.shortName,
      tagline: state.tagline,
      industry: state.industry,
      tenantName: state.tenantName,
      preset: state.preset,
      accent: state.accent
    },
    modules: selectedModules.map((module) => ({
      key: module.key,
      lane: module.lane.en,
      title: module.title.en
    })),
    deployment: {
      mode: state.deploymentMode,
      domain: state.domain,
      host: state.host,
      sshUser: state.sshUser,
      repoUrl: state.repoUrl,
      gitRef: state.gitRef,
      certEmail: state.certEmail,
      runtimeEnvPath: envPath
    },
    operations: {
      metricsEnabled: state.metricsEnabled,
      alertsEnabled: state.alertsEnabled,
      backupsEnabled: state.backupsEnabled,
      desktopEnabled: state.desktopEnabled
    },
    launchChecklist: [
      pick("Prepare DNS and SSH access.", "先准备好 DNS 和 SSH 访问。"),
      pick("Write the runtime env file before bootstrap.", "部署前先写好 runtime env 文件。"),
      pick("Run smoke verification after every bootstrap or update.", "每次首装或更新后都执行 smoke 验证。")
    ]
  };

  return {
    manifestJson: JSON.stringify(manifest, null, 2),
    envTemplate: buildRuntimeEnvTemplate(state),
    bootstrapCommand: buildBootstrapCommand(state, envPath),
    updateCommand: buildUpdateCommand(state, envPath),
    smokeCommand: buildSmokeCommand(state)
  };
};

const getDeploymentModeLabel = (
  mode: DeploymentMode,
  pick: PickFn
): { title: string; summary: string } => {
  switch (mode) {
    case "internal-preview":
      return {
        title: pick("Internal preview", "内部预览"),
        summary: pick(
          "Leanest setup for internal teams. Metrics stay on, but alerts and backups can remain off.",
          "最轻量的内部团队方案，保留指标，告警和备份可以后开。"
        )
      };
    case "private-prod":
      return {
        title: pick("Private production", "私有生产"),
        summary: pick(
          "Full operations posture with backups, alerts, and stricter public-surface controls.",
          "完整运维姿态，包含备份、告警和更严格的公网边界。"
        )
      };
    default:
      return {
        title: pick("Single host SSH", "单机 SSH 部署"),
        summary: pick(
          "The default public deployment model already supported by this repo.",
          "当前仓库已经支持的默认公网部署模型。"
        )
      };
  }
};

const getDeploymentModeOptions = (pick: PickFn): Array<{
  value: DeploymentMode;
  label: string;
}> => [
  { value: "single-host-ssh", label: pick("Single host SSH", "单机 SSH") },
  { value: "internal-preview", label: pick("Internal preview", "内部预览") },
  { value: "private-prod", label: pick("Private production", "私有生产") }
];

const downloadTextFile = (filename: string, content: string, mimeType: string): void => {
  if (typeof window === "undefined") {
    return;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

export const PlatformBlueprintPage = () => {
  const { pick, language } = useI18n();
  const defaultPreset = presetCatalog[2] ?? presetCatalog[0];

  if (!defaultPreset) {
    return null;
  }
  const [builder, setBuilder] = useState<BuilderState>(defaultPreset.config);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const saved = window.localStorage.getItem(builderStorageKey);
    if (!saved) {
      return;
    }

    try {
      const parsed = JSON.parse(saved) as Partial<BuilderState>;
      setBuilder((current) => ({
        ...current,
        ...parsed,
        modules: ensureUniqueModules(
          Array.isArray(parsed.modules) ? parsed.modules : current.modules,
          parsed.desktopEnabled ?? current.desktopEnabled
        )
      }));
    } catch {
      // Ignore invalid local state and keep the default preset.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(builderStorageKey, JSON.stringify(builder));
  }, [builder]);

  useEffect(() => {
    if (!copiedKey) {
      return;
    }

    const timeoutId = window.setTimeout(() => setCopiedKey(null), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [copiedKey]);

  const selectedModules = useMemo(
    () => moduleCatalog.filter((module) => builder.modules.includes(module.key)),
    [builder.modules]
  );

  const deploymentMode = useMemo(
    () => getDeploymentModeLabel(builder.deploymentMode, pick),
    [builder.deploymentMode, pick]
  );

  const generatedBundle = useMemo(() => buildGeneratedBundle(builder, pick), [builder, pick]);

  const laneCounts = useMemo(() => {
    return selectedModules.reduce<Record<string, number>>((accumulator, module) => {
      accumulator[module.lane.en] = (accumulator[module.lane.en] ?? 0) + 1;
      return accumulator;
    }, {});
  }, [selectedModules]);

  const surfaceCards = useMemo(
    () =>
      selectedModules.map((module) => ({
        key: module.key,
        title: language === "zh-CN" ? module.title.zh : module.title.en,
        summary: language === "zh-CN" ? module.summary.zh : module.summary.en,
        lane: language === "zh-CN" ? module.lane.zh : module.lane.en
      })),
    [language, selectedModules]
  );

  const handleFieldChange = <K extends keyof BuilderState>(
    key: K,
    value: BuilderState[K]
  ) => {
    setBuilder((current) => {
      const next = { ...current, [key]: value };
      return {
        ...next,
        modules: ensureUniqueModules(next.modules, next.desktopEnabled)
      };
    });
  };

  const handleApplyPreset = (presetKey: BuilderPreset) => {
    const preset = presetCatalog.find((entry) => entry.key === presetKey);
    if (!preset) {
      return;
    }

    setBuilder(preset.config);
  };

  const toggleModule = (moduleKey: ModuleKey) => {
    setBuilder((current) => {
      const hasModule = current.modules.includes(moduleKey);
      const modules = hasModule
        ? current.modules.filter((key) => key !== moduleKey)
        : [...current.modules, moduleKey];

      const desktopEnabled =
        moduleKey === "desktop" ? !hasModule : current.desktopEnabled;

      return {
        ...current,
        desktopEnabled,
        modules: ensureUniqueModules(modules, desktopEnabled)
      };
    });
  };

  const copyText = async (key: string, value: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }

    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
  };

  return (
    <PlatformPageShell
      badge={
        <span className="console-data-pill px-4 py-2 text-[11px] font-medium uppercase tracking-[0.22em] text-slate-700">
          {pick("Platform Builder", "平台构建器")}
        </span>
      }
      projectLabel={
        <span className="console-data-pill px-4 py-2 text-[11px] font-medium text-sky-700">
          {pick("Configurable and deployable", "可配置且可部署")}
        </span>
      }
      title={builder.platformName}
      description={pick(
        "Use this surface to package a new testing platform variant, choose the modules you want, and walk away with runtime env, deployment commands, and an exportable manifest.",
        "在这里把你的测试平台重新打包成一套可配置产品，选好模块后直接拿走 runtime env、部署命令和可导出的配置清单。"
      )}
      actions={
        <>
          <button
            type="button"
            onClick={() =>
              downloadTextFile(
                `${slugify(builder.platformName)}.manifest.json`,
                generatedBundle.manifestJson,
                "application/json"
              )
            }
            className="console-button-secondary text-sm"
          >
            {pick("Download manifest", "下载配置清单")}
          </button>
          <button
            type="button"
            onClick={() =>
              downloadTextFile(
                `${slugify(builder.platformName)}.env.production`,
                generatedBundle.envTemplate,
                "text/plain"
              )
            }
            className="console-button-subtle text-sm"
          >
            {pick("Download env template", "下载 env 模板")}
          </button>
          <Link to="/platform/ops" className="console-button-primary text-sm">
            {pick("Open ops surface", "打开运维面板")}
          </Link>
        </>
      }
      metrics={
        <>
          <PlatformMetricCard
            label={pick("Selected modules", "已选模块")}
            value={selectedModules.length}
            dense
          />
          <PlatformMetricCard
            label={pick("Deployment mode", "部署模式")}
            value={deploymentMode.title}
            dense
          />
          <PlatformMetricCard
            label={pick("Env lines", "Env 行数")}
            value={generatedBundle.envTemplate.split("\n").length}
            dense
          />
          <PlatformMetricCard
            label={pick("Ops hardening", "运维强化")}
            value={`${
              [builder.metricsEnabled, builder.alertsEnabled, builder.backupsEnabled].filter(
                Boolean
              ).length
            }/3`}
            dense
          />
        </>
      }
      accent={builder.accent}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)]">
        <section className="console-panel px-5 py-5">
          <PlatformSectionHeader
            eyebrow={pick("Configuration", "配置区")}
            title={pick("Compose your platform package", "组合你的平台包")}
            description={pick(
              "Start from a preset, then tune product identity, surface modules, and deployment posture. Your choices persist locally on this browser.",
              "先从一个预设开始，然后调整产品身份、功能模块和部署姿态。你改的内容会保存在当前浏览器本地。"
            )}
            actions={
              <button
                type="button"
                onClick={() => handleApplyPreset(defaultPreset.key)}
                className="console-button-secondary text-sm"
              >
                {pick("Reset to full control plane", "重置为完整控制平面")}
              </button>
            }
          />

          <div className="mt-5 space-y-6">
            <div>
              <p className="font-data text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Recommended presets", "推荐预设")}
              </p>
              <div className="mt-3 grid gap-3">
                {presetCatalog.map((preset) => {
                  const active = builder.preset === preset.key;
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => handleApplyPreset(preset.key)}
                      className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                        active
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-900 hover:border-sky-300 hover:bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold">
                          {language === "zh-CN" ? preset.title.zh : preset.title.en}
                        </p>
                        <span className="font-data text-[11px] uppercase tracking-[0.22em]">
                          {active ? pick("Selected", "已选") : pick("Apply", "使用")}
                        </span>
                      </div>
                      <p
                        className={`mt-2 text-sm leading-6 ${
                          active ? "text-slate-200" : "text-slate-600"
                        }`}
                      >
                        {language === "zh-CN" ? preset.summary.zh : preset.summary.en}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <PlatformFormField
                label={pick("Platform name", "平台名称")}
                htmlFor="platform-name"
                hint={pick("This drives the exported manifest and env filename.", "这会影响导出的 manifest 和 env 文件名。")}
              >
                <input
                  id="platform-name"
                  value={builder.platformName}
                  onChange={(event) => handleFieldChange("platformName", event.target.value)}
                  className="console-input"
                />
              </PlatformFormField>
              <PlatformFormField
                label={pick("Short name", "简称")}
                htmlFor="platform-short-name"
                hint={pick("Use a concise operator-facing label.", "适合给操作员看的短名称。")}
              >
                <input
                  id="platform-short-name"
                  value={builder.shortName}
                  onChange={(event) => handleFieldChange("shortName", event.target.value)}
                  className="console-input"
                />
              </PlatformFormField>
              <PlatformFormField
                label={pick("Industry / use case", "行业 / 使用场景")}
                htmlFor="platform-industry"
              >
                <input
                  id="platform-industry"
                  value={builder.industry}
                  onChange={(event) => handleFieldChange("industry", event.target.value)}
                  className="console-input"
                />
              </PlatformFormField>
              <PlatformFormField label={pick("Tenant label", "租户标签")} htmlFor="platform-tenant">
                <input
                  id="platform-tenant"
                  value={builder.tenantName}
                  onChange={(event) => handleFieldChange("tenantName", event.target.value)}
                  className="console-input"
                />
              </PlatformFormField>
            </div>

            <PlatformFormField
              label={pick("Operator tagline", "平台标语")}
              htmlFor="platform-tagline"
              hint={pick(
                "Keep this short and operational. It appears in the live platform preview.",
                "建议保持简洁和操作导向，这会出现在右侧的平台预览里。"
              )}
            >
              <textarea
                id="platform-tagline"
                rows={3}
                value={builder.tagline}
                onChange={(event) => handleFieldChange("tagline", event.target.value)}
                className="console-input"
              />
            </PlatformFormField>

            <div className="grid gap-4 md:grid-cols-2">
              <PlatformFormField label={pick("Public domain", "公网域名")} htmlFor="platform-domain">
                <input
                  id="platform-domain"
                  value={builder.domain}
                  onChange={(event) => handleFieldChange("domain", event.target.value)}
                  className="console-input"
                />
              </PlatformFormField>
              <PlatformFormField
                label={pick("Deployment mode", "部署模式")}
                htmlFor="platform-deploy-mode"
              >
                <select
                  id="platform-deploy-mode"
                  value={builder.deploymentMode}
                  onChange={(event) =>
                    handleFieldChange("deploymentMode", event.target.value as DeploymentMode)
                  }
                  className="console-input"
                >
                  {getDeploymentModeOptions(pick).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </PlatformFormField>
            </div>

            <PlatformAdvancedPanel
              open={advancedOpen}
              onToggle={() => setAdvancedOpen((current) => !current)}
              title={pick("Deployment rails", "部署参数")}
              description={pick(
                "Fill in the host and repo details once, then reuse the generated bootstrap and update commands.",
                "把主机和仓库信息填好之后，右侧就能直接复用生成的 bootstrap 和 update 命令。"
              )}
              label={pick("Open deployment rails", "展开部署参数")}
              hideLabel={pick("Hide deployment rails", "收起部署参数")}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <PlatformFormField label={pick("Server host", "服务器 IP")} htmlFor="platform-host">
                  <input
                    id="platform-host"
                    value={builder.host}
                    onChange={(event) => handleFieldChange("host", event.target.value)}
                    className="console-input"
                  />
                </PlatformFormField>
                <PlatformFormField label={pick("SSH user", "SSH 用户")} htmlFor="platform-ssh-user">
                  <input
                    id="platform-ssh-user"
                    value={builder.sshUser}
                    onChange={(event) => handleFieldChange("sshUser", event.target.value)}
                    className="console-input"
                  />
                </PlatformFormField>
                <PlatformFormField
                  label={pick("Repository URL", "仓库地址")}
                  htmlFor="platform-repo-url"
                >
                  <input
                    id="platform-repo-url"
                    value={builder.repoUrl}
                    onChange={(event) => handleFieldChange("repoUrl", event.target.value)}
                    className="console-input"
                  />
                </PlatformFormField>
                <PlatformFormField label={pick("Git ref", "Git 分支 / Ref")} htmlFor="platform-git-ref">
                  <input
                    id="platform-git-ref"
                    value={builder.gitRef}
                    onChange={(event) => handleFieldChange("gitRef", event.target.value)}
                    className="console-input"
                  />
                </PlatformFormField>
                <PlatformFormField
                  label={pick("Certbot email", "证书邮箱")}
                  htmlFor="platform-cert-email"
                >
                  <input
                    id="platform-cert-email"
                    value={builder.certEmail}
                    onChange={(event) => handleFieldChange("certEmail", event.target.value)}
                    className="console-input"
                  />
                </PlatformFormField>
                <PlatformFormField label={pick("Accent tone", "强调色")} htmlFor="platform-accent">
                  <select
                    id="platform-accent"
                    value={builder.accent}
                    onChange={(event) =>
                      handleFieldChange("accent", event.target.value as AccentTone)
                    }
                    className="console-input"
                  >
                    <option value="sky">{pick("Sky control", "冷蓝控制台")}</option>
                    <option value="emerald">{pick("Emerald release", "翠绿发布中心")}</option>
                    <option value="rose">{pick("Rose command", "玫红指挥台")}</option>
                  </select>
                </PlatformFormField>
              </div>
            </PlatformAdvancedPanel>

            <div>
              <p className="font-data text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Module surface", "模块组合")}
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {moduleCatalog.map((module) => {
                  const active = builder.modules.includes(module.key);
                  return (
                    <button
                      key={module.key}
                      type="button"
                      onClick={() => toggleModule(module.key)}
                      className={`rounded-[24px] border px-4 py-4 text-left transition ${
                        active
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 bg-white hover:border-sky-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">
                            {language === "zh-CN" ? module.title.zh : module.title.en}
                          </p>
                          <p
                            className={`mt-1 text-xs uppercase tracking-[0.24em] ${
                              active ? "text-slate-300" : "text-slate-400"
                            }`}
                          >
                            {language === "zh-CN" ? module.lane.zh : module.lane.en}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                            active ? "bg-white/12 text-white" : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {active ? pick("Included", "已接入") : pick("Optional", "可选")}
                        </span>
                      </div>
                      <p
                        className={`mt-3 text-sm leading-6 ${
                          active ? "text-slate-200" : "text-slate-600"
                        }`}
                      >
                        {language === "zh-CN" ? module.summary.zh : module.summary.en}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <button
                type="button"
                onClick={() => handleFieldChange("metricsEnabled", !builder.metricsEnabled)}
                className={`rounded-[20px] border px-4 py-4 text-left ${
                  builder.metricsEnabled
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                <p className="text-sm font-semibold">{pick("Metrics", "指标监控")}</p>
                <p className="mt-1 text-sm">
                  {builder.metricsEnabled
                    ? pick("Protected /metrics enabled", "受保护的 /metrics 已启用")
                    : pick("No metrics token yet", "尚未开启 metrics token")}
                </p>
              </button>
              <button
                type="button"
                onClick={() => handleFieldChange("alertsEnabled", !builder.alertsEnabled)}
                className={`rounded-[20px] border px-4 py-4 text-left ${
                  builder.alertsEnabled
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : "border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                <p className="text-sm font-semibold">{pick("Alerts", "告警")}</p>
                <p className="mt-1 text-sm">
                  {builder.alertsEnabled
                    ? pick("Webhook alerts included", "已接入 Webhook 告警")
                    : pick("Ops alerts disabled", "当前未开启运维告警")}
                </p>
              </button>
              <button
                type="button"
                onClick={() => handleFieldChange("backupsEnabled", !builder.backupsEnabled)}
                className={`rounded-[20px] border px-4 py-4 text-left ${
                  builder.backupsEnabled
                    ? "border-rose-300 bg-rose-50 text-rose-900"
                    : "border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                <p className="text-sm font-semibold">{pick("Backups", "备份恢复")}</p>
                <p className="mt-1 text-sm">
                  {builder.backupsEnabled
                    ? pick("S3 backup rails included", "已纳入 S3 备份链路")
                    : pick("Backups kept off for now", "当前先不启用备份")}
                </p>
              </button>
              <button
                type="button"
                onClick={() => handleFieldChange("desktopEnabled", !builder.desktopEnabled)}
                className={`rounded-[20px] border px-4 py-4 text-left ${
                  builder.desktopEnabled
                    ? "border-sky-300 bg-sky-50 text-sky-900"
                    : "border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                <p className="text-sm font-semibold">{pick("Desktop", "桌面端")}</p>
                <p className="mt-1 text-sm">
                  {builder.desktopEnabled
                    ? pick("Desktop companion included", "已包含桌面伴随端")
                    : pick("Web-first deployment", "当前以 Web 部署为主")}
                </p>
              </button>
            </div>
          </div>
        </section>

        <aside className="space-y-4 xl:sticky xl:top-4">
          <section className="console-panel overflow-hidden px-5 py-5">
            <PlatformSectionHeader
              eyebrow={pick("Live preview", "实时预览")}
              title={pick("Platform surface snapshot", "平台表面快照")}
              description={pick(
                "This preview shows what your packaged control plane emphasizes before you export anything.",
                "这个预览会先把你打包后的控制平面重点表现出来，再决定是否导出。"
              )}
              variant="summary"
              dense
            />

            <div className="mt-4 rounded-[28px] border border-slate-200 bg-[linear-gradient(160deg,rgba(11,20,35,1),rgba(16,28,50,0.96))] p-4 text-white">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-data text-[11px] uppercase tracking-[0.28em] text-sky-200/80">
                    {builder.shortName || "QP"}
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight">
                    {builder.platformName}
                  </h3>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
                    {builder.tagline}
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-slate-100">
                  {deploymentMode.title}
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {surfaceCards.map((card) => (
                  <article
                    key={card.key}
                    className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold">{card.title}</p>
                      <span className="rounded-full border border-white/12 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-slate-300">
                        {card.lane}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{card.summary}</p>
                  </article>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {Object.entries(laneCounts).map(([lane, count]) => (
                  <span
                    key={lane}
                    className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-medium text-slate-200"
                  >
                    {lane} · {count}
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section className="console-panel px-5 py-5">
            <PlatformSectionHeader
              eyebrow={pick("Deploy outputs", "部署输出")}
              title={pick("Export-ready deployment bundle", "可导出的部署包")}
              description={deploymentMode.summary}
              dense
            />

            <div className="mt-4 space-y-4">
              <div className="console-panel-subtle p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">
                    {pick("runtime.env.production", "runtime.env.production")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void copyText("env", generatedBundle.envTemplate)}
                      className="console-button-secondary text-sm"
                    >
                      {copiedKey === "env"
                        ? pick("Copied", "已复制")
                        : pick("Copy env", "复制 env")}
                    </button>
                  </div>
                </div>
                <pre className="mt-3 overflow-x-auto rounded-[18px] bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100">
                  {generatedBundle.envTemplate}
                </pre>
              </div>

              {[
                {
                  key: "bootstrap",
                  title: pick("Bootstrap command", "首装命令"),
                  value: generatedBundle.bootstrapCommand
                },
                {
                  key: "update",
                  title: pick("Update command", "更新命令"),
                  value: generatedBundle.updateCommand
                },
                {
                  key: "smoke",
                  title: pick("Smoke command", "验收命令"),
                  value: generatedBundle.smokeCommand
                }
              ].map((command) => (
                <div key={command.key} className="console-panel-subtle p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">{command.title}</p>
                    <button
                      type="button"
                      onClick={() => void copyText(command.key, command.value)}
                      className="console-button-secondary text-sm"
                    >
                      {copiedKey === command.key
                        ? pick("Copied", "已复制")
                        : pick("Copy", "复制")}
                    </button>
                  </div>
                  <pre className="mt-3 overflow-x-auto rounded-[18px] bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100">
                    {command.value}
                  </pre>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className="console-panel px-5 py-5">
        <PlatformSectionHeader
          eyebrow={pick("Packaging view", "打包视图")}
          title={pick("What this new platform ships with", "这套新平台会带什么")}
          description={pick(
            "Use this as your product checklist before you wire real data, routes, or customer-specific branding.",
            "在真正接客户数据、路由和品牌之前，可以先把它当作你的产品打包检查清单。"
          )}
          variant="table"
        />

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_360px]">
          <div className="grid gap-3 md:grid-cols-2">
            {surfaceCards.map((card) => (
              <article key={card.key} className="console-panel-subtle p-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-slate-900">{card.title}</h4>
                  <span className="console-data-pill px-3 py-1 text-[11px] font-medium text-slate-600">
                    {card.lane}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">{card.summary}</p>
              </article>
            ))}
          </div>

          <aside className="space-y-3">
            <div className="console-panel-subtle p-4">
              <p className="font-data text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Launch posture", "上线姿态")}
              </p>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <p>{deploymentMode.title}</p>
                <p>{builder.domain || "platform.example.com"}</p>
                <p>{builder.host || "YOUR_SERVER_IP"}</p>
                <p>{builder.repoUrl || "git@github.com:your-org/QPilot-Studio.git"}</p>
              </div>
            </div>
            <div className="console-panel-subtle p-4">
              <p className="font-data text-[11px] uppercase tracking-[0.28em] text-slate-400">
                {pick("Operator checklist", "操作清单")}
              </p>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <p>{pick("1. Write the env template locally.", "1. 先在本地写好 env 模板。")}</p>
                <p>{pick("2. Run bootstrap with the generated command.", "2. 用生成的命令执行 bootstrap。")}</p>
                <p>{pick("3. Register owner account after smoke passes.", "3. smoke 通过后注册 owner 账号。")}</p>
                <p>{pick("4. Configure projects, environments, and policies.", "4. 再配置项目、环境和策略。")}</p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="console-panel px-5 py-5">
          <PlatformSectionHeader
            eyebrow={pick("Manifest", "配置清单")}
            title={pick("Portable platform manifest", "可移植的平台 manifest")}
            description={pick(
              "This is the cleanest export if you want to hand the configuration to another operator or feed it into future automation.",
              "如果你要把这套配置交给别的运维同学，或者后续喂给自动化流程，这个 manifest 是最干净的输出。"
            )}
            actions={
              <button
                type="button"
                onClick={() => void copyText("manifest", generatedBundle.manifestJson)}
                className="console-button-secondary text-sm"
              >
                {copiedKey === "manifest"
                  ? pick("Copied", "已复制")
                  : pick("Copy manifest", "复制 manifest")}
              </button>
            }
          />
          <pre className="mt-4 overflow-x-auto rounded-[22px] bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100">
            {generatedBundle.manifestJson}
          </pre>
        </div>

        <div className="console-panel px-5 py-5">
          <PlatformSectionHeader
            eyebrow={pick("Next steps", "下一步")}
            title={pick("Move from packaging to deployment", "从打包走到部署")}
            description={pick(
              "Once your package looks right, the existing SSH deployment flow in this repo is enough to put it online quickly.",
              "当这套平台包配置好之后，当前仓库已经自带的 SSH 自动部署链路足够让你很快上公网。"
            )}
            variant="timeline"
          />

          <div className="mt-4 space-y-3">
            {[
              pick("Finalize the public domain, server IP, and repo URL.", "先定下公网域名、服务器 IP 和仓库地址。"),
              pick("Fill the generated env template with real secrets.", "把生成的 env 模板补上真实密钥。"),
              pick("Run bootstrap, then smoke verification.", "执行 bootstrap，然后跑 smoke 验证。"),
              pick("Create your owner account and start registering projects.", "创建 owner 账号，然后开始接入项目。"),
              pick("If you enable backups, wire S3 before production traffic.", "如果打开了备份，请在接正式流量前配好 S3。")
            ].map((item, index) => (
              <div key={item} className="console-panel-subtle flex gap-4 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 font-data text-xs font-semibold text-white">
                  {index + 1}
                </div>
                <p className="pt-1 text-sm leading-6 text-slate-600">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PlatformPageShell>
  );
};
