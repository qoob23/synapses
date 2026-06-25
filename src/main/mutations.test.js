import { describe, it, expect } from 'vitest'
import { removeFromLinkList } from './mutations.js'

describe('removeFromLinkList', () => {
  it('removes the target case-insensitively, preserving the rest and order', () => {
    expect(removeFromLinkList(['Ethics', 'Logic', 'Aristotle'], 'logic')).toEqual(['Ethics', 'Aristotle'])
  })
  it('is a no-op when the target is absent', () => {
    expect(removeFromLinkList(['Ethics'], 'Logic')).toEqual(['Ethics'])
  })
  it('returns [] when removing the only entry', () => {
    expect(removeFromLinkList(['Logic'], 'logic')).toEqual([])
  })
})
