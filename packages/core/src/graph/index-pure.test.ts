import { describe, it, expect } from 'vitest'
import { buildOntology } from '../ontology'
import { assembleGraph, queryGraphFromProps, adjacencyFromProps, reconcileNoteAdjacency, uniqNames, collect, SIBLING_CAP, toNames } from './index-pure'
import type { OntologyConfig, PropMap } from '../types'

const ONT: OntologyConfig = { parent: ['parent', 'up'], child: ['child'], jump: ['jump'] }

describe('toNames', () => {
  it('splits a raw comma-joined wiki-link string (a block .properties value)', () => {
    expect(toNames('[[Костя Довнар]], [[Dio FusedTransformer]], [[Ежедневные статусы]]'))
      .toEqual(['Костя Довнар', 'Dio FusedTransformer', 'Ежедневные статусы'])
  })
  it('handles a single wiki-link', () => {
    expect(toNames('[[Ethics]]')).toEqual(['Ethics'])
  })
  it('preserves a comma inside a page name (non-greedy match)', () => {
    expect(toNames('[[Foo, Bar]], [[Baz]]')).toEqual(['Foo, Bar', 'Baz'])
  })
  it('strips brackets from pre-split array values without re-splitting', () => {
    expect(toNames(['[[A]]', 'B'])).toEqual(['A', 'B'])
    expect(toNames(['Foo, Bar'])).toEqual(['Foo, Bar'])
  })
  it('falls back to a comma split for plain (non-wiki) strings', () => {
    expect(toNames('A, B')).toEqual(['A', 'B'])
  })
  it('returns [] for empty / nullish', () => {
    expect(toNames(null)).toEqual([])
    expect(toNames(undefined)).toEqual([])
    expect(toNames('')).toEqual([])
  })
})

describe('collect', () => {
  it('gathers values across every key mapping to the role (alias-aware)', () => {
    const props: PropMap = { parent: ['A'], up: ['B'], child: ['C'] }
    expect(collect(props, 'parent', ONT).sort()).toEqual(['A', 'B'])
    expect(collect(props, 'child', ONT)).toEqual(['C'])
    expect(collect(props, 'jump', ONT)).toEqual([])
  })
})

describe('uniqNames', () => {
  it('dedupes case-insensitively, drops self, preserves first-seen casing + order', () => {
    expect(uniqNames(['Ethics', 'ethics', 'Logic'], 'logic')).toEqual(['Ethics'])
  })
  it('honors the exclude predicate', () => {
    expect(uniqNames(['A', 'B', 'C'], 'x', (l) => l === 'b')).toEqual(['A', 'C'])
  })
})

describe('adjacencyFromProps', () => {
  it('reads a note\'s own parents/children/jumps (symmetric → complete), excluding self', () => {
    const props: PropMap = { parent: ['Philosophy'], child: ['Ethics', 'ethics'], jump: ['Self'] }
    expect(adjacencyFromProps('Self', props, ONT)).toEqual({
      parents: ['Philosophy'],
      children: ['Ethics'], // duped child collapsed
      jumps: [], // 'Self' is the focus → excluded
    })
  })
})

describe('queryGraphFromProps', () => {
  // Symmetric fixture: every link lives on both pages.
  const PAGES: Record<string, PropMap> = {
    Philosophy: { child: ['Ethics', 'Logic', 'Metaphysics'] },
    Ethics: { parent: ['Philosophy'], child: ['Virtue Ethics'], jump: ['Aristotle'] },
    Logic: { parent: ['Philosophy'] },
    Metaphysics: { parent: ['Philosophy'] },
    'Virtue Ethics': { parent: ['Ethics'] },
    Aristotle: { jump: ['Ethics'] },
  }
  const build = (focus: string) =>
    queryGraphFromProps(
      focus,
      PAGES[focus] ?? {},
      Object.fromEntries(Object.entries(PAGES).map(([n, p]) => [n.toLowerCase(), p])),
      ONT,
    )

  it('resolves all four zones from own + parents\' props', () => {
    const g = build('Ethics')
    expect(g.focus).toBe('Ethics')
    expect(g.parents).toEqual(['Philosophy'])
    expect(g.children).toEqual(['Virtue Ethics'])
    expect(g.jumps).toEqual(['Aristotle'])
    expect(g.siblings.sort()).toEqual(['Logic', 'Metaphysics']) // Philosophy's other children
  })

  it('records which parent each sibling came from', () => {
    const g = build('Ethics')
    expect(g.siblingParent['Logic']).toBe('Philosophy')
    expect(g.siblingParent['Metaphysics']).toBe('Philosophy')
  })

  it('never lists the focus as its own neighbor or sibling', () => {
    const g = build('Ethics')
    const all = [...g.parents, ...g.children, ...g.jumps, ...g.siblings]
    expect(all.some((n) => n.toLowerCase() === 'ethics')).toBe(false)
  })

  it('excludes own parents/children from the sibling set', () => {
    // Build a focus whose parent also declares the focus's own child as a child.
    const g = queryGraphFromProps(
      'A',
      { parent: ['P'], child: ['Shared'] },
      { p: { child: ['A', 'Shared', 'Sib'] } },
      ONT,
    )
    expect(g.children).toEqual(['Shared'])
    expect(g.siblings).toEqual(['Sib']) // 'A' (self) and 'Shared' (own child) excluded
  })

  it('handles multiple parents, attributing each sibling to its parent', () => {
    const g = queryGraphFromProps(
      'N',
      { parent: ['Aristotle', 'Ethics'] },
      { aristotle: { child: ['N', 'Poetics'] }, ethics: { child: ['N', 'Virtue Ethics'] } },
      ONT,
    )
    expect(g.parents.sort()).toEqual(['Aristotle', 'Ethics'])
    expect(g.siblings.sort()).toEqual(['Poetics', 'Virtue Ethics'])
    expect(g.siblingParent['Poetics']).toBe('Aristotle')
    expect(g.siblingParent['Virtue Ethics']).toBe('Ethics')
  })

  it('caps siblings at SIBLING_CAP and flags truncation', () => {
    const many = Array.from({ length: SIBLING_CAP + 5 }, (_, i) => `S${i}`)
    const g = queryGraphFromProps('A', { parent: ['P'] }, { p: { child: ['A', ...many] } }, ONT)
    expect(g.siblings).toHaveLength(SIBLING_CAP)
    expect(g.siblingsTruncated).toBe(true)
  })

  it('returns empty zones for an unlinked / unknown focus', () => {
    const g = queryGraphFromProps('Lonely', {}, {}, ONT)
    expect(g).toMatchObject({ parents: [], children: [], jumps: [], siblings: [], siblingsTruncated: false })
  })
})

it('assembleGraph computes siblings from reconciled parent adjacencies', () => {
  const g = assembleGraph(
    'A',
    { parents: ['P'], children: [], jumps: [] },
    { p: { parents: [], children: ['A', 'B'], jumps: [] } },
  )
  expect(g.parents).toEqual(['P'])
  expect(g.siblings).toEqual(['B'])
  expect(g.siblingParent).toEqual({ B: 'P' })
})

const ONT_SIMPLE = { parent: ['parent'], child: ['child'], jump: ['jump'] }

describe('reconcileNoteAdjacency', () => {
  it('surfaces an incoming-only parent', () => {
    // B declares A as its child; A declares nothing. A should see B as parent.
    const adj = reconcileNoteAdjacency('A', {}, [{ name: 'B', props: { child: ['A'] } }], ONT_SIMPLE)
    expect(adj.parents).toEqual(['B'])
    expect(adj.children).toEqual([])
  })

  it('structural beats opposing jump (migration precedence)', () => {
    // A says jump:: B; B says child:: A (=> A is B's child => A sees B as parent). Structural wins.
    const adj = reconcileNoteAdjacency('A', { jump: ['B'] }, [{ name: 'B', props: { child: ['A'] } }], ONT_SIMPLE)
    expect(adj.parents).toEqual(['B'])
    expect(adj.jumps).toEqual([])
  })

  it('surfaces an incoming-only jump', () => {
    const adj = reconcileNoteAdjacency('A', {}, [{ name: 'B', props: { jump: ['A'] } }], ONT_SIMPLE)
    expect(adj.jumps).toEqual(['B'])
  })

  it('no pairs => empty adjacency', () => {
    expect(reconcileNoteAdjacency('A', {}, [], ONT_SIMPLE)).toEqual({ parents: [], children: [], jumps: [] })
  })

  it('opposing structural claims resolve via the alphabetically-first page', () => {
    // A says parent:: B, B says parent:: A. A is alphabetically first, so its claim (B is A's parent) wins.
    const adj = reconcileNoteAdjacency('A', { parent: ['B'] }, [{ name: 'B', props: { parent: ['A'] } }], ONT_SIMPLE)
    expect(adj.parents).toEqual(['B'])
    expect(adj.children).toEqual([])
  })

  it('reads alias keys (children → child)', () => {
    // B declares A under the `children` alias (A is B's child) => A should see B as a parent.
    const adj = reconcileNoteAdjacency('A', {}, [{ name: 'B', props: { children: ['A'] } }], buildOntology())
    expect(adj.parents).toEqual(['B'])
  })

  it('treats names case-insensitively', () => {
    const adj = reconcileNoteAdjacency('A', { parent: ['b'] }, [{ name: 'B', props: { child: ['a'] } }], ONT_SIMPLE)
    expect(adj.parents).toEqual(['B'])
  })

  it('ignores self-links', () => {
    expect(reconcileNoteAdjacency('A', { parent: ['A'] }, [], ONT_SIMPLE)).toEqual({ parents: [], children: [], jumps: [] })
  })
})
