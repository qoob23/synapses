import { NODE } from './layout.js'

/** @typedef {'empty'|'shown'|'more'} HandleState */

// total===0 -> 'empty'; every linked thought rendered (shown>=total) -> 'shown';
// otherwise (some/all hidden) -> 'more'. shown can never exceed total.
export function classifyHandle(total, shown) {
  if (total === 0) return 'empty'
  if (shown >= total) return 'shown'
  return 'more'
}

// Count of linked-thought names present in renderedSet (which holds LOWERCASED names).
export function computeShownCount(neighbors, renderedSet) {
  let n = 0
  for (const name of neighbors || []) if (renderedSet.has(String(name).toLowerCase())) n++
  return n
}

const DIRS = [
  ['parent', 'parents'],
  ['child', 'children'],
  ['jump', 'jumps'],
]

// entry: { parents, children, jumps } display-cased name arrays, or undefined.
export function nodeHandleStates(entry, renderedSet) {
  const out = {}
  for (const [dir, key] of DIRS) {
    const arr = (entry && entry[key]) || []
    out[dir] = classifyHandle(arr.length, computeShownCount(arr, renderedSet))
  }
  return out
}

// First node whose box (NODE.W x NODE.H centered at node.x,node.y) contains pt; else null.
export function hitTestNode(pt, nodes) {
  for (const n of nodes || []) {
    if (Math.abs(pt.x - n.x) <= NODE.W / 2 && Math.abs(pt.y - n.y) <= NODE.H / 2) return n.name
  }
  return null
}
