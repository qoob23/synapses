import { describe, it, expect } from 'vitest'
import { synapsesFrameStyle } from './sidebar.js'

describe('synapsesFrameStyle', () => {
  it('widens the synapses frame ~40px past the sidebar block and zeroes its right padding', () => {
    const css = synapsesFrameStyle()
    expect(css).toContain('width:calc(100% + 40px)')
    expect(css).toContain('padding-right:0')
  })
})
