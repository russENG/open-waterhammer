/**
 * Pyodide ロード状態を React コンポーネントに伝えるフック.
 */

import { useEffect, useState } from 'react'
import {
  getPyodideStatus,
  subscribePyodideStatus,
  type PyodideStatus,
} from '../lib/pyodide-bridge'

export function usePyodideStatus(): PyodideStatus {
  const [status, setStatus] = useState<PyodideStatus>(getPyodideStatus())
  useEffect(() => subscribePyodideStatus(setStatus), [])
  return status
}
