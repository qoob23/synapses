import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogger, createBufferedSink, wrapBackendWithLogging, wrapDataSource } from './logger'
import type { DataSource, SynapsesBackend } from './types'

describe('createLogger', () => {
  it('writes one JSONL record per log() with t/ctx/cat/act + data, only while enabled', () => {
    const lines: string[] = []
    const lg = createLogger((l) => lines.push(l), { ctx: 'M', enabled: false })
    lg.log('user', 'activate', { name: 'A' })
    expect(lines).toEqual([]) // disabled → nothing
    lg.setEnabled(true)
    lg.log('user', 'activate', { name: 'A' })
    expect(lines).toHaveLength(1)
    const rec = JSON.parse(lines[0]) as Record<string, unknown>
    expect(rec).toMatchObject({ ctx: 'M', cat: 'user', act: 'activate', name: 'A' })
    expect(typeof rec.t).toBe('string')
  })

  it('ingest() forwards a pre-built line verbatim when enabled', () => {
    const lines: string[] = []
    const lg = createLogger((l) => lines.push(l), { ctx: 'M', enabled: true })
    lg.ingest('{"ctx":"P","cat":"ui","act":"render"}')
    expect(lines).toEqual(['{"ctx":"P","cat":"ui","act":"render"}'])
    lg.setEnabled(false)
    lg.ingest('{"dropped":true}')
    expect(lines).toHaveLength(1)
  })

  it('mirrors a plain-text line to the console sink alongside the JSONL write', () => {
    const lines: string[] = []
    const mir: string[] = []
    const lg = createLogger((l) => lines.push(l), { ctx: 'M', enabled: true, mirror: (s) => mir.push(s) })
    lg.log('user', 'activate', { name: 'A' })
    expect(lines).toHaveLength(1)
    expect(mir).toHaveLength(1)
    expect(mir[0]).toContain('M user/activate')
    expect(mir[0]).toContain('name=A')
  })
})

describe('createBufferedSink', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('seeds from load(), appends, and persists the whole buffer after the debounce', async () => {
    let saved = ''
    const sink = createBufferedSink({
      load: async () => 'old\n',
      persist: async (t) => { saved = t },
      flushMs: 100,
    })
    await vi.advanceTimersByTimeAsync(0) // let load() resolve
    sink.write('new')
    await vi.advanceTimersByTimeAsync(100)
    expect(saved).toBe('old\nnew\n')
  })

  it('queues writes that land before load() resolves, in order', async () => {
    let saved = ''
    const sink = createBufferedSink({
      load: async () => 'a\n',
      persist: async (t) => { saved = t },
      flushMs: 50,
    })
    sink.write('b') // before load resolves
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(50)
    expect(saved).toBe('a\nb\n')
  })

  it('clear() empties the buffer and overwrites the on-disk log immediately', async () => {
    let saved = 'stale\n'
    const sink = createBufferedSink({
      load: async () => 'old\n',
      persist: async (t) => { saved = t },
      flushMs: 100,
    })
    sink.clear()
    expect(saved).toBe('') // persisted synchronously, no debounce
    await vi.advanceTimersByTimeAsync(0) // a late load() must not resurrect 'old\n'
    sink.write('new')
    await vi.advanceTimersByTimeAsync(100)
    expect(saved).toBe('new\n')
  })

  it('drops oldest whole lines past capBytes (rolling JSONL)', async () => {
    let saved = ''
    const sink = createBufferedSink({
      load: async () => null,
      persist: async (t) => { saved = t },
      flushMs: 10,
      capBytes: 8,
    })
    await vi.advanceTimersByTimeAsync(0)
    sink.write('aaaa') // 'aaaa\n' = 5
    sink.write('bbbb') // would be 10 > 8 → drop the first line
    await vi.advanceTimersByTimeAsync(10)
    expect(saved).toBe('bbbb\n')
  })
})

function fakeBackend(over: Partial<SynapsesBackend> = {}): SynapsesBackend {
  const base = {
    buildGraph: vi.fn(async () => ({ focus: 'A', parents: [], children: [], jumps: [], siblings: [], siblingsTruncated: false, siblingParent: {} })),
    createChild: vi.fn(async () => true),
    on: vi.fn(() => () => {}),
  } as unknown as SynapsesBackend
  return Object.assign(base, over)
}

describe('wrapBackendWithLogging', () => {
  it('logs a call line with briefed args + ok + ms, and returns the result', async () => {
    const lines: string[] = []
    const lg = createLogger((l) => lines.push(l), { ctx: 'M', enabled: true })
    const be = wrapBackendWithLogging(fakeBackend(), lg)
    const g = await be.buildGraph('A')
    expect(g.focus).toBe('A')
    const rec = JSON.parse(lines.find((l) => l.includes('buildGraph'))!) as Record<string, unknown>
    expect(rec).toMatchObject({ cat: 'call', act: 'buildGraph', ok: true })
    expect(rec.args).toEqual(['A'])
  })

  it('collapses array args to a count', async () => {
    const lines: string[] = []
    const lg = createLogger((l) => lines.push(l), { ctx: 'M', enabled: true })
    const be = wrapBackendWithLogging(fakeBackend({ nodeAdjacency: vi.fn(async () => ({})) }), lg)
    await be.nodeAdjacency(['A', 'B', 'C'])
    const rec = JSON.parse(lines.find((l) => l.includes('nodeAdjacency'))!) as Record<string, unknown>
    expect(rec.args).toEqual([{ n: 3 }])
  })

  it('logs ok:false + err and rethrows on failure', async () => {
    const lines: string[] = []
    const lg = createLogger((l) => lines.push(l), { ctx: 'M', enabled: true })
    const be = wrapBackendWithLogging(fakeBackend({ createChild: vi.fn(async () => { throw new Error('boom') }) }), lg)
    await expect(be.createChild('A', 'B')).rejects.toThrow('boom')
    const rec = JSON.parse(lines.find((l) => l.includes('createChild'))!) as Record<string, unknown>
    expect(rec).toMatchObject({ ok: false, err: 'boom' })
  })

  it('does not log while disabled but still delegates', async () => {
    const lines: string[] = []
    const lg = createLogger((l) => lines.push(l), { ctx: 'M', enabled: false })
    const inner = fakeBackend()
    const be = wrapBackendWithLogging(inner, lg)
    await be.buildGraph('A')
    expect(lines).toEqual([])
    expect(inner.buildGraph).toHaveBeenCalledWith('A')
  })
})

describe('wrapDataSource', () => {
  it('logs each write with page/key/targets and delegates; reads pass through unlogged', async () => {
    const lines: string[] = []
    const lg = createLogger((l) => lines.push(l), { ctx: 'M', enabled: true })
    const inner: DataSource = {
      getPageProps: vi.fn(async () => ({})),
      ensurePage: vi.fn(async () => {}),
      setPropertyLinks: vi.fn(async () => {}),
      removePropertyKey: vi.fn(async () => {}),
      searchPages: vi.fn(async () => []),
    }
    const ds = wrapDataSource(inner, lg)
    await ds.getPageProps('A')
    await ds.setPropertyLinks('A', 'child', ['B'])
    await ds.removePropertyKey('A', 'child')
    expect(inner.setPropertyLinks).toHaveBeenCalledWith('A', 'child', ['B'])
    expect(lines.some((l) => l.includes('getPageProps'))).toBe(false) // reads unlogged
    const set = JSON.parse(lines.find((l) => l.includes('setPropertyLinks'))!) as Record<string, unknown>
    expect(set).toMatchObject({ cat: 'edit', act: 'setPropertyLinks', page: 'A', key: 'child', targets: ['B'] })
  })

  it('preserves and logs getBacklinks (forwarded result + a read line)', async () => {
    const lines: string[] = []
    const lg = createLogger((l) => lines.push(l), { ctx: 'M', enabled: true })
    const inner: DataSource = {
      getPageProps: vi.fn(async () => ({})),
      ensurePage: vi.fn(async () => {}),
      setPropertyLinks: vi.fn(async () => {}),
      removePropertyKey: vi.fn(async () => {}),
      searchPages: vi.fn(async () => []),
      getBacklinks: vi.fn(async () => [{ name: 'B', props: { parent: ['A'] } }]),
    }
    const ds = wrapDataSource(inner, lg)
    expect(typeof ds.getBacklinks).toBe('function')
    const r = await ds.getBacklinks!('A')
    expect(r).toEqual([{ name: 'B', props: { parent: ['A'] } }])
    expect(inner.getBacklinks).toHaveBeenCalledWith('A')
    const line = lines.find((l) => l.includes('getBacklinks'))
    expect(line).toBeDefined()
    expect(JSON.parse(line!)).toMatchObject({ cat: 'read', act: 'getBacklinks', page: 'A' })
  })

  it('omits getBacklinks when the inner source lacks it', () => {
    const lg = createLogger(() => {}, { ctx: 'M', enabled: true })
    const inner: DataSource = {
      getPageProps: vi.fn(async () => ({})), ensurePage: vi.fn(async () => {}),
      setPropertyLinks: vi.fn(async () => {}), removePropertyKey: vi.fn(async () => {}),
      searchPages: vi.fn(async () => []),
    }
    expect(wrapDataSource(inner, lg).getBacklinks).toBeUndefined()
  })
})
