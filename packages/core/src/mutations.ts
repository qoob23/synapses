import { roleForKey } from './ontology'
import type { DataSource, OntologyConfig, Role } from './types'

// Pure: drop `target` (case-insensitive) from a list of link names.
export function removeFromLinkList(names: string[], target: string): string[] {
  const t = String(target).toLowerCase()
  return names.filter((n) => n.toLowerCase() !== t)
}

// Property-function (not method) signatures on purpose: the backend holds these as
// values (e.g. `removeLink: mut.removeLink`), and none use `this` — the method form
// would trip @typescript-eslint/unbound-method at every such reference.
export interface Mutations {
  createChild: (focus: string, name: string) => Promise<boolean>
  createParent: (focus: string, name: string) => Promise<boolean>
  createJump: (focus: string, name: string) => Promise<boolean>
  linkExisting: (focus: string, name: string, role: Role) => Promise<boolean>
  removeLink: (focus: string, name: string, role: Role) => Promise<boolean>
}

const reciprocal = (role: Role): Role => (role === 'parent' ? 'child' : role === 'child' ? 'parent' : 'jump')

export function createMutations(
  dataSource: DataSource,
  getOntology: () => OntologyConfig,
): Mutations {
  // Append `target` to `pageName`'s `key` property (dedupe, case-insensitive).
  async function addPropLink(pageName: string, key: Role, target: string): Promise<void> {
    await dataSource.ensurePage(pageName)
    const props = await dataSource.getPageProps(pageName)
    const current = props[key] || []
    const exists = current.some((n) => n.toLowerCase() === target.toLowerCase())
    const next = exists ? current : [...current, target]
    await dataSource.setPropertyLinks(pageName, key, next)
  }

  // Remove `target` from every key on `pageName` mapping to `role` (alias-aware).
  async function removeRoleLinks(pageName: string, role: Role, target: string): Promise<void> {
    const props = await dataSource.getPageProps(pageName)
    const ont = getOntology()
    for (const key of Object.keys(props)) {
      if (roleForKey(key, ont) !== role) continue
      const current = props[key]
      const remaining = removeFromLinkList(current, target)
      if (remaining.length === current.length) continue
      if (remaining.length) await dataSource.setPropertyLinks(pageName, key, remaining)
      else await dataSource.removePropertyKey(pageName, key)
    }
  }

  // Which roles currently connect `focus` to `target`, read from `focus`'s OWN props.
  // Under symmetric writes a note's props are authoritative for its side of every pair.
  // Normally one role; a legacy multi-role pair returns several (the caller collapses them).
  async function rolesBetween(focus: string, target: string): Promise<Role[]> {
    const props = await dataSource.getPageProps(focus)
    const ont = getOntology()
    const t = target.toLowerCase()
    const out = new Set<Role>()
    for (const key of Object.keys(props)) {
      const role = roleForKey(key, ont)
      if (role && props[key].some((n) => n.toLowerCase() === t)) out.add(role)
    }
    return [...out]
  }

  // Clear the `role` connection between `focus` and `target` on BOTH pages: `role`'s key
  // on `focus` and its reciprocal key on `target` (e.g. child→parent). Symmetric by design.
  async function unlink(focus: string, target: string, role: Role): Promise<void> {
    await removeRoleLinks(focus, role, target)
    await removeRoleLinks(target, reciprocal(role), focus)
  }

  // Make the connection between `focus` and `target` be exactly `role`, written symmetrically:
  // `focus` gets `role:: target` and `target` gets `reciprocal:: focus`. A pair has at most one
  // connection, so any pre-existing connection of a different kind (incl. a direction flip and
  // any legacy multi-role leftovers) is removed on both pages first. Same-role dedupes to a no-op.
  async function setLink(focus: string, target: string, role: Role): Promise<void> {
    const existing = await rolesBetween(focus, target)
    for (const e of existing) {
      if (e === role) continue
      await unlink(focus, target, e)
    }
    await addPropLink(focus, role, target)
    await addPropLink(target, reciprocal(role), focus)
  }

  async function create(role: Role, focus: string, name: string): Promise<boolean> {
    await setLink(focus, name, role)
    return true
  }

  return {
    createChild: (focus, name) => create('child', focus, name),
    createParent: (focus, name) => create('parent', focus, name),
    createJump: (focus, name) => create('jump', focus, name),
    async linkExisting(focus, name, role) {
      await setLink(focus, name, role)
      return true
    },
    async removeLink(focus, target, role) {
      await unlink(focus, target, role)
      return true
    },
  }
}
