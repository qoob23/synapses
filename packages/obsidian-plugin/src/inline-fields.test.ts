import { describe, it, expect } from 'vitest'
import { upsertInlineField, removeInlineField } from './inline-fields'

describe('upsertInlineField', () => {
  it('writes into empty text', () => {
    expect(upsertInlineField('', 'child', ['A'])).toBe('child:: [[A]]\n')
  })
  it('prepends when no frontmatter', () => {
    expect(upsertInlineField('# Title\nbody', 'child', ['A'])).toBe('child:: [[A]]\n# Title\nbody')
  })
  it('joins multiple targets with comma', () => {
    expect(upsertInlineField('', 'parent', ['A', 'B'])).toBe('parent:: [[A]], [[B]]\n')
  })
  it('replaces an existing field line (case-insensitive key), keeping the rest', () => {
    const t = '# T\nParent:: [[Old]]\nmore'
    expect(upsertInlineField(t, 'parent', ['New'])).toBe('# T\nparent:: [[New]]\nmore')
  })
  it('inserts after the YAML frontmatter fence', () => {
    const t = '---\ntitle: X\n---\nbody'
    expect(upsertInlineField(t, 'child', ['A'])).toBe('---\ntitle: X\n---\nchild:: [[A]]\nbody')
  })
  it('inserts a separator when the frontmatter fence has no trailing newline', () => {
    expect(upsertInlineField('---\ntitle: X\n---', 'child', ['A'])).toBe('---\ntitle: X\n---\nchild:: [[A]]\n')
  })
})

describe('removeInlineField', () => {
  it('removes the matching line and its newline', () => {
    const t = '# T\nchild:: [[A]]\nbody'
    expect(removeInlineField(t, 'child')).toBe('# T\nbody')
  })
  it('is a no-op when the key is absent', () => {
    expect(removeInlineField('# T\nbody', 'child')).toBe('# T\nbody')
  })
  it('matches the key case-insensitively', () => {
    expect(removeInlineField('Child:: [[A]]\nx', 'child')).toBe('x')
  })
})
