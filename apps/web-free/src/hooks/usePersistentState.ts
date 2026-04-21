/**
 * localStorage に値を同期する useState 互換フック。
 *
 * - SSR / localStorage未許可環境では初期値にフォールバック
 * - JSON 直列化できる値のみ対応（Set は serialize/deserialize オプションで変換）
 */
import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";

export interface PersistentStateOptions<T> {
  /** 保存前に呼ばれる直列化関数 */
  serialize?: (value: T) => string;
  /** 読み込み時に呼ばれる復元関数（失敗時は初期値にフォールバック） */
  deserialize?: (raw: string) => T;
}

const PREFIX = "owh:";

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    /* quota / disabled — noop */
  }
}

export function usePersistentState<T>(
  key: string,
  initialValue: T,
  options: PersistentStateOptions<T> = {},
): [T, Dispatch<SetStateAction<T>>] {
  const { serialize = JSON.stringify, deserialize = JSON.parse } = options;
  const deserializeRef = useRef(deserialize);
  deserializeRef.current = deserialize;

  const [state, setState] = useState<T>(() => {
    const raw = safeGet(key);
    if (raw === null) return initialValue;
    try {
      return deserializeRef.current(raw) as T;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      safeSet(key, serialize(state));
    } catch {
      /* serialize failure — noop */
    }
  }, [key, state, serialize]);

  return [state, setState];
}

/** Set<string> を localStorage に保存するための serialize/deserialize */
export const stringSetCodec = {
  serialize: (s: Set<string>) => JSON.stringify(Array.from(s)),
  deserialize: (raw: string): Set<string> => {
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  },
};
