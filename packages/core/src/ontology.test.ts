import { describe, it, expect } from 'vitest'
import { normalizeKey, roleForKey, buildOntology } from './ontology'

describe('normalizeKey', () => {
  it('lowercases, trims, and dashes internal whitespace', () => {
    expect(normalizeKey('Parent')).toBe('parent')
    expect(normalizeKey('  My Field  ')).toBe('my-field')
    expect(normalizeKey('a  b')).toBe('a-b')
  })

  it('handles null/undefined without throwing', () => {
    // @ts-expect-error exercising the runtime null/undefined guard
    expect(normalizeKey(null)).toBe('')
    // @ts-expect-error exercising the runtime null/undefined guard
    expect(normalizeKey(undefined)).toBe('')
  })
})

// buildOntology replaces the old settings-reading getOntology: instead of stubbing
// `logseq.settings`, callers pass the comma-separated config strings directly. The
// fallback-to-DEFAULTS behaviour is preserved.
describe('buildOntology', () => {
  it('returns DEFAULTS when no config is given', () => {
    const ont = buildOntology()
    expect(ont.parent).toContain('parent')
    expect(ont.child).toContain('children')
    expect(ont.jump).toContain('friends')
  })

  it('parses comma-separated config and drops blank entries', () => {
    expect(buildOntology({ parent: 'a, b, ,  c ' }).parent).toEqual(['a', 'b', 'c'])
  })

  it('falls back to DEFAULTS when a config value is blank', () => {
    expect(buildOntology({ parent: '   ' }).parent).toEqual(['parent', 'parents', 'up'])
  })
})

describe('roleForKey (against DEFAULTS)', () => {
  const ont = buildOntology()

  it('matches aliases case- and whitespace-insensitively', () => {
    expect(roleForKey('parents', ont)).toBe('parent')
    expect(roleForKey('UP', ont)).toBe('parent')
    expect(roleForKey('down', ont)).toBe('child')
    expect(roleForKey('friend', ont)).toBe('jump')
  })

  it('returns null for an unknown key', () => {
    expect(roleForKey('seealso', ont)).toBe(null)
  })
})
