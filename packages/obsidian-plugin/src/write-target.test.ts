import { describe, it, expect } from 'vitest'
import { chooseWriteTarget } from './write-target'

describe('chooseWriteTarget', () => {
  it('prefers frontmatter when the key lives there', () => {
    expect(chooseWriteTarget({ hasFrontmatterKey: true, hasInlineKey: false })).toBe('frontmatter')
  })
  it('prefers frontmatter even when an inline line also exists', () => {
    expect(chooseWriteTarget({ hasFrontmatterKey: true, hasInlineKey: true })).toBe('frontmatter')
  })
  it('edits an existing inline line in place when no frontmatter key', () => {
    expect(chooseWriteTarget({ hasFrontmatterKey: false, hasInlineKey: true })).toBe('inline')
  })
  it('falls back to a new inline field when the key is absent everywhere', () => {
    expect(chooseWriteTarget({ hasFrontmatterKey: false, hasInlineKey: false })).toBe('default')
  })
})
