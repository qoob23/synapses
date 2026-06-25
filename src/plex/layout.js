// Fixed banded layout around a focus node, no physics:
//   parents row above, children row below, jumps column left, siblings column right.
// All coordinates are "world" units with the focus at (0, 0).

export const NODE = { W: 208, H: 52 }

const BAND_Y = 150 // vertical distance to the parent/child rows
const BAND_X = 250 // horizontal distance to the jump/sibling columns
const GAP_X = 174 // horizontal gap between nodes in a row
const GAP_Y = 50 // vertical gap between nodes in a column

function rowPositions(names, y) {
  const n = names.length
  return names.map((name, i) => ({ name, x: (i - (n - 1) / 2) * GAP_X, y }))
}

function colPositions(names, x) {
  const n = names.length
  return names.map((name, i) => ({ name, x, y: (i - (n - 1) / 2) * GAP_Y }))
}

export function computeLayout(graph) {
  const raw = [{ name: graph.focus, x: 0, y: 0, zone: 'focus' }]
  for (const p of rowPositions(graph.parents || [], -BAND_Y)) raw.push({ ...p, zone: 'parent' })
  for (const c of rowPositions(graph.children || [], BAND_Y)) raw.push({ ...c, zone: 'child' })
  for (const j of colPositions(graph.jumps || [], -BAND_X)) raw.push({ ...j, zone: 'jump' })
  const siblingParent = graph.siblingParent || {}
  for (const s of colPositions(graph.siblings || [], BAND_X)) {
    raw.push({ ...s, zone: 'sibling', via: siblingParent[s.name] })
  }

  // A name should appear once; keep the highest-priority zone (order above).
  const seen = new Set()
  const nodes = []
  for (const nd of raw) {
    const k = nd.name.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    nodes.push(nd)
  }

  return { focus: graph.focus, nodes, bbox: computeBBox(nodes) }
}

function computeBBox(nodes) {
  let minX = -NODE.W / 2
  let minY = -NODE.H / 2
  let maxX = NODE.W / 2
  let maxY = NODE.H / 2
  for (const n of nodes) {
    minX = Math.min(minX, n.x - NODE.W / 2)
    maxX = Math.max(maxX, n.x + NODE.W / 2)
    minY = Math.min(minY, n.y - NODE.H / 2)
    maxY = Math.max(maxY, n.y + NODE.H / 2)
  }
  return { minX, minY, maxX, maxY }
}
