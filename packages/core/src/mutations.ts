import { roleForKey } from './ontology'
import type { DataSource, OntologyConfig, Role } from './types'
import type { LinkIndex } from './graph/link-index'

// Pure: drop `target` (case-insensitive) from a list of link names.
export function removeFromLinkList(names: string[], target: string): string[] {
  const t = String(target).toLowerCase()
  return names.filter((n) => n.toLowerCase() !== t)
}

export interface Mutations {
  createChild(focus: string, name: string): Promise<boolean>
  createParent(focus: string, name: string): Promise<boolean>
  createJump(focus: string, name: string): Promise<boolean>
  linkExisting(focus: string, name: string, role: Role): Promise<boolean>
  removeLink(focus: string, name: string, role: Role): Promise<boolean>
}

export function createMutations(
  dataSource: DataSource,
  index: Pick<LinkIndex, 'patchIndex' | 'patchRemove'>,
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

  async function create(role: Role, focus: string, name: string): Promise<boolean> {
    await dataSource.ensurePage(name)
    await addPropLink(focus, role, name)
    index.patchIndex(focus, role, name)
    return true
  }

  return {
    createChild: (focus, name) => create('child', focus, name),
    createParent: (focus, name) => create('parent', focus, name),
    createJump: (focus, name) => create('jump', focus, name),
    async linkExisting(focus, name, role) {
      await addPropLink(focus, role, name)
      index.patchIndex(focus, role, name)
      return true
    },
    async removeLink(focus, target, role) {
      const recip: Role = role === 'parent' ? 'child' : role === 'child' ? 'parent' : 'jump'
      await removeRoleLinks(focus, role, target)
      await removeRoleLinks(target, recip, focus)
      index.patchRemove(focus, role, target)
      return true
    },
  }
}
