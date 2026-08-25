/**
 * Excel帳票の読み取り結果型
 * シートスキーマ: docs/excel-template-spec.md 参照
 */

import type { Pipe, Node, CalculationCase, MeasurementPoint } from "@open-waterhammer/core";

/** 案件情報（meta シート） */
export interface ProjectMeta {
  projectName: string;
  designer?: string | undefined;
  date?: string | undefined;
  standardId: string;
  version?: string | undefined;
  methodId?: string | undefined;
  /**
   * 静水位 [m]（上流水槽・吐水槽の HWL）
   *
   * 縦断水理計算の初期エネルギー標高。未入力だと 0 で計算され結果が丸ごと変わるため、
   * 案件情報シートで受け取る。
   */
  staticWaterLevel?: number | undefined;
  notes?: string | undefined;
}

/** ワークブック全体の読み取り結果 */
export interface WorkbookData {
  meta: ProjectMeta;
  pipes: Pipe[];
  nodes: Node[];
  cases: CalculationCase[];
  /** 測点データ（水理計算書用） */
  measurementPoints: MeasurementPoint[];
}

/** 読み取りエラー情報 */
export interface ParseError {
  sheet: string;
  row?: number;
  field?: string;
  message: string;
}

/** 読み取り結果（エラーを含む場合でも部分的なデータを返す） */
export interface ParseResult {
  data: WorkbookData;
  errors: ParseError[];
  warnings: string[];
}
