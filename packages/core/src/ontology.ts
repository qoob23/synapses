import type { OntologyConfig, Role } from './types'

export const DEFAULT_ONTOLOGY: OntologyConfig = {
  parent: ['parent', 'parents', 'up'],
  child: ['child', 'children', 'down'],
  jump: ['jump', 'jumps', 'friend', 'friends'],
}

export function normalizeKey(k: string): string {
  return String(k || '').toLowerCase().trim().replace(/\s+/g, '-')
}

function parseList(v: unknown): string[] | null {
  if (typeof v !== 'string') return null
  const arr = v.split(',').map((x) => x.trim()).filter(Boolean)
  return arr.length ? arr : null
}

// Build an ontology from user-supplied comma-separated strings, falling back to defaults.
export function buildOntology(config: Partial<Record<Role, string>> = {}): OntologyConfig {
  return {
    parent: parseList(config.parent) || DEFAULT_ONTOLOGY.parent,
    child: parseList(config.child) || DEFAULT_ONTOLOGY.child,
    jump: parseList(config.jump) || DEFAULT_ONTOLOGY.jump,
  }
}

export function roleForKey(key: string, ont: OntologyConfig): Role | null {
  const k = normalizeKey(key)
  for (const role of Object.keys(ont) as Role[]) {
    if (ont[role].map(normalizeKey).includes(k)) return role
  }
  return null
}
