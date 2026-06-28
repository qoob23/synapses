import { describe, it, expect } from 'vitest'
import { isInLogseqFolder, matchesIgnoreFilters } from './ignore'

describe('isInLogseqFolder', () => {
  it('matches files anywhere inside a logseq/ folder', () => {
    expect(isInLogseqFolder('logseq/bak/pages/Philosophy/2026.md')).toBe(true)
    expect(isInLogseqFolder('logseq/.recycle/pages_Metaphysics.md')).toBe(true)
    expect(isInLogseqFolder('graph/logseq/config.edn')).toBe(true) // nested under another folder
  })
  it('is case-insensitive on the folder name', () => {
    expect(isInLogseqFolder('Logseq/bak/x.md')).toBe(true)
  })
  it('does NOT match a file merely named logseq, or a real page', () => {
    expect(isInLogseqFolder('pages/logseq.md')).toBe(false) // file called logseq, not the folder
    expect(isInLogseqFolder('logseq.md')).toBe(false)
    expect(isInLogseqFolder('pages/Philosophy.md')).toBe(false)
    expect(isInLogseqFolder('')).toBe(false)
  })
})

describe('matchesIgnoreFilters', () => {
  const FILTERS = ['logseq/', 'meta/']

  it('matches a trailing-slash folder filter and its contents', () => {
    expect(matchesIgnoreFilters('logseq/bak/x.md', FILTERS)).toBe(true)
    expect(matchesIgnoreFilters('meta/assets/a.png', FILTERS)).toBe(true)
  })
  it('does not match a sibling whose name merely shares the prefix', () => {
    expect(matchesIgnoreFilters('metaphysics/x.md', FILTERS)).toBe(false)
    expect(matchesIgnoreFilters('pages/Philosophy.md', FILTERS)).toBe(false)
  })
  it('matches a folder filter exactly (no trailing slash needed)', () => {
    expect(matchesIgnoreFilters('templates', ['templates'])).toBe(true)
    expect(matchesIgnoreFilters('templates/daily.md', ['templates'])).toBe(true)
  })
  it('matches a specific file filter', () => {
    expect(matchesIgnoreFilters('inbox.md', ['inbox.md'])).toBe(true)
  })
  it('supports /regex/ filters', () => {
    expect(matchesIgnoreFilters('pages/draft-foo.md', ['/draft-/'])).toBe(true)
    expect(matchesIgnoreFilters('pages/final.md', ['/draft-/'])).toBe(false)
  })
  it('ignores blank entries and a missing/empty filter list', () => {
    expect(matchesIgnoreFilters('logseq/x.md', ['', '   '])).toBe(false)
    expect(matchesIgnoreFilters('logseq/x.md', [])).toBe(false)
    expect(matchesIgnoreFilters('logseq/x.md', undefined as unknown as string[])).toBe(false)
  })
  it('does not throw on an invalid regex filter', () => {
    expect(matchesIgnoreFilters('x.md', ['/(/'])).toBe(false)
  })
})
