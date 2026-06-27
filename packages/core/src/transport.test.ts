import { describe, it, expect, vi } from 'vitest'
import { buildHandlerMap, buildProxy, BACKEND_METHODS, BACKEND_EVENTS } from './transport'

describe('transport wiring', () => {
  it('buildHandlerMap maps each method name to backend[name]', async () => {
    const backend: any = { buildGraph: vi.fn(async () => ({ focus: 'X' })), on: vi.fn() }
    const map = buildHandlerMap(backend, ['buildGraph'])
    await map.buildGraph('X')
    expect(backend.buildGraph).toHaveBeenCalledWith('X')
  })

  it('buildProxy delegates method calls through `call` and routes events through the registrar', () => {
    const call = vi.fn(async () => true)
    let handler: ((m: string, p: any) => void) | null = null
    const proxy = buildProxy(call, (h) => { handler = h }, ['navigate'] as any, ['refresh'] as any)
    proxy.navigate('A')
    expect(call).toHaveBeenCalledWith('navigate', 'A')
    const seen = vi.fn()
    proxy.on('refresh', seen)
    handler!('refresh', undefined)
    expect(seen).toHaveBeenCalled()
  })

  it('unsubscribes a handler so it stops receiving events after unsub()', () => {
    let handler: ((m: string, p: any) => void) | null = null
    const proxy = buildProxy(vi.fn(async () => undefined), (h) => { handler = h }, ['navigate'] as any, ['refresh'] as any)
    const spy = vi.fn()
    const unsub = proxy.on('refresh', spy)
    handler!('refresh', undefined)
    expect(spy).toHaveBeenCalledTimes(1)
    unsub()
    handler!('refresh', undefined)
    expect(spy).toHaveBeenCalledTimes(1) // still 1: no longer subscribed
  })

  it('declares the full method + event manifest', () => {
    expect(BACKEND_METHODS).toHaveLength(18)
    expect(BACKEND_METHODS).toContain('buildGraph')
    expect(BACKEND_METHODS).toContain('removeLink')
    expect(BACKEND_METHODS).toContain('getSize')
    expect(BACKEND_METHODS).toContain('setSize')
    expect(BACKEND_METHODS).toContain('histRemove')
    expect(BACKEND_METHODS).toContain('histRemoveMissing')
    expect(BACKEND_EVENTS).toEqual(['recenter', 'theme', 'refresh'])
  })
})
