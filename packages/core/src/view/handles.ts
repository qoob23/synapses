import { NODE } from './layout'

export type HandleState = 'empty' | 'shown' | 'more'

// total===0 -> 'empty'; every linked thought rendered (shown>=total) -> 'shown';
// otherwise (some/all hidden) -> 'more'. shown can never exceed total.
export function classifyHandle(total: number, shown: number): HandleState {
  if (total === 0) return 'empty'
  if (shown >= total) return 'shown'
  return 'more'
}

// Count of linked-thought names present in renderedSet (which holds LOWERCASED names).
export function computeShownCount(neighbors: string[] | null | undefined, renderedSet: Set<string>): number {
  let n = 0
  for (const name of neighbors || []) if (renderedSet.has(String(name).toLowerCase())) n++
  return n
}

const DIRS: Array<[string, string]> = [
  ['parent', 'parents'],
  ['child', 'children'],
  ['jump', 'jumps'],
]

// entry: { parents, children, jumps } display-cased name arrays, or undefined.
export function nodeHandleStates(entry: Record<string, string[]> | null | undefined, renderedSet: Set<string>): Record<string, HandleState> {
  const out: Record<string, HandleState> = {}
  for (const [dir, key] of DIRS) {
    const arr = (entry && entry[key]) || []
    out[dir] = classifyHandle(arr.length, computeShownCount(arr, renderedSet))
  }
  return out
}

// First node whose box (NODE.W x NODE.H centered at node.x,node.y) contains pt; else null.
export function hitTestNode(pt: { x: number; y: number }, nodes: Array<{ name: string; x: number; y: number }> | null | undefined): string | null {
  for (const n of nodes || []) {
    if (Math.abs(pt.x - n.x) <= NODE.W / 2 && Math.abs(pt.y - n.y) <= NODE.H / 2) return n.name
  }
  return null
}
