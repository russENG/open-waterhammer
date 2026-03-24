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
  wdpe1: {
    type: "wdpe1",
    name: "水道配水用ポリエチレン管（1種）",
    youngsModulusShort: 21.6e6,
    isResin: true,
  },
  wdpe2: {
    type: "wdpe2",
    name: "水道配水用ポリエチレン管（2種）",
    youngsModulusShort: 19.6e6,
    isResin: true,
  },
  wdpe3: {
    type: "wdpe3",
    name: "水道配水用ポリエチレン管（3種）",
    youngsModulusShort: 16.7e6,
    isResin: true,
  },
  wdpe4: {
    type: "wdpe4",
    name: "水道配水用ポリエチレン管（4種）",
    youngsModulusShort: 15.2e6,
    isResin: true,
  },
  wdpe5: {
    type: "wdpe5",
    name: "水道配水用ポリエチレン管（5種）",
    youngsModulusShort: 14.7e6,
    isResin: true,
  },
  grp_fw: {
    type: "grp_fw",
    name: "強化プラスチック複合管（FW成形）",
    youngsModulusShort: 51e6,
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
