/**
 * 共通入力フィールド
 * 数値入力の範囲検証に対応し、エラー/警告をインラインで表示する。
 */

import { useMemo } from "react";

export interface InputFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  type?: "number" | "text";
  /** 下限値（未満でエラー） */
  min?: number;
  /** 上限値（超過でエラー） */
  max?: number;
  /** 推奨下限値（未満で警告。物理的には許容） */
  warnMin?: number;
  /** 推奨上限値（超過で警告。物理的には許容） */
  warnMax?: number;
  /** 必須入力（空欄でエラー） */
  required?: boolean;
  /** 警告時のラベル（例: "流速は設計指針で 0.5〜2.5 m/s が推奨"） */
  warnMessage?: string;
  step?: string;
}

type ValidationState =
  | { level: "ok" }
  | { level: "error"; msg: string }
  | { level: "warn"; msg: string };

function validate(
  value: string,
  type: "number" | "text",
  opts: Pick<InputFieldProps, "min" | "max" | "warnMin" | "warnMax" | "required" | "warnMessage">,
): ValidationState {
  const trimmed = value.trim();
  if (trimmed === "") {
    return opts.required ? { level: "error", msg: "必須項目です" } : { level: "ok" };
  }
  if (type !== "number") return { level: "ok" };

  const n = parseFloat(trimmed);
  if (isNaN(n)) return { level: "error", msg: "数値を入力してください" };

  if (opts.min !== undefined && n < opts.min) {
    return { level: "error", msg: `${opts.min} 以上を入力してください` };
  }
  if (opts.max !== undefined && n > opts.max) {
    return { level: "error", msg: `${opts.max} 以下を入力してください` };
  }
  if (opts.warnMin !== undefined && n < opts.warnMin) {
    return { level: "warn", msg: opts.warnMessage ?? `推奨下限 ${opts.warnMin} を下回っています` };
  }
  if (opts.warnMax !== undefined && n > opts.warnMax) {
    return { level: "warn", msg: opts.warnMessage ?? `推奨上限 ${opts.warnMax} を上回っています` };
  }
  return { level: "ok" };
}

export function InputField(props: InputFieldProps) {
  const {
    label, value, onChange, unit, type = "number",
    min, max, warnMin, warnMax, required, warnMessage, step = "any",
  } = props;

  const state = useMemo(
    () => validate(value, type, { min, max, warnMin, warnMax, required, warnMessage }),
    [value, type, min, max, warnMin, warnMax, required, warnMessage],
  );

  const inputClass =
    state.level === "error" ? "input input--error"
    : state.level === "warn" ? "input input--warn"
    : "input";

  return (
    <div className="input-field">
      <label className="input-label">{label}</label>
      <div className="input-control">
        <input
          type={type}
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          step={type === "number" ? step : undefined}
          aria-invalid={state.level === "error" || undefined}
        />
        {unit && <span className="input-unit">{unit}</span>}
      </div>
      {state.level !== "ok" && (
        <div className={`input-msg input-msg--${state.level}`}>
          <span className="input-msg-icon">{state.level === "error" ? "⚠" : "ⓘ"}</span>
          {state.msg}
        </div>
      )}
    </div>
  );
}
