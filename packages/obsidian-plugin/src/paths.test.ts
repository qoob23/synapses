import { describe, it, expect } from 'vitest'
import { newNotePath } from './paths'

describe('newNotePath', () => {
  it('returns a bare filename at the vault root (empty parent)', () => {
    expect(newNotePath('', 'A')).toBe('A.md')
  })
  it('treats "/" as the vault root', () => {
    expect(newNotePath('/', 'A')).toBe('A.md')
  })
  it('joins a configured folder with the name', () => {
    expect(newNotePath('Folder', 'A')).toBe('Folder/A.md')
  })
  it('joins a nested folder path', () => {
    expect(newNotePath('a/b', 'Note')).toBe('a/b/Note.md')
  })
})
