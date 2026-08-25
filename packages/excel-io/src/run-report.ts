import {
  SOFTWARE_DISCLAIMER,
  SOFTWARE_LICENSE_ID,
  SOFTWARE_LICENSE_URL,
  SOFTWARE_SOURCE_URL,
  validateRun,
} from "@open-waterhammer/contracts";
import type { Run } from "@open-waterhammer/contracts";
import ExcelJS from "exceljs";

function addRows(
  workbook: ExcelJS.Workbook,
  name: string,
  rows: unknown[][],
): void {
  const worksheet = workbook.addWorksheet(name);
  worksheet.addRows(rows);
  worksheet.getRow(1).font = { bold: true };
  worksheet.columns = [{ width: 24 }, { width: 80 }];
}

/** Generate a calculation evidence workbook directly from a canonical Run. */
export async function generateRunReport(run: Run): Promise<Buffer> {
  if (validateRun(run) !== true) throw new Error("Invalid Run schema");

  const workbook = new ExcelJS.Workbook();
  addRows(workbook, "Run", [
    ["Field", "Value"],
    ["Run id", run.id],
    ["Case id", run.caseId],
    ["Scenario id", run.scenarioId],
    ["Run kind", run.kind],
    ["Status", run.status],
    ["Created at", run.createdAt],
    ["Updated at", run.updatedAt],
    ["Error", run.error === null ? "" : JSON.stringify(run.error)],
    ["Release label", "alpha"],
    ["Purpose", "設計比較支援"],
    ["License", SOFTWARE_LICENSE_ID],
    ["License URL", SOFTWARE_LICENSE_URL],
    ["Source code", SOFTWARE_SOURCE_URL],
    ["Warranty disclaimer", SOFTWARE_DISCLAIMER],
    ["Rule ids", [...new Set(run.assessment.findings.map(({ ruleId }) => ruleId))].join(", ")],
  ]);
  addRows(workbook, "Manifest", [
    ["Field", "Value"],
    ["Engine", run.manifest.engine],
    ["Runtime", run.manifest.runtime],
    ["Method", run.manifest.method],
    ["Schema version", run.manifest.schemaVersion],
    ["Product version", run.manifest.productVersion],
    ["Git SHA", run.manifest.gitSha],
    ["Input hashes", JSON.stringify(run.manifest.inputHashes)],
    ["Output hashes", JSON.stringify(run.manifest.outputHashes)],
    ["Warnings", JSON.stringify(run.manifest.warnings)],
    ["Errors", JSON.stringify(run.manifest.errors)],
  ]);
  addRows(workbook, "Summary", [
    ["Canonical Run summary JSON"],
    [JSON.stringify(run.summary)],
  ]);
  addRows(workbook, "Assessment", [
    ["Field", "Value"],
    ["Status", run.assessment.status],
    ["Findings", JSON.stringify(run.assessment.findings)],
  ]);
  if (run.timeSeries !== undefined) {
    addRows(workbook, "Time series", [
      ["Canonical Run time-series JSON"],
      [JSON.stringify(run.timeSeries)],
    ]);
  }

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
}
