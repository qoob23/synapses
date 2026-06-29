import { describe, it, expect } from 'vitest'
import { sameName, graphKey } from './app-logic'
import type { Graph } from './types'

const g = (over: Partial<Graph>): Graph => ({
  focus: 'A',
  parents: [],
  children: [],
  jumps: [],
  siblings: [],
  siblingsTruncated: false,
  siblingParent: {},
  ...over,
})

describe('sameName', () => {
  it('is case-insensitive', () => {
    expect(sameName('Foo', 'foo')).toBe(true)
    expect(sameName('Foo Bar', 'FOO BAR')).toBe(true)
  })
  it('is false for distinct names', () => {
    expect(sameName('foo', 'bar')).toBe(false)
  })
  it('is false when either side is empty/null', () => {
    expect(sameName('', 'a')).toBe(false)
    expect(sameName('a', null)).toBe(false)
    expect(sameName(null, undefined)).toBe(false)
  })
})

describe('graphKey', () => {
  it('is case-insensitive on the focus and the link lists', () => {
    expect(graphKey(g({ focus: 'Note', parents: ['P'] }))).toBe(graphKey(g({ focus: 'note', parents: ['p'] })))
  })
  it('is order-independent within a link list', () => {
    expect(graphKey(g({ children: ['a', 'b', 'c'] }))).toBe(graphKey(g({ children: ['c', 'a', 'b'] })))
  })
  it('distinguishes different link sets', () => {
    expect(graphKey(g({ parents: ['p'] }))).not.toBe(graphKey(g({ children: ['p'] })))
    expect(graphKey(g({ focus: 'A' }))).not.toBe(graphKey(g({ focus: 'B' })))
  })
  it('keeps link kinds separate (same name as a parent vs a child differs)', () => {
    expect(graphKey(g({ parents: ['X'] }))).not.toBe(graphKey(g({ children: ['X'] })))
  })
})

