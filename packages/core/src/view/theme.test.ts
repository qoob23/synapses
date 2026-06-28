import { describe, it, expect } from 'vitest'
import { connectorColors } from './theme'

describe('connectorColors', () => {
  it('derives from bg->text when no override (direct stronger than jump)', () => {
    const { edge, jumpEdge } = connectorColors({ mode: 'dark', bg: '#000000', text: '#ffffff' })
    expect(edge).toBe('rgb(140, 140, 140)') // 0.55 toward text
    expect(jumpEdge).toBe('rgb(84, 84, 84)') // 0.33 toward text (dimmer)
  })

  it('uses the user overrides when set', () => {
    const { edge, jumpEdge } = connectorColors({
      mode: 'dark', bg: '#000000', text: '#ffffff',
      primaryEdge: '#ff0000', secondaryEdge: '#00ff00',
    })
    expect(edge).toBe('#ff0000')
    expect(jumpEdge).toBe('#00ff00')
  })

  it('raises a too-transparent override to the opacity floor (cannot vanish)', () => {
    const { edge } = connectorColors({ mode: 'dark', bg: '#000', text: '#fff', primaryEdge: 'rgba(255,0,0,0.1)' })
    expect(edge).toBe('rgba(255, 0, 0, 0.5)')
  })

  it('falls back to border/text2 vars when bg/text are absent', () => {
    const { edge, jumpEdge } = connectorColors({ mode: 'light', border: '#cccccc', text2: '#999999' })
    expect(edge).toBe('#cccccc')
    expect(jumpEdge).toBe('#999999')
  })

  it('falls back to static grays when nothing is available', () => {
    const { edge, jumpEdge } = connectorColors({ mode: 'light' })
    expect(edge).toBe('rgba(127,127,127,0.55)')
    expect(jumpEdge).toBe('rgba(127,127,127,0.32)')
  })
})
