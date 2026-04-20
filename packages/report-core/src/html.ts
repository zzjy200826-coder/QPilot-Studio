import type { Language, Project, Run, Step, TestCase } from "@qpilot/shared";

export interface ReportInput {
  project: Project;
  run: Run;
  steps: Step[];
  testCases: TestCase[];
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");

const localize = (language: Language | undefined, english: string, chinese: string): string =>
  language === "zh-CN" ? chinese : english;

const statusLabel = (run: Run, status: Run["status"]): string => {
  switch (status) {
    case "queued":
      return localize(run.language, "queued", "排队中");
    case "running":
      return localize(run.language, "running", "运行中");
    case "passed":
      return localize(run.language, "passed", "通过");
    case "failed":
      return localize(run.language, "failed", "失败");
    case "stopped":
      return localize(run.language, "stopped", "已停止");
    default:
      return status;
  }
};

export const buildHtmlReport = (input: ReportInput): string => {
  const stepRows = input.steps
    .map((step) => {
      const checks = step.verificationResult.checks
        .map((item) =>
          `${escapeHtml(item.expected)}: ${item.found ? localize(input.run.language, "OK", "命中") : localize(input.run.language, "MISS", "未命中")}`
        )
        .join("<br/>");
      return `<tr>
        <td>${step.index}</td>
        <td>${escapeHtml(step.action.type)}</td>
        <td>${escapeHtml(step.action.target ?? "-")}</td>
        <td>${escapeHtml(step.actionStatus)}</td>
        <td>${escapeHtml(step.pageTitle)}</td>
        <td>${escapeHtml(step.pageUrl)}</td>
        <td>${escapeHtml(step.observationSummary)}</td>
        <td>${checks}</td>
      </tr>`;
    })
    .join("\n");
  const timelineItems = [
    `<li><strong>${localize(input.run.language, "Run started", "运行开始")}</strong><span>${escapeHtml(
      input.run.startedAt ?? input.run.createdAt
    )}</span><p>${escapeHtml(input.run.targetUrl)}</p></li>`,
    ...(input.run.startupObservation
      ? [
          `<li><strong>${localize(input.run.language, "Startup evidence", "启动证据")}</strong><span>${escapeHtml(
            input.run.startedAt ?? input.run.createdAt
          )}</span><p>${escapeHtml(input.run.startupObservation)}</p></li>`
        ]
      : []),
    ...input.steps.map(
      (step) =>
        `<li><strong>${localize(input.run.language, `Step #${step.index}`, `步骤 #${step.index}`)} ${escapeHtml(step.action.type)}</strong><span>${escapeHtml(
          step.createdAt
        )}</span><p>${escapeHtml(step.observationSummary)}</p></li>`
    ),
    ...(input.run.challengeKind
      ? [
          `<li><strong>${localize(input.run.language, "Challenge", "挑战")}: ${escapeHtml(input.run.challengeKind)}</strong><span>${escapeHtml(
            input.run.endedAt ?? input.run.startedAt ?? input.run.createdAt
          )}</span><p>${escapeHtml(input.run.challengeReason ?? "-")}</p></li>`
        ]
      : []),
    `<li><strong>${localize(input.run.language, "Run", "运行")} ${escapeHtml(statusLabel(input.run, input.run.status))}</strong><span>${escapeHtml(
      input.run.endedAt ?? input.run.createdAt
    )}</span><p>${escapeHtml(
      input.run.failureSuggestion ??
        input.run.errorMessage ??
        localize(input.run.language, "Reports generated.", "报告已生成。")
    )}</p></li>`
  ].join("");

  const testCaseRows = input.testCases
    .map(
      (item) => `<tr>
    <td>${escapeHtml(item.module)}</td>
    <td>${escapeHtml(item.title)}</td>
    <td>${escapeHtml(item.status)}</td>
    <td>${escapeHtml(item.priority ?? "-")}</td>
    <td>${escapeHtml(item.method ?? "-")}</td>
    <td>${escapeHtml(item.expected ?? "-")}</td>
    <td>${escapeHtml(item.actual ?? "-")}</td>
  </tr>`
    )
    .join("\n");
  const challengeSummary = input.run.challengeKind
    ? `<div class="challenge">
        <strong>${localize(input.run.language, "Challenge", "挑战")}:</strong> ${escapeHtml(input.run.challengeKind)}<br/>
        <strong>${localize(input.run.language, "Reason", "原因")}:</strong> ${escapeHtml(input.run.challengeReason ?? "-")}
      </div>`
    : "";
  const videoBlock = input.run.recordedVideoPath
    ? `<h2>${localize(input.run.language, "Run Recording", "运行录像")}</h2>
      <div class="video-card">
        <video controls preload="metadata" src="${escapeHtml(input.run.recordedVideoPath)}"></video>
        <p class="video-note">${localize(input.run.language, "Recording path", "录像路径")}: ${escapeHtml(input.run.recordedVideoPath)}</p>
      </div>`
    : "";

  return `<!doctype html>
<html lang="${escapeHtml(input.run.language ?? "en")}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${localize(input.run.language, "QPilot Report", "QPilot 报告")} - ${escapeHtml(input.run.id)}</title>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        margin: 24px;
        font-family: "Segoe UI", sans-serif;
        color: #1f2937;
      }
      h1, h2 {
        margin-bottom: 8px;
      }
      .meta {
        margin-bottom: 16px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        padding: 12px;
        border-radius: 16px;
      }
      .challenge {
        margin-top: 12px;
        border-radius: 14px;
        background: #fff7ed;
        border: 1px solid #fdba74;
        padding: 12px;
      }
      .video-card {
        margin-bottom: 20px;
        border: 1px solid #dbeafe;
        background: #eff6ff;
        border-radius: 18px;
        padding: 14px;
      }
      video {
        width: 100%;
        max-width: 1040px;
        border-radius: 12px;
        background: #020617;
      }
      .video-note {
        margin-top: 10px;
        font-size: 12px;
        color: #475569;
      }
      .timeline {
        list-style: none;
        padding: 0;
        margin: 0 0 22px;
      }
      .timeline li {
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 14px;
        margin-bottom: 12px;
        background: #f8fafc;
      }
      .timeline strong {
        display: inline-block;
        margin-bottom: 6px;
      }
      .timeline span {
        float: right;
        color: #64748b;
        font-size: 12px;
      }
      .timeline p {
        margin: 6px 0 0;
        font-size: 13px;
        color: #334155;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
      }
      th, td {
        border: 1px solid #cbd5e1;
        padding: 8px;
        vertical-align: top;
        font-size: 12px;
      }
      th {
        background: #e2e8f0;
        text-align: left;
      }
    </style>
  </head>
  <body>
    <h1>${localize(input.run.language, "QPilot Studio Report", "QPilot Studio 报告")}</h1>
    <div class="meta">
      <div><strong>${localize(input.run.language, "Project", "项目")}:</strong> ${escapeHtml(input.project.name)}</div>
      <div><strong>${localize(input.run.language, "Run ID", "运行 ID")}:</strong> ${escapeHtml(input.run.id)}</div>
      <div><strong>${localize(input.run.language, "Status", "状态")}:</strong> ${escapeHtml(statusLabel(input.run, input.run.status))}</div>
      <div><strong>${localize(input.run.language, "Goal", "目标")}:</strong> ${escapeHtml(input.run.goal)}</div>
      <div><strong>${localize(input.run.language, "Started", "开始于")}:</strong> ${escapeHtml(input.run.startedAt ?? "-")}</div>
      <div><strong>${localize(input.run.language, "Ended", "结束于")}:</strong> ${escapeHtml(input.run.endedAt ?? "-")}</div>
      <div><strong>${localize(input.run.language, "Recording", "录像")}:</strong> ${escapeHtml(input.run.recordedVideoPath ?? "-")}</div>
      ${challengeSummary}
    </div>

    ${videoBlock}

    <h2>${localize(input.run.language, "Event Timeline", "事件时间线")}</h2>
    <ul class="timeline">
      ${timelineItems}
    </ul>

    <h2>${localize(input.run.language, "Steps", "步骤")} (${input.steps.length})</h2>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>${localize(input.run.language, "Action", "动作")}</th>
          <th>${localize(input.run.language, "Target", "目标")}</th>
          <th>${localize(input.run.language, "Action Status", "动作状态")}</th>
          <th>${localize(input.run.language, "Title", "标题")}</th>
          <th>URL</th>
          <th>${localize(input.run.language, "Observation", "观察")}</th>
          <th>${localize(input.run.language, "Checks", "校验")}</th>
        </tr>
      </thead>
      <tbody>
        ${stepRows}
      </tbody>
    </table>

    <h2>${localize(input.run.language, "Test Cases", "测试用例")} (${input.testCases.length})</h2>
    <table>
      <thead>
        <tr>
          <th>${localize(input.run.language, "Module", "模块")}</th>
          <th>${localize(input.run.language, "Title", "标题")}</th>
          <th>${localize(input.run.language, "Status", "状态")}</th>
          <th>${localize(input.run.language, "Priority", "优先级")}</th>
          <th>${localize(input.run.language, "Method", "方法")}</th>
          <th>${localize(input.run.language, "Expected", "预期")}</th>
          <th>${localize(input.run.language, "Actual", "实际")}</th>
        </tr>
      </thead>
      <tbody>
        ${testCaseRows}
      </tbody>
    </table>
  </body>
</html>`;
};
