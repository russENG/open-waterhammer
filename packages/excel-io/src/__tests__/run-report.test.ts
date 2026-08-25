import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SOFTWARE_DISCLAIMER,
  SOFTWARE_LICENSE_ID,
  SOFTWARE_LICENSE_URL,
  SOFTWARE_SOURCE_URL,
  runFixture,
} from "@open-waterhammer/contracts";
import ExcelJS from "exceljs";

import { generateRunReport } from "../index.js";

describe("generateRunReport", () => {
  test("consumes a canonical Run and records manifest, summary, assessment, and time series", async () => {
    const report = await generateRunReport({
      ...runFixture,
      timeSeries: { seconds: [0, 1], pressureMpa: [0.8, 1.24] },
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(report as unknown as ExcelJS.Buffer);

    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
      "Run",
      "Manifest",
      "Summary",
      "Assessment",
      "Time series",
    ]);
    const runSheet = workbook.getWorksheet("Run")!;
    assert.equal(runSheet.getCell("B2").value, runFixture.id);
    assert.equal(runSheet.getCell("B6").value, "succeeded");
    assert.equal(runSheet.getCell("B10").value, "alpha");
    assert.equal(runSheet.getCell("B11").value, "設計比較支援");
    assert.equal(runSheet.getCell("B12").value, SOFTWARE_LICENSE_ID);
    assert.equal(runSheet.getCell("B13").value, SOFTWARE_LICENSE_URL);
    assert.equal(runSheet.getCell("B14").value, SOFTWARE_SOURCE_URL);
    assert.equal(runSheet.getCell("B15").value, SOFTWARE_DISCLAIMER);
    assert.equal(runSheet.getCell("A16").value, "Rule ids");
    assert.match(String(workbook.getWorksheet("Manifest")!.getCell("B2").value), /open-waterhammer-core/);
    assert.match(String(workbook.getWorksheet("Summary")!.getCell("A2").value), /peakPressureMpa/);
    assert.match(String(workbook.getWorksheet("Assessment")!.getCell("B2").value), /pass/);
    assert.match(String(workbook.getWorksheet("Time series")!.getCell("A2").value), /pressureMpa/);
  });

  test("rejects a non-canonical Run before generating a report", async () => {
    await assert.rejects(
      generateRunReport({ ...runFixture, id: "not-a-uuid" }),
      /invalid run schema/i,
    );
  });
});
