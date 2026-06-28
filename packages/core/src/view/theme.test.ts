import { describe, it, expect } from 'vitest'
import { connectorColors } from './theme'

describe('connectorColors', () => {
  it('connections are gray from bg->text (75% / 37.5%); hover = theme accent when no pick', () => {
    const { edge, jumpEdge, highlight } = connectorColors({ mode: 'dark', bg: '#000000', text: '#ffffff', accent: '#4a90d9' })
    expect(edge).toBe('rgba(140, 140, 140, 0.75)') // 0.55 toward text, softened
    expect(jumpEdge).toBe('rgba(140, 140, 140, 0.375)') // same gray, half opacity
    expect(highlight).toBe('rgba(74, 144, 217, 1)') // theme accent, opaque
  })

  it('a picked color drives only the hover highlight; connections stay gray', () => {
    const { edge, jumpEdge, highlight } = connectorColors({
      mode: 'dark', bg: '#000000', text: '#ffffff', accent: '#4a90d9', primaryEdge: '#ff0000',
    })
    expect(edge).toBe('rgba(140, 140, 140, 0.75)') // unchanged by the pick
    expect(jumpEdge).toBe('rgba(140, 140, 140, 0.375)')
    expect(highlight).toBe('rgba(255, 0, 0, 1)') // the picked color, opaque
  })

  it('falls back to the border var for the gray when bg/text are absent', () => {
    const { edge, jumpEdge } = connectorColors({ mode: 'light', border: '#cccccc' })
    expect(edge).toBe('rgba(204, 204, 204, 0.75)')
    expect(jumpEdge).toBe('rgba(204, 204, 204, 0.375)')
  })

  it('falls back to a static gray (and gray highlight) when nothing is available', () => {
    const { edge, jumpEdge, highlight } = connectorColors({ mode: 'light' })
    expect(edge).toBe('rgba(127, 127, 127, 0.75)')
    expect(jumpEdge).toBe('rgba(127, 127, 127, 0.375)')
    expect(highlight).toBe('rgba(127, 127, 127, 1)')
  })
})
