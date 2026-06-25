import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { NODE, computeLayout } from './layout.js'

const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8')

describe('node geometry single source of truth', () => {
  // view.js sets --plex-node-w/h from NODE at runtime; styles.css carries
  // matching fallback literals. This guards them from silently diverging.
  it('styles.css fallback literals match NODE', () => {
    expect(css).toContain(`var(--plex-node-w, ${NODE.W}px)`)
    expect(css).toContain(`var(--plex-node-h, ${NODE.H}px)`)
  })

  it('styles.css drives node label size from --plex-node-font', () => {
    expect(css).toContain('font-size: var(--plex-node-font, 22px)')
  })
})

describe('computeLayout', () => {
  it('places the focus at the origin and keeps one node per name', () => {
    const g = {
      focus: 'F',
      parents: ['P'],
      children: ['C'],
      jumps: ['J'],
      siblings: ['C'], // also a child — must dedupe, keeping the higher-priority zone
      siblingParent: {},
    }
    const layout = computeLayout(g)

    expect(layout.nodes.find((n) => n.zone === 'focus')).toMatchObject({ name: 'F', x: 0, y: 0 })

    const names = layout.nodes.map((n) => n.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length) // no duplicate names

    expect(layout.nodes.find((n) => n.name === 'C').zone).toBe('child') // child beats sibling
  })
})
