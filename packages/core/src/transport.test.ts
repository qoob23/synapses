import { describe, it, expect, vi } from 'vitest'
import { buildHandlerMap, buildProxy, startServer, createClient, BACKEND_METHODS, BACKEND_EVENTS } from './transport'

// A fake Window pair with synchronous postMessage: each window delivers to its OWN
// listeners with source = the partner (in this 2-window bridge a window only ever
// receives from the other), so we can exercise the real handshake/queue/req-res logic
// with no jsdom. startServer/createClient read `window` once at registration, so we set
// globalThis.window for each construction; later sends use the explicit window refs.
function makePair() {
  const mk = () => {
    const listeners = new Set<(e: { data: unknown; source: unknown }) => void>()
    return {
      listeners,
      addEventListener: (type: string, fn: (e: any) => void) => { if (type === 'message') listeners.add(fn) },
      removeEventListener: (_t: string, fn: (e: any) => void) => listeners.delete(fn),
      postMessage: (_data: unknown) => {},
    }
  }
  const main = mk()
  const iframe = mk()
  const deliver = (win: typeof main, data: unknown, source: unknown) => {
    for (const fn of [...win.listeners]) fn({ data, source })
  }
  main.postMessage = (data: unknown) => deliver(main, data, iframe)
  iframe.postMessage = (data: unknown) => deliver(iframe, data, main)
  return { main, iframe }
}

function withWindow<T>(win: unknown, fn: () => T): T {
  const g = globalThis as { window?: unknown }
  const prev = g.window
  g.window = win
  try { return fn() } finally { g.window = prev }
}

describe('transport round-trip (fake Window pair)', () => {
  it('completes the init/ready handshake and reports connected', () => {
    const { main, iframe } = makePair()
    const onConnect = vi.fn()
    const server = withWindow(main, () => startServer({}))
    const client = withWindow(iframe, () => createClient({ onConnect }))
    expect(client.isConnected()).toBe(false)
    server.init(iframe as unknown as Window)
    expect(client.isConnected()).toBe(true)
    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  it('resolves a request with the handler result and correlates by id', async () => {
    const { main, iframe } = makePair()
    const server = withWindow(main, () => startServer({ echo: (q: string) => q + '!', add: (a: number, b: number) => a + b }))
    const client = withWindow(iframe, () => createClient({}))
    server.init(iframe as unknown as Window)
    await expect(client.call('echo', 'foo')).resolves.toBe('foo!')
    await expect(client.call('add', 2, 3)).resolves.toBe(5)
  })

  it('rejects with the propagated error message when a handler throws', async () => {
    const { main, iframe } = makePair()
    const server = withWindow(main, () => startServer({ boom: () => { throw new Error('nope') } }))
    const client = withWindow(iframe, () => createClient({}))
    server.init(iframe as unknown as Window)
    await expect(client.call('boom')).rejects.toThrow('nope')
    await expect(client.call('missing')).rejects.toThrow(/unknown method/)
  })

  it('queues events fired before the handshake and flushes them in order on ready', () => {
    const { main, iframe } = makePair()
    const events: Array<[string, unknown]> = []
    const server = withWindow(main, () => startServer({}))
    server.notify('refresh', 1)
    server.notify('recenter', { page: 'a' })
    const client = withWindow(iframe, () => createClient({ onEvent: (m, p) => events.push([m, p]) }))
    expect(events).toEqual([]) // nothing delivered before the handshake
    server.init(iframe as unknown as Window)
    expect(events).toEqual([['refresh', 1], ['recenter', { page: 'a' }]])
  })

  it('carries fire-and-forget client events to the server via post/onClientEvent', () => {
    const { main, iframe } = makePair()
    const onClientEvent = vi.fn()
    const server = withWindow(main, () => startServer({}, onClientEvent))
    const client = withWindow(iframe, () => createClient({}))
    server.init(iframe as unknown as Window)
    client.post('hostScroll', { dx: 1, dy: 2 })
    expect(onClientEvent).toHaveBeenCalledWith('hostScroll', { dx: 1, dy: 2 }, iframe)
  })

  it('rejects calls made before the bridge connects', async () => {
    const { iframe } = makePair()
    const client = withWindow(iframe, () => createClient({}))
    await expect(client.call('anything')).rejects.toThrow(/not connected/)
  })
})

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
    void proxy.navigate('A')
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
    expect(BACKEND_METHODS).toHaveLength(21)
    expect(BACKEND_METHODS).toContain('buildGraph')
    expect(BACKEND_METHODS).toContain('removeLink')
    expect(BACKEND_METHODS).toContain('repairSymmetryOnce')
    expect(BACKEND_METHODS).toContain('getSize')
    expect(BACKEND_METHODS).toContain('setSize')
    expect(BACKEND_METHODS).toContain('getConnectorColors')
    expect(BACKEND_METHODS).toContain('setConnectorColors')
    expect(BACKEND_METHODS).toContain('getUiMode')
    expect(BACKEND_METHODS).toContain('histRemove')
    expect(BACKEND_EVENTS).toEqual(['recenter', 'theme', 'refresh', 'uimode'])
  })
})
