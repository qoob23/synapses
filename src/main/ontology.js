// Maps Logseq property names to relationship roles (ExcaliBrain-style).
// Defaults are user-overridable via plugin settings.

const DEFAULTS = {
  parent: ['parent', 'parents', 'up'],
  child: ['child', 'children', 'down'],
  jump: ['jump', 'jumps', 'friend', 'friends'],
}

export function normalizeKey(k) {
  return String(k || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
}

function parseList(v) {
  if (!v) return null
  const arr = String(v)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  return arr.length ? arr : null
}

export function getOntology() {
  const s = (typeof logseq !== 'undefined' && logseq.settings) || {}
  return {
    parent: parseList(s.parentFields) || DEFAULTS.parent,
    child: parseList(s.childFields) || DEFAULTS.child,
    jump: parseList(s.jumpFields) || DEFAULTS.jump,
  }
}

export function roleForKey(key, ont) {
  const k = normalizeKey(key)
  for (const role of Object.keys(ont)) {
    if (ont[role].map(normalizeKey).includes(k)) return role
  }
  return null
}
