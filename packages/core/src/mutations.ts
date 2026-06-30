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

  // roles currently connecting `focus` to `target`, read from `focus`'s OWN props.
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
  // on `focus` and its reciprocal key on `target` (e.g. child→parent). Symmetric by design,
  // so removing a link can't leave a half that resurrects on the next on-demand read.
  async function unlink(focus: string, target: string, role: Role): Promise<void> {
    await removeRoleLinks(focus, role, target)
    await removeRoleLinks(target, reciprocal(role), focus)
  }

  // Single-sided write: declare the connection ONLY on the note the user interacted with
  // (`focus`). On conflict — any pre-existing connection between the pair, declared on
  // EITHER page — drop it from both pages first, then write the new role on `focus` alone.
  // The reciprocal is intentionally NOT written to `target`, so notes the user didn't touch
  // are only ever cleaned, never given new declarations. Incoming links surface at read time
  // via backlink reconciliation, so a connection still shows even when declared on one side.
  async function setLink(focus: string, target: string, role: Role): Promise<void> {
    for (const e of await rolesBetween(focus, target)) if (e !== role) await unlink(focus, target, e)
    for (const e of await rolesBetween(target, focus)) await unlink(target, focus, e)
    await addPropLink(focus, role, target)
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
