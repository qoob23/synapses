import { describe, it, expect } from 'vitest'
import { pushEntry, jumpTo, serialize, deserialize, createHistory, removeEntry } from './history'

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

describe('removeEntry', () => {
  it('removes a non-current entry and keeps the current one pointed', () => {
    expect(removeEntry({ stack: ['A', 'B', 'C'], idx: 2 }, 'B')).toEqual({ stack: ['A', 'C'], idx: 1 })
  })
  it('removes the current entry and lands on the previous one', () => {
    expect(removeEntry({ stack: ['A', 'B', 'C', 'D'], idx: 2 }, 'C')).toEqual({ stack: ['A', 'B', 'D'], idx: 1 })
  })
  it('removes the current first entry and lands on the next survivor', () => {
    expect(removeEntry({ stack: ['A', 'B'], idx: 0 }, 'A')).toEqual({ stack: ['B'], idx: 0 })
  })
  it('removes the only entry yielding an empty stack at idx -1', () => {
    expect(removeEntry({ stack: ['A'], idx: 0 }, 'A')).toEqual({ stack: [], idx: -1 })
  })
  it('shifts idx left when an earlier entry is removed', () => {
    expect(removeEntry({ stack: ['A', 'B', 'C'], idx: 2 }, 'A')).toEqual({ stack: ['B', 'C'], idx: 1 })
  })
  it('is case-insensitive and removes all matches', () => {
    expect(removeEntry({ stack: ['Alpha', 'Beta', 'alpha'], idx: 1 }, 'ALPHA')).toEqual({ stack: ['Beta'], idx: 0 })
  })
  it('is a no-op for a name not present', () => {
    expect(removeEntry({ stack: ['A', 'B'], idx: 1 }, 'Z')).toEqual({ stack: ['A', 'B'], idx: 1 })
  })
  it('does not mutate the input', () => {
    const input = { stack: ['A', 'B'], idx: 1 }
    removeEntry(input, 'A')
    expect(input).toEqual({ stack: ['A', 'B'], idx: 1 })
  })
})

describe('createHistory.remove', () => {
  it('removes via the factory and fires onChange', () => {
    const seen: any[] = []
    const h = createHistory((s) => seen.push(s))
    h.push('A'); h.push('B')
    expect(h.remove('A')).toEqual({ list: ['B'], index: 0 })
    expect(seen.length).toBe(3)
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
