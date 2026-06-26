import { describe, it, expect } from 'vitest'
import { linkPathToBasename, valueToNames, pageToPropMap } from './dataview-map'

const link = (path: string) => ({ path }) // structural Dataview Link

describe('linkPathToBasename', () => {
  it('strips folders and .md', () => {
    expect(linkPathToBasename('a/b/Note.md')).toBe('Note')
    expect(linkPathToBasename('Note')).toBe('Note')
  })
})

describe('valueToNames', () => {
  it('maps a single Link', () => { expect(valueToNames(link('f/A.md'))).toEqual(['A']) })
  it('maps an array of Links', () => { expect(valueToNames([link('A.md'), link('B.md')])).toEqual(['A', 'B']) })
  it('maps a bracketed string', () => { expect(valueToNames('[[A]]')).toEqual(['A']) })
  it('ignores a plain (non-link) string', () => { expect(valueToNames('Foo')).toEqual([]) })
  it('ignores numbers/objects', () => { expect(valueToNames(3)).toEqual([]); expect(valueToNames({ x: 1 })).toEqual([]) })
  it('reduces a bracketed path string to its basename', () => { expect(valueToNames('[[folder/Note.md]]')).toEqual(['Note']) })
})

describe('pageToPropMap', () => {
  it('keeps link-valued fields as basenames, skips file + non-link fields', () => {
    const page = { file: { name: 'Self' }, parent: link('p/P.md'), child: [link('C1.md'), link('C2.md')], title: 'Foo', count: 3 }
    expect(pageToPropMap(page)).toEqual({ parent: ['P'], child: ['C1', 'C2'] })
  })
})
