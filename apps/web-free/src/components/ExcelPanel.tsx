/**
 * Excel 入出力パネル
 * - テンプレート xlsx ダウンロード
 * - xlsx アップロード → 計算ケース読み込み
 */

import { useRef, useState } from "react";
import { calcLongitudinalHydraulic } from "@open-waterhammer/core";
// xlsx は大きいため動的インポートで分離
async function getExcelIO() {
  return import("@open-waterhammer/excel-io");
}
import type { WorkbookData, ParseError } from "@open-waterhammer/excel-io";
import {
  DEMO_CASE_01_PIPE,
  DEMO_CASE_01_CASE,
  DEMO_CASE_02_PIPE,
  DEMO_CASE_02_CASE,
  DEMO_MEASUREMENT_POINTS,
} from "@open-waterhammer/sample-data";

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ExcelPanelProps {
  /** アップロード成功時に呼び出す */
  onLoad: (data: WorkbookData) => void;
  /** 読み込み済みデータ（レポート出力用） */
  loadedData?: WorkbookData | null;
  /** デモ中はデフォルト折りたたみ */
  collapsedByDefault?: boolean;
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

export function ExcelPanel({ onLoad, loadedData, collapsedByDefault }: ExcelPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [errors, setErrors] = useState<ParseError[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [open, setOpen] = useState(!collapsedByDefault);

  // ─── テンプレートダウンロード ───────────────────────────────────────────────

  async function handleDownload() {
    const { generateTemplate } = await getExcelIO();
    const buf = generateTemplate({
      meta: {
        projectName: "（案件名を入力）",
        standardId: "nochi_pipeline_2021",
        methodId: "joukowsky_v1",
      },
      pipes: [DEMO_CASE_01_PIPE, DEMO_CASE_02_PIPE],
      nodes: [],
      cases: [DEMO_CASE_01_CASE, DEMO_CASE_02_CASE],
      measurementPoints: DEMO_MEASUREMENT_POINTS,
    });

    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "waterhammer-template.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── 読込データの再エクスポート（入力形式のまま） ──────────────────────────

  async function handleExportInput() {
    if (!loadedData) return;
    const { generateTemplate } = await getExcelIO();
    const buf = generateTemplate({
      meta: loadedData.meta,
      pipes: loadedData.pipes,
      nodes: loadedData.nodes,
      cases: loadedData.cases,
      measurementPoints: loadedData.measurementPoints,
    });

    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = loadedData.meta.projectName
      ? loadedData.meta.projectName.replace(/[\\/:*?"<>|]/g, "_")
      : "waterhammer-input";
    a.download = `${baseName}-${stamp}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── レポート出力 ───────────────────────────────────────────────────────────

  async function handleReportDownload() {
    if (!loadedData) return;

    const { generateReport } = await getExcelIO();

    // 縦断計算を実行（測点データがある場合）
    const hydraulicResults = [];
    if (loadedData.measurementPoints.length > 0) {
      // デフォルト条件で計算（ユーザーが条件を調整するのはStep 1のUI側）
      const result = calcLongitudinalHydraulic({
        points: loadedData.measurementPoints,
        staticWaterLevel: 0, // 仮値 — 要改善
        waterhammerRatio: 0.4,
        caseName: "計画最大流量",
      });
      hydraulicResults.push(result);
    }

    const buf = generateReport({
      meta: loadedData.meta,
      data: loadedData,
      results: [], // 水撃圧計算結果は別途
      hydraulicResults: hydraulicResults.length > 0 ? hydraulicResults : undefined,
    });

    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `waterhammer-report-${loadedData.meta.projectName || "unnamed"}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── アップロード ───────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    setStatus("loading");
    setErrors([]);
    setWarnings([]);
    setFileName(file.name);

    try {
      const buf = await file.arrayBuffer();
      const { parseWorkbook } = await getExcelIO();
      const result = parseWorkbook(buf);

      setErrors(result.errors);
      setWarnings(result.warnings);

      const hasBlockingError = result.errors.length > 0 &&
        result.data.pipes.length === 0 && result.data.cases.length === 0;

      if (hasBlockingError) {
        setStatus("error");
      } else {
        setStatus("ok");
        onLoad(result.data);
      }
    } catch (e) {
      setErrors([{ sheet: "(global)", message: String(e) }]);
      setStatus("error");
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  return (
    <section className="card excel-panel">
      <button
        type="button"
        className="excel-panel-toggle"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <h2 className="card-title" style={{ margin: 0 }}>
          Excel 入出力（自分の管路データを使う場合）
        </h2>
        <span className="excel-panel-toggle-icon">{open ? '▲' : '▼'}</span>
      </button>

      {!open ? null : (
      <>
      <div className="excel-actions">
        {/* ダウンロード */}
        <div className="excel-action-group">
          <div className="excel-action-label">テンプレート</div>
          <button className="btn btn--secondary" onClick={handleDownload}>
            <span className="btn-icon">↓</span>
            入力テンプレートをダウンロード (.xlsx)
          </button>
          <p className="excel-action-note">
            管路諸元・ケース設定を記入して読み込んでください。
          </p>
          <p className="excel-action-note" style={{ color: "#c05621", fontWeight: 600 }}>
            ⚠ 同梱のサンプル値（管路・節点・ケース・測点データ）は、土地改良事業計画設計基準
            「パイプライン」成果品様式の記入例から作成した<strong>ダミーデータ</strong>です。
            実案件には使用せず、必ずご自身の設計値に書き換えてください。
          </p>
        </div>

        {/* アップロード */}
        <div className="excel-action-group">
          <div className="excel-action-label">読み込み</div>
          <div
            className={`excel-dropzone${status === "loading" ? " excel-dropzone--loading" : ""}`}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              style={{ display: "none" }}
              onChange={handleInputChange}
            />
            {status === "loading" ? (
              <span className="excel-dropzone-text">読み込み中…</span>
            ) : (
              <>
                <span className="excel-dropzone-icon">📂</span>
                <span className="excel-dropzone-text">
                  xlsx ファイルをドロップ、またはクリックして選択
                </span>
              </>
            )}
          </div>
        </div>
        {/* 入力データの再エクスポート */}
        {loadedData && (
          <div className="excel-action-group">
            <div className="excel-action-label">入力データ保存</div>
            <button className="btn btn--secondary" onClick={handleExportInput}>
              <span className="btn-icon">↓</span>
              読込データを入力形式で保存 (.xlsx)
            </button>
            <p className="excel-action-note">
              現在読込中の管路・節点・ケース・測点データを入力テンプレート形式で保存します。
              UI側で調整した値を反映させる場合は、出力したxlsxを直接編集して再読込してください。
            </p>
          </div>
        )}
        {/* レポート出力 */}
        {loadedData && (
          <div className="excel-action-group">
            <div className="excel-action-label">レポート出力</div>
            <button className="btn btn--secondary" onClick={handleReportDownload}>
              <span className="btn-icon">↓</span>
              計算結果レポートをダウンロード (.xlsx)
            </button>
            <p className="excel-action-note">
              読み込んだデータと計算結果を成果品様式で出力します。
            </p>
          </div>
        )}
      </div>

      {/* 結果表示 */}
      {status === "ok" && (
        <div className="excel-result excel-result--ok">
          <span className="excel-result-icon">✓</span>
          <span>{fileName} を読み込みました。下の計算パラメータに反映されています。</span>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="warnings" style={{ marginTop: 12 }}>
          {warnings.map((w, i) => (
            <div key={i} className="warning-item">
              <span className="warning-icon">⚠</span>{w}
            </div>
          ))}
        </div>
      )}

      {errors.length > 0 && (
        <div className="excel-errors">
          {errors.map((e, i) => (
            <div key={i} className="excel-error-item">
              <span className="excel-error-location">
                [{e.sheet}{e.row != null ? ` 行${e.row}` : ""}{e.field ? ` / ${e.field}` : ""}]
              </span>
              {e.message}
            </div>
          ))}
        </div>
      )}
      </>
      )}
    </section>
  );
}
