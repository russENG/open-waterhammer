/**
 * Excel帳票の読み取り結果型
 * シートスキーマ: docs/excel-template-spec.md 参照
 */

import type { Pipe, Node, CalculationCase } from "@open-waterhammer/core";

/** 案件情報（meta シート） */
export interface ProjectMeta {
  projectName: string;
  designer?: string | undefined;
  date?: string | undefined;
  standardId: string;
  version?: string | undefined;
  methodId?: string | undefined;
  notes?: string | undefined;
}

/** ワークブック全体の読み取り結果 */
export interface WorkbookData {
  meta: ProjectMeta;
  pipes: Pipe[];
  nodes: Node[];
  cases: CalculationCase[];
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
