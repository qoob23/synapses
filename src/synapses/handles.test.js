import { describe, it, expect } from 'vitest'
import { classifyHandle, computeShownCount, nodeHandleStates, hitTestNode } from './handles.js'
import { NODE } from './layout.js'

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
    // child set includes `Focus` AND a sibling-zone thought, both rendered -> shown
    const entry = { parents: ['Above'], children: ['Focus', 'Sib'], jumps: ['Far'] }
    const rendered = new Set(['focus', 'sib']) // Above and Far not rendered
    expect(nodeHandleStates(entry, rendered)).toEqual({ parent: 'more', child: 'shown', jump: 'more' })
  })
})

describe('hitTestNode', () => {
  const nodes = [{ name: 'A', x: 0, y: 0 }, { name: 'B', x: 400, y: 0 }]
  it('returns the node whose box contains the point', () => {
    expect(hitTestNode({ x: 0, y: 0 }, nodes)).toBe('A')
    expect(hitTestNode({ x: NODE.W / 2, y: 0 }, nodes)).toBe('A') // on edge = inside
    expect(hitTestNode({ x: 400, y: 0 }, nodes)).toBe('B')
  })
  it('returns null in empty space', () => {
    expect(hitTestNode({ x: 200, y: 300 }, nodes)).toBe(null)
  })
})
