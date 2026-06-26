import { describe, it, expect } from 'vitest'
import { plexFrameStyle } from './sidebar.js'

describe('plexFrameStyle', () => {
  it('widens the plex frame ~40px past the sidebar block and zeroes its right padding', () => {
    const css = plexFrameStyle()
    expect(css).toContain('width:calc(100% + 40px)')
    expect(css).toContain('padding-right:0')
  })
})
