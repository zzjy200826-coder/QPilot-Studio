import { mkdir } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Project, Run, Step, TestCase } from "@qpilot/shared";
import { buildHtmlReport } from "./html.js";
import { buildWorkbook } from "./xlsx.js";

export interface GenerateReportInput {
  project: Project;
  run: Run;
  steps: Step[];
  testCases: TestCase[];
  htmlFilePath: string;
  xlsxFilePath: string;
}

export const generateReports = async (input: GenerateReportInput): Promise<void> => {
  await mkdir(dirname(input.htmlFilePath), { recursive: true });
  await mkdir(dirname(input.xlsxFilePath), { recursive: true });

  const html = buildHtmlReport({
    project: input.project,
    run: input.run,
    steps: input.steps,
    testCases: input.testCases
  });

  await writeFile(input.htmlFilePath, html, "utf8");

  const workbook = await buildWorkbook(input.run, input.steps, input.testCases);
  await workbook.xlsx.writeFile(input.xlsxFilePath);
};
