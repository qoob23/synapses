import { describe, it, expect } from 'vitest'
import { pushEntry, jumpTo, serialize, deserialize, createHistory } from './history.js'

describe('pushEntry', () => {
  it('appends a new entry and points idx at it', () => {
    expect(pushEntry({ stack: [], idx: -1 }, 'A')).toEqual({ stack: ['A'], idx: 0 })
    expect(pushEntry({ stack: ['A'], idx: 0 }, 'B')).toEqual({ stack: ['A', 'B'], idx: 1 })
  })

  it('is a no-op when re-pushing the current entry (case-insensitive)', () => {
    expect(pushEntry({ stack: ['A'], idx: 0 }, 'a')).toEqual({ stack: ['A'], idx: 0 })
  })

  it('truncates forward history on divergence', () => {
    expect(pushEntry({ stack: ['A', 'B', 'C'], idx: 0 }, 'X')).toEqual({ stack: ['A', 'X'], idx: 1 })
  })

  it('moves a re-activated entry to the right-most position (de-dupe)', () => {
    expect(pushEntry({ stack: ['A', 'B', 'C'], idx: 2 }, 'A')).toEqual({ stack: ['B', 'C', 'A'], idx: 2 })
    // case-insensitive, keeps the freshly-pushed casing
    expect(pushEntry({ stack: ['A', 'B', 'C'], idx: 2 }, 'b')).toEqual({ stack: ['A', 'C', 'b'], idx: 2 })
  })

  it('caps the stack length, dropping the oldest', () => {
    const r = pushEntry({ stack: ['A', 'B', 'C'], idx: 2 }, 'D', 3)
    expect(r).toEqual({ stack: ['B', 'C', 'D'], idx: 2 })
  })
})

describe('jumpTo', () => {
  it('moves idx within range and clamps out-of-range to unchanged', () => {
    expect(jumpTo({ stack: ['A', 'B'], idx: 1 }, 0)).toEqual({ stack: ['A', 'B'], idx: 0 })
    expect(jumpTo({ stack: ['A', 'B'], idx: 1 }, 5)).toEqual({ stack: ['A', 'B'], idx: 1 })
  })
})

describe('serialize/deserialize', () => {
  it('round-trips', () => {
    expect(deserialize(serialize({ stack: ['A', 'B'], idx: 1 }))).toEqual({ stack: ['A', 'B'], idx: 1 })
  })

  it('returns null on invalid input', () => {
    expect(deserialize('not json')).toBe(null)
    expect(deserialize('{"idx":0}')).toBe(null)
  })

  it('repairs an out-of-range idx to the last entry', () => {
    expect(deserialize('{"stack":["A","B"],"idx":9}')).toEqual({ stack: ['A', 'B'], idx: 1 })
  })
})

describe('createHistory', () => {
  it('tracks state and fires onChange', () => {
    const seen = []
    const h = createHistory((s) => seen.push(s))
    expect(h.push('A')).toEqual({ list: ['A'], index: 0 })
    expect(h.jump(0)).toEqual({ name: 'A', list: ['A'], index: 0 })
    expect(seen.length).toBe(2)
  })

  it('load() hydrates state', () => {
    const h = createHistory()
    expect(h.load({ stack: ['A', 'B'], idx: 1 })).toEqual({ list: ['A', 'B'], index: 1 })
    expect(h.state()).toEqual({ list: ['A', 'B'], index: 1 })
  })
})
