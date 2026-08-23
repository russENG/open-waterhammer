import { act, renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { usePyodideStatus } from '../usePyodideStatus'

type Status = 'idle' | 'loading' | 'ready' | 'error'

let currentStatus: Status = 'idle'
const listeners = new Set<(next: Status) => void>()

vi.mock('../../lib/pyodide-bridge', () => ({
  getPyodideStatus: () => currentStatus,
  subscribePyodideStatus: (listener: (next: Status) => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}))

function emit(next: Status) {
  currentStatus = next
  listeners.forEach((listener) => listener(next))
}

describe('usePyodideStatus', () => {
  test('reflects the bridge status at mount and through loading → ready transitions', () => {
    currentStatus = 'idle'
    const { result } = renderHook(() => usePyodideStatus())
    expect(result.current).toBe('idle')

    act(() => emit('loading'))
    expect(result.current).toBe('loading')

    act(() => emit('ready'))
    expect(result.current).toBe('ready')
  })

  test('reflects an error transition and unsubscribes from the bridge on unmount', () => {
    currentStatus = 'idle'
    listeners.clear()
    const { result, unmount } = renderHook(() => usePyodideStatus())
    expect(listeners.size).toBe(1)

    act(() => emit('error'))
    expect(result.current).toBe('error')

    unmount()
    expect(listeners.size).toBe(0)
  })

  test('picks up a status that already changed before the component mounted', () => {
    currentStatus = 'ready'
    const { result } = renderHook(() => usePyodideStatus())
    expect(result.current).toBe('ready')
  })
})
