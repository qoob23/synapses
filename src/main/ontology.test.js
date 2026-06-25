import { describe, it, expect, afterEach } from 'vitest'
import { normalizeKey, roleForKey, getOntology } from './ontology.js'

// getOntology reads the live `logseq.settings`; with no global it returns the
// built-in DEFAULTS. The settings-driven tests stub a global and clean it up.
afterEach(() => {
  delete globalThis.logseq
})

describe('normalizeKey', () => {
  it('lowercases, trims, and dashes internal whitespace', () => {
    expect(normalizeKey('Parent')).toBe('parent')
    expect(normalizeKey('  My Field  ')).toBe('my-field')
    expect(normalizeKey('a  b')).toBe('a-b')
  })

  it('handles null/undefined without throwing', () => {
    expect(normalizeKey(null)).toBe('')
    expect(normalizeKey(undefined)).toBe('')
  })
})

describe('getOntology', () => {
  it('returns DEFAULTS when no settings are present', () => {
    const ont = getOntology()
    expect(ont.parent).toContain('parent')
    expect(ont.child).toContain('children')
    expect(ont.jump).toContain('friends')
  })

  it('parses comma-separated settings and drops blank entries', () => {
    globalThis.logseq = { settings: { parentFields: 'a, b, ,  c ' } }
    expect(getOntology().parent).toEqual(['a', 'b', 'c'])
  })

  it('falls back to DEFAULTS when a setting is blank', () => {
    globalThis.logseq = { settings: { parentFields: '   ' } }
    expect(getOntology().parent).toEqual(['parent', 'parents', 'up'])
  })
})

describe('roleForKey (against DEFAULTS)', () => {
  const ont = getOntology()

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
