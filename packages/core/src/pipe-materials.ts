/**
 * 管材別物性値
 * 出典: 土地改良設計基準パイプライン技術書 表-8.2.1
 */

import type { PipeType } from "./types.js";

export interface PipeMaterial {
  type: PipeType;
  name: string;
  /** 短期ヤング係数 Eₛ [kN/m²] */
  youngsModulusShort: number;
  /** 樹脂系管材の場合 true (長期 = Eₛ × 0.8) */
  isResin: boolean;
}

export const PIPE_MATERIALS: Record<PipeType, PipeMaterial> = {
  steel: {
    type: "steel",
    name: "鋼管",
    youngsModulusShort: 200e6,
    isResin: false,
  },
  ductile_iron: {
    type: "ductile_iron",
    name: "ダクタイル鋳鉄管",
    youngsModulusShort: 160e6,
    isResin: false,
  },
  rcp: {
    type: "rcp",
    name: "遠心力鉄筋コンクリート管",
    youngsModulusShort: 20e6,
    isResin: false,
  },
  cpcp: {
    type: "cpcp",
    name: "コア式プレストレストコンクリート管",
    youngsModulusShort: 39e6,
    isResin: false,
  },
  upvc: {
    type: "upvc",
    name: "硬質ポリ塩化ビニル管",
    youngsModulusShort: 3e6,
    isResin: true,
  },
  pe2: {
    type: "pe2",
    name: "一般用ポリエチレン管（2種）",
    youngsModulusShort: 1e6,
    isResin: true,
  },
  pe3_pe100: {
    type: "pe3_pe100",
    name: "一般用ポリエチレン管（3種 PE100）",
    youngsModulusShort: 1.3e6,
    isResin: true,
  },
  // 水道配水用ポリエチレン管 (JIS K 6762)
  // 技術書 表-8.2.1: Eₛ = 1.3×10⁶ kN/m²（pe3_pe100 と同値）
  wdpe: {
    type: "wdpe",
    name: "水道配水用ポリエチレン管",
    youngsModulusShort: 1.3e6,
    isResin: true,
  },
  // 強化プラスチック複合管（FW成形）— 技術書 表-8.2.1 注2
  // FW成形 5〜1種: 21.6, 19.6, 16.7, 15.2, 14.7 (×10⁶ kN/m²)
  // 種番号が大きいほど Eₛ が大きい（高剛性）
  grp_fw1: {
    type: "grp_fw1",
    name: "強化プラスチック複合管 FW（1種）",
    youngsModulusShort: 14.7e6,
    isResin: true,
  },
  grp_fw2: {
    type: "grp_fw2",
    name: "強化プラスチック複合管 FW（2種）",
    youngsModulusShort: 15.2e6,
    isResin: true,
  },
  grp_fw3: {
    type: "grp_fw3",
    name: "強化プラスチック複合管 FW（3種）",
    youngsModulusShort: 16.7e6,
    isResin: true,
  },
  grp_fw4: {
    type: "grp_fw4",
    name: "強化プラスチック複合管 FW（4種）",
    youngsModulusShort: 19.6e6,
    isResin: true,
  },
  grp_fw5: {
    type: "grp_fw5",
    name: "強化プラスチック複合管 FW（5種）",
    youngsModulusShort: 21.6e6,
    isResin: true,
  },
  gfpe: {
    type: "gfpe",
    name: "ガラス繊維強化ポリエチレン管",
    youngsModulusShort: 2.5e6,
    isResin: true,
  },
};

/** 長期ヤング係数 [kN/m²]（樹脂系: × 0.8、その他: 短期値と同じ） */
export function getLongTermYoungsModulus(type: PipeType): number {
  const mat = PIPE_MATERIALS[type];
  return mat.isResin ? mat.youngsModulusShort * 0.8 : mat.youngsModulusShort;
}
