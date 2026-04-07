/**
 * セッションレポート出力モジュール
 *
 * 要旨 §3.3: 入力条件表・計算条件表・結果整理表を相互に対応づけて管理
 * 要旨 §5.4: 条件追跡情報を含むExcel出力
 *
 * シート構成:
 *   ① 入力条件表    — 管路諸元・境界条件
 *   ② 計算条件表    — MOCパラメータ・閉鎖シナリオ
 *   ③ 結果整理表    — 管路別包絡線・ノード別極値
 *   ④ 条件変更履歴  — セッション変更ログ
 *   ⑤ ケース比較    — 2セッション間の差分（オプション）
 */

import * as XLSX from "xlsx";
import type { CalculationSession, MocResultSummary, SessionDiffItem } from "@open-waterhammer/core";
import { headToMpa } from "@open-waterhammer/core";

// ─── 入力型 ──────────────────────────────────────────────────────────────────

export interface SessionReportInput {
  /** 主セッション */
  session: CalculationSession;
  /** 比較セッション（オプション） */
  compareSession?: CalculationSession;
  /** 比較差分（オプション、compareSession 指定時に必要） */
  diffs?: SessionDiffItem[];
  /** 案件名 */
  projectName?: string;
}

// ─── ヘルパー ────────────────────────────────────────────────────────────────

function n(v: number | undefined, d = 3): string {
  return v !== undefined && isFinite(v) ? v.toFixed(d) : "—";
}

function autoCols(ws: XLSX.WorkSheet, rows: unknown[][]): void {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, ci) => {
      const len = String(cell ?? "").length;
      if (!widths[ci] || widths[ci]! < len) widths[ci] = len;
    });
  }
  ws["!cols"] = widths.map(w => ({ wch: Math.min(w + 2, 40) }));
}

function styleHeader(ws: XLSX.WorkSheet, rowIdx: number, colCount: number): void {
  for (let ci = 0; ci < colCount; ci++) {
    const addr = XLSX.utils.encode_cell({ r: rowIdx, c: ci });
    if (!ws[addr]) continue;
    ws[addr].s = {
      font: { bold: true },
      fill: { fgColor: { rgb: "1A1A2E" }, patternType: "solid" },
      alignment: { horizontal: "center" },
    };
  }
}

function categoryLabel(cat: string): string {
  switch (cat) {
    case "input": return "入力条件";
    case "steady": return "定常計算";
    case "moc": return "非定常解析";
    case "meta": return "メタ情報";
    default: return cat;
  }
}

// ─── シート①: 入力条件表 ─────────────────────────────────────────────────────

function makeInputSheet(session: CalculationSession): XLSX.WorkSheet {
  const title = [
    [`入力条件表 — ${session.name}`],
    [`セッションID: ${session.id}　作成: ${session.createdAt}`],
    [],
  ];

  // 管路諸元
  const pipeHeader = ["管路ID", "管種", "内径D [m]", "管厚t [m]", "延長L [m]", "粗度C", "始点", "終点"];
  const pipeRows = session.pipes.map(p => [
    p.id, p.pipeType, p.innerDiameter, p.wallThickness, p.length, p.roughnessCoeff, p.startNodeId, p.endNodeId,
  ]);

  // 測点データ
  const ptHeader = ["測点ID", "水平距離 [m]", "地盤高 [m]", "管中心高 [m]", "管長 [m]", "流量 [m³/s]", "管径 [m]", "粗度C"];
  const ptRows = session.measurementPoints.map(pt => [
    pt.id, pt.horizontalDistance, pt.groundLevel, pt.pipeCenterHeight, pt.pipeLength, pt.flowRate, pt.diameter, pt.roughnessC,
  ]);

  const materialRow = session.material
    ? [[], ["管種指定", session.material.pipeType, session.material.wallThickness ? `t=${session.material.wallThickness}m` : ""]]
    : [];

  const allRows = [
    ...title,
    ["■ 管路諸元"], pipeHeader, ...pipeRows,
    [],
    ["■ 測点データ"], ptHeader, ...ptRows,
    ...materialRow,
  ];

  const ws = XLSX.utils.aoa_to_sheet(allRows);
  autoCols(ws, allRows);
  styleHeader(ws, title.length, pipeHeader.length);
  styleHeader(ws, title.length + 1 + pipeRows.length + 2, ptHeader.length);
  return ws;
}

// ─── シート②: 計算条件表 ─────────────────────────────────────────────────────

function makeCalcCondSheet(session: CalculationSession): XLSX.WorkSheet {
  const title = [
    [`計算条件表 — ${session.name}`],
    [],
  ];

  const rows: unknown[][] = [];

  // 定常計算条件
  rows.push(["■ 定常計算条件"]);
  if (session.steadyInput) {
    rows.push(["静水位 [m]", session.steadyInput.staticWaterLevel]);
    rows.push(["ケース名", session.steadyInput.caseName ?? "—"]);
  } else {
    rows.push(["（未計算）"]);
  }
  rows.push([]);

  // MOC条件
  rows.push(["■ MOC解析条件"]);
  if (session.mocOptions) {
    rows.push(["シミュレーション時間 tMax [s]", session.mocOptions.tMax ?? "自動"]);
  }
  if (session.mocNetwork) {
    rows.push(["管路セグメント数", session.mocNetwork.pipes.length]);
    const nodeIds = Object.keys(session.mocNetwork.nodes);
    rows.push(["境界条件ノード数", nodeIds.length]);
    for (const nid of nodeIds) {
      const bc = session.mocNetwork.nodes[nid]!;
      rows.push([`  ${nid}`, bcTypeLabel(bc.type), bcParamSummary(bc)]);
    }
  } else {
    rows.push(["（未設定）"]);
  }

  const allRows = [...title, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(allRows);
  autoCols(ws, allRows);
  return ws;
}

function bcParamSummary(bc: any): string {
  switch (bc.type) {
    case "reservoir": return `水頭H=${bc.head}m`;
    case "valve": return `流量Q₀=${bc.Q0}m³/s, 水頭H₀=${bc.H0v}m, 閉鎖時間=${bc.closeTime}s, ${bc.operation === "open" ? "開操作" : "閉操作"}`;
    case "pump": return `流量Q₀=${bc.Q0}m³/s, 揚程H₀=${bc.H0}m, 停止時間=${bc.shutdownTime ?? 0}s`;
    case "air_chamber": return `空気容積V₀=${bc.V_air0}m³, 初期水頭H₀=${bc.H_air0}m, ポリトロープ指数m=${bc.polytropicIndex ?? 1.2}`;
    case "surge_tank": return `断面積A=${bc.tankArea}m², 初期水位z₀=${bc.initialLevel}m`;
    case "air_release_valve": return "大気圧開放（負圧防止）";
    case "pressure_reducing_valve": return `設定水頭H=${bc.setHead}m, 流量Q₀=${bc.Q0}m³/s`;
    case "dead_end": return "行き止まり（Q=0）";
    default: return "";
  }
}

function bcTypeLabel(type: string): string {
  switch (type) {
    case "reservoir": return "貯水槽";
    case "valve": return "バルブ";
    case "pump": return "ポンプ";
    case "air_chamber": return "エアチャンバ";
    case "surge_tank": return "サージタンク";
    case "air_release_valve": return "吸気弁";
    case "pressure_reducing_valve": return "減圧バルブ";
    case "dead_end": return "行き止まり";
    default: return type;
  }
}

// ─── シート③: 結果整理表 ─────────────────────────────────────────────────────

function makeResultSheet(session: CalculationSession): XLSX.WorkSheet {
  const title = [
    [`結果整理表 — ${session.name}`],
    [],
  ];

  const rows: unknown[][] = [];

  // 定常計算結果
  rows.push(["■ 定常計算結果"]);
  if (session.steadyResult) {
    const sr = session.steadyResult;
    rows.push(["ケース名", sr.caseName]);
    rows.push(["静水位 [m]", n(sr.staticWaterLevel, 3)]);
    rows.push(["最大流速 [m/s]", n(sr.maxVelocity, 3)]);
    rows.push(["最大設計内圧 [MPa]", n(sr.maxDesignPressure, 4)]);
    if (sr.warnings.length > 0) {
      rows.push(["警告", sr.warnings.join("; ")]);
    }
  } else {
    rows.push(["（未計算）"]);
  }
  rows.push([]);

  // MOC結果サマリー
  rows.push(["■ MOC解析結果"]);
  if (session.mocSummary) {
    const ms = session.mocSummary;
    rows.push(["時間刻み dt [s]", n(ms.dt, 4)]);
    rows.push(["シミュレーション時間 tMax [s]", n(ms.tMax, 2)]);
    rows.push([]);

    // 管路別包絡線
    rows.push(["管路ID", "波速 [m/s]", "振動周期 [s]", "Hmax [m]", "Hmin [m]", "Hmax [MPa]"]);
    for (const [pid, env] of Object.entries(ms.pipeEnvelopes)) {
      const hmax = Math.max(...env.Hmax);
      const hmin = Math.min(...env.Hmin);
      rows.push([pid, n(env.waveSpeed, 1), n(env.vibrationPeriod, 3), n(hmax, 2), n(hmin, 2), n(headToMpa(hmax), 4)]);
    }
    rows.push([]);

    // ノード別極値
    rows.push(["ノードID", "最大水頭 [m]", "最小水頭 [m]", "最大水頭 [MPa]"]);
    for (const [nid, ext] of Object.entries(ms.nodeExtremes)) {
      rows.push([nid, n(ext.maxH, 2), n(ext.minH, 2), n(headToMpa(ext.maxH), 4)]);
    }
  } else {
    rows.push(["（未計算）"]);
  }

  const allRows = [...title, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(allRows);
  autoCols(ws, allRows);
  return ws;
}

// ─── シート④: 条件変更履歴 ──────────────────────────────────────────────────

function makeChangeLogSheet(session: CalculationSession): XLSX.WorkSheet {
  const title = [
    [`条件変更履歴 — ${session.name}`],
    [],
  ];

  const header = ["日時", "区分", "対象フィールド", "変更前", "変更後", "説明"];
  const rows = session.changes.map(c => [
    c.timestamp, categoryLabel(c.category), c.field, c.oldValue ?? "", c.newValue ?? "", c.description ?? "",
  ]);

  const allRows = [...title, header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(allRows);
  styleHeader(ws, title.length, header.length);
  autoCols(ws, allRows);
  return ws;
}

// ─── シート⑤: ケース比較 ───────────────────────────────────────────────────

function makeDiffSheet(diffs: SessionDiffItem[], nameA: string, nameB: string): XLSX.WorkSheet {
  const title = [
    [`ケース比較: ${nameA} ⇔ ${nameB}`],
    [],
  ];

  const header = ["区分", "項目", "ラベル", nameA, nameB, "変更有無"];
  const rows = diffs.map(d => [
    categoryLabel(d.category), d.field, d.label, d.valueA ?? "", d.valueB ?? "", d.changed ? "●" : "",
  ]);

  const allRows = [...title, header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(allRows);
  styleHeader(ws, title.length, header.length);
  autoCols(ws, allRows);
  return ws;
}

// ─── メイン ──────────────────────────────────────────────────────────────────

/**
 * セッションレポートを Excel ワークブックとして出力する。
 *
 * 入力条件・計算条件・結果・変更履歴を一体化し、
 * 条件追跡性と再計算性を確保する。
 *
 * @returns xlsx ファイルの Buffer
 */
export function generateSessionReport(input: SessionReportInput): Buffer {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, makeInputSheet(input.session), "入力条件表");
  XLSX.utils.book_append_sheet(wb, makeCalcCondSheet(input.session), "計算条件表");
  XLSX.utils.book_append_sheet(wb, makeResultSheet(input.session), "結果整理表");
  XLSX.utils.book_append_sheet(wb, makeChangeLogSheet(input.session), "変更履歴");

  if (input.compareSession && input.diffs) {
    XLSX.utils.book_append_sheet(
      wb,
      makeDiffSheet(input.diffs, input.session.name, input.compareSession.name),
      "ケース比較",
    );
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
