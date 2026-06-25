/** @typedef {'empty'|'shown'|'more'} HandleState */

// total===0 -> 'empty'; every neighbor rendered (shown>=total) -> 'shown';
// otherwise (some/all hidden) -> 'more'. shown can never exceed total.
export function classifyHandle(total, shown) {
  if (total === 0) return 'empty'
  if (shown >= total) return 'shown'
  return 'more'
}

// Count of neighbor names present in renderedSet (which holds LOWERCASED names).
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
