/**
 * 水理計算資料の作成パネル（Step 6: 成果品様式）
 *
 * Step 1〜5 の計算結果を取りまとめ、成果品様式準拠の Excel 帳票を出力する。
 * - 水理計算書（§5.1 定常時）
 * - 水撃圧検討書（§5.2 検討結果・対策）
 */

import { useState, useMemo } from "react";
import { calcLongitudinalHydraulic } from "@open-waterhammer/core";
import type {
  LongitudinalHydraulicInput,
  LongitudinalHydraulicResult,
} from "@open-waterhammer/core";
import type { WorkbookData } from "@open-waterhammer/excel-io";

interface ReportFormState {
  staticWaterLevel: string;
  waterhammerMode: "ratio" | "fixed";
  waterhammerRatio: string;
  waterhammerFixed: string;
  projectName: string;
  caseName: string;
}

const DEFAULT_FORM: ReportFormState = {
  staticWaterLevel: "580.600",
  waterhammerMode: "ratio",
  waterhammerRatio: "0.4",
  waterhammerFixed: "0.41",
  projectName: "",
  caseName: "計画最大流量",
};

export function ReportGenerator({ excelData }: { excelData?: WorkbookData | null }) {
  const points = excelData?.measurementPoints ?? [];
  const hasPoints = points.length > 0;

  const [form, setForm] = useState<ReportFormState>(() => ({
    ...DEFAULT_FORM,
    projectName: excelData?.meta.projectName ?? "",
  }));
  const [downloading, setDownloading] = useState(false);

  // Excel読み込み時にプロジェクト名を反映
  const [lastProject, setLastProject] = useState("");
  if (excelData && excelData.meta.projectName !== lastProject) {
    setLastProject(excelData.meta.projectName);
    setForm((prev) => ({ ...prev, projectName: excelData.meta.projectName }));
  }

  function handleField(field: keyof ReportFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  // 縦断計算プレビュー
  const previewResult = useMemo<LongitudinalHydraulicResult | null>(() => {
    if (points.length === 0) return null;
    const swl = parseFloat(form.staticWaterLevel);
    if (isNaN(swl)) return null;

    const input: LongitudinalHydraulicInput = {
      points,
      staticWaterLevel: swl,
      caseName: form.caseName || "計画最大流量",
    };
    if (form.waterhammerMode === "fixed") {
      const v = parseFloat(form.waterhammerFixed);
      if (!isNaN(v)) input.waterhammerPressureMpa = v;
    } else {
      const r = parseFloat(form.waterhammerRatio);
      if (!isNaN(r)) input.waterhammerRatio = r;
    }
    try {
      return calcLongitudinalHydraulic(input);
    } catch {
      return null;
    }
  }, [points, form]);

  async function handleDownload() {
    if (!excelData || !previewResult) return;
    setDownloading(true);
    try {
      const { generateReport } = await import("@open-waterhammer/excel-io");
      const buf = generateReport({
        meta: {
          ...excelData.meta,
          projectName: form.projectName || excelData.meta.projectName,
        },
        data: excelData,
        results: [],
        hydraulicResults: [previewResult],
      });

      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `水理計算書_${form.projectName || "unnamed"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="calculator">
      <section className="card">
        <h2 className="card-title">水理計算資料の作成</h2>

        {!hasPoints ? (
          <div className="result-empty">
            <p>Excelテンプレートの「測点データ」シートを読み込んでください。</p>
            <p className="demo-note">
              ページ上部の Excel 入出力からテンプレートをダウンロードし、
              測点データを入力後にアップロードすると、成果品様式の水理計算書を出力できます。
            </p>
          </div>
        ) : (
          <div className="calculator-body">
            {/* 出力条件 */}
            <section className="card">
              <h2 className="card-title">出力条件</h2>
              <div className="input-group">
                <div className="input-grid">
                  <div className="input-field">
                    <label className="input-label">案件名</label>
                    <div className="input-control">
                      <input type="text" className="input" value={form.projectName}
                        onChange={(e) => handleField("projectName", e.target.value)} />
                    </div>
                  </div>
                  <div className="input-field">
                    <label className="input-label">計算ケース名</label>
                    <div className="input-control">
                      <input type="text" className="input" value={form.caseName}
                        onChange={(e) => handleField("caseName", e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="input-group">
                <div className="input-grid">
                  <div className="input-field">
                    <label className="input-label">静水位 (HWL)</label>
                    <div className="input-control">
                      <input type="number" className="input" value={form.staticWaterLevel}
                        onChange={(e) => handleField("staticWaterLevel", e.target.value)} step="any" />
                      <span className="input-unit">m</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="input-group">
                <h3 className="input-group-title">水撃圧の設定</h3>
                <div className="source-tabs" style={{ marginBottom: 8 }}>
                  <button
                    className={`source-tab${form.waterhammerMode === "ratio" ? " source-tab--active" : ""}`}
                    onClick={() => handleField("waterhammerMode", "ratio")}
                  >
                    静水圧比率
                  </button>
                  <button
                    className={`source-tab${form.waterhammerMode === "fixed" ? " source-tab--active" : ""}`}
                    onClick={() => handleField("waterhammerMode", "fixed")}
                  >
                    固定値 [MPa]
                  </button>
                </div>
                <div className="input-grid">
                  {form.waterhammerMode === "ratio" ? (
                    <div className="input-field">
                      <label className="input-label">水撃圧/静水圧 比率</label>
                      <div className="input-control">
                        <input type="number" className="input" value={form.waterhammerRatio}
                          onChange={(e) => handleField("waterhammerRatio", e.target.value)} step="any" />
                      </div>
                    </div>
                  ) : (
                    <div className="input-field">
                      <label className="input-label">水撃圧</label>
                      <div className="input-control">
                        <input type="number" className="input" value={form.waterhammerFixed}
                          onChange={(e) => handleField("waterhammerFixed", e.target.value)} step="any" />
                        <span className="input-unit">MPa</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* プレビュー・集計 */}
            <section className="card">
              <h2 className="card-title">出力プレビュー</h2>
              {previewResult ? (
                <>
                  <div className="report-preview">
                    <div className="report-preview-item">
                      <span className="report-preview-label">測点数</span>
                      <span className="report-preview-value">{previewResult.pointResults.length} 点</span>
                    </div>
                    <div className="report-preview-item">
                      <span className="report-preview-label">最大流速</span>
                      <span className="report-preview-value">{previewResult.maxVelocity.toFixed(2)} m/s</span>
                    </div>
                    <div className="report-preview-item">
                      <span className="report-preview-label">最大設計内圧</span>
                      <span className="report-preview-value report-preview-value--hl">{previewResult.maxDesignPressure.toFixed(2)} MPa</span>
                    </div>
                    <div className="report-preview-item">
                      <span className="report-preview-label">ケース名</span>
                      <span className="report-preview-value">{previewResult.caseName}</span>
                    </div>
                  </div>
                  {previewResult.warnings.length > 0 && (
                    <div className="warnings" style={{ marginTop: 12 }}>
                      {previewResult.warnings.slice(0, 5).map((w, i) => (
                        <div key={i} className="warning-item">
                          <span className="warning-icon">⚠</span>{w}
                        </div>
                      ))}
                      {previewResult.warnings.length > 5 && (
                        <div className="warning-item">
                          …他 {previewResult.warnings.length - 5} 件の警告
                        </div>
                      )}
                    </div>
                  )}

                  <h3 className="input-group-title" style={{ marginTop: 16 }}>出力シート構成</h3>
                  <div className="report-sheets">
                    <div className="report-sheet-item">
                      <span className="report-sheet-name">水理計算書_{previewResult.caseName}</span>
                      <span className="report-sheet-desc">成果品様式準拠 24列帳票（測点・損失・動水位・設計内圧）</span>
                    </div>
                    <div className="report-sheet-item">
                      <span className="report-sheet-name">計算結果</span>
                      <span className="report-sheet-desc">水撃圧計算結果サマリー（ケース別）</span>
                    </div>
                    <div className="report-sheet-item">
                      <span className="report-sheet-name">管路データ</span>
                      <span className="report-sheet-desc">入力管路諸元（記録用）</span>
                    </div>
                    <div className="report-sheet-item">
                      <span className="report-sheet-name">案件情報</span>
                      <span className="report-sheet-desc">プロジェクトメタ情報</span>
                    </div>
                  </div>

                  <button
                    className="btn btn--primary report-download-btn"
                    onClick={handleDownload}
                    disabled={downloading}
                  >
                    {downloading ? "生成中…" : "水理計算書をダウンロード (.xlsx)"}
                  </button>
                </>
              ) : (
                <div className="result-empty">静水位を入力してください。</div>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
