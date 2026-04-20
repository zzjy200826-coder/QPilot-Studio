import type { Language, Run, Step, TestCase } from "@qpilot/shared";
import ExcelJS from "exceljs";

const localize = (language: Language | undefined, english: string, chinese: string): string =>
  language === "zh-CN" ? chinese : english;

export const buildWorkbook = async (
  run: Run,
  steps: Step[],
  testCases: TestCase[]
): Promise<ExcelJS.Workbook> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "QPilot Studio";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet("RunSummary");
  summarySheet.columns = [
    {
      header: localize(run.language, "Field", "字段"),
      key: "field",
      width: 26
    },
    {
      header: localize(run.language, "Value", "值"),
      key: "value",
      width: 88
    }
  ];
  summarySheet.addRows([
    { field: localize(run.language, "Run ID", "运行 ID"), value: run.id },
    { field: localize(run.language, "Status", "状态"), value: run.status },
    { field: localize(run.language, "Goal", "目标"), value: run.goal },
    { field: localize(run.language, "Target URL", "目标 URL"), value: run.targetUrl },
    { field: localize(run.language, "Started", "开始于"), value: run.startedAt ?? "" },
    { field: localize(run.language, "Ended", "结束于"), value: run.endedAt ?? "" },
    { field: localize(run.language, "Failure Category", "失败类别"), value: run.failureCategory ?? "" },
    { field: localize(run.language, "Failure Suggestion", "失败建议"), value: run.failureSuggestion ?? "" },
    { field: localize(run.language, "Challenge Kind", "挑战类型"), value: run.challengeKind ?? "" },
    { field: localize(run.language, "Challenge Reason", "挑战原因"), value: run.challengeReason ?? "" },
    { field: localize(run.language, "Recorded Video", "录像路径"), value: run.recordedVideoPath ?? "" }
  ]);

  const stepSheet = workbook.addWorksheet("Steps");
  stepSheet.columns = [
    { header: localize(run.language, "Run ID", "运行 ID"), key: "runId", width: 22 },
    { header: localize(run.language, "Index", "序号"), key: "index", width: 8 },
    { header: localize(run.language, "Action", "动作"), key: "action", width: 12 },
    { header: localize(run.language, "Target", "目标"), key: "target", width: 36 },
    { header: localize(run.language, "Status", "状态"), key: "status", width: 16 },
    { header: "URL", key: "url", width: 42 },
    { header: localize(run.language, "Title", "标题"), key: "title", width: 24 },
    { header: localize(run.language, "Observation", "观察"), key: "observation", width: 50 },
    { header: localize(run.language, "Checks", "校验"), key: "checks", width: 56 },
    { header: localize(run.language, "Screenshot", "截图"), key: "screenshot", width: 36 }
  ];

  for (const step of steps) {
    stepSheet.addRow({
      runId: run.id,
      index: step.index,
      action: step.action.type,
      target: step.action.target ?? "",
      status: step.actionStatus,
      url: step.pageUrl,
      title: step.pageTitle,
      observation: step.observationSummary,
      checks: step.verificationResult.checks
        .map((item) =>
          `${item.expected}:${item.found ? localize(run.language, "OK", "命中") : localize(run.language, "MISS", "未命中")}`
        )
        .join("; "),
      screenshot: step.screenshotPath
    });
  }

  const testCaseSheet = workbook.addWorksheet("TestCases");
  testCaseSheet.columns = [
    { header: localize(run.language, "Run ID", "运行 ID"), key: "runId", width: 22 },
    { header: localize(run.language, "Module", "模块"), key: "module", width: 20 },
    { header: localize(run.language, "Title", "标题"), key: "title", width: 42 },
    { header: localize(run.language, "Status", "状态"), key: "status", width: 14 },
    { header: localize(run.language, "Priority", "优先级"), key: "priority", width: 12 },
    { header: localize(run.language, "Method", "方法"), key: "method", width: 14 },
    { header: localize(run.language, "Expected", "预期"), key: "expected", width: 40 },
    { header: localize(run.language, "Actual", "实际"), key: "actual", width: 40 },
    { header: localize(run.language, "Preconditions", "前置条件"), key: "preconditions", width: 40 }
  ];

  for (const item of testCases) {
    testCaseSheet.addRow({
      runId: run.id,
      module: item.module,
      title: item.title,
      status: item.status,
      priority: item.priority ?? "",
      method: item.method ?? "",
      expected: item.expected ?? "",
      actual: item.actual ?? "",
      preconditions: item.preconditions ?? ""
    });
  }

  return workbook;
};
