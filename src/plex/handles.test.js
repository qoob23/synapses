import { describe, it, expect } from 'vitest'
import { classifyHandle, computeShownCount, nodeHandleStates } from './handles.js'

describe('classifyHandle', () => {
  it('maps (total,shown) to empty/shown/more', () => {
    expect(classifyHandle(0, 0)).toBe('empty')
    expect(classifyHandle(1, 1)).toBe('shown')
    expect(classifyHandle(3, 3)).toBe('shown')
    expect(classifyHandle(1, 0)).toBe('more')
    expect(classifyHandle(3, 2)).toBe('more')
    expect(classifyHandle(3, 0)).toBe('more')
  })
})

describe('computeShownCount', () => {
  it('counts neighbors present in the (lowercased) rendered set, case-insensitively', () => {
    expect(computeShownCount(['Aristotle', 'Plato'], new Set(['aristotle']))).toBe(1)
    expect(computeShownCount(['A', 'B'], new Set(['a', 'b']))).toBe(2)
    expect(computeShownCount([], new Set(['a']))).toBe(0)
  })
})

describe('nodeHandleStates', () => {
  it('returns all empty for an unknown node', () => {
    expect(nodeHandleStates(undefined, new Set())).toEqual({ parent: 'empty', child: 'empty', jump: 'empty' })
  })
  it('classifies each direction from its neighbor array vs the rendered set', () => {
    // child set includes the focus AND a sibling-zone node, both rendered -> shown
    const entry = { parents: ['Above'], children: ['Focus', 'Sib'], jumps: ['Far'] }
    const rendered = new Set(['focus', 'sib']) // Above and Far not rendered
    expect(nodeHandleStates(entry, rendered)).toEqual({ parent: 'more', child: 'shown', jump: 'more' })
  })
})
