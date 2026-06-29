import type { PropMap } from '@logseq-synapses/core'

// Dataview page object: link/scalar fields as own keys plus a `file` descriptor.
export interface DvPage {
  file?: { path?: string; name?: string }
  [k: string]: unknown
}

interface DvLinkLike { path: string }
function isLink(v: unknown): v is DvLinkLike {
  return !!v && typeof v === 'object' && typeof (v as { path?: unknown }).path === 'string'
}
export function linkPathToBasename(path: string): string {
  const last = path.split('/').pop() || path
  return last.replace(/\.md$/i, '')
}

// Any field value → array of plain target basenames; [] if not link-valued.
export function valueToNames(v: unknown): string[] {
  const out: string[] = []
  const push = (x: unknown) => {
    if (isLink(x)) out.push(linkPathToBasename(x.path))
    else if (typeof x === 'string' && /^\[\[.*\]\]$/.test(x.trim())) {
      out.push(linkPathToBasename(x.trim().replace(/^\[\[/, '').replace(/\]\]$/, '').trim()))
    }
  }
  if (Array.isArray(v)) v.forEach(push)
  else push(v)
  return out.filter(Boolean)
}

// Dataview page object (fields as own keys + a `file` key) → PropMap of link-valued
// fields only (plain basenames). Core filters keys→roles via the ontology.
export function pageToPropMap(page: DvPage): PropMap {
  const out: PropMap = {}
  for (const key of Object.keys(page)) {
    if (key === 'file') continue
    const names = valueToNames(page[key])
    if (names.length) out[key] = names
  }
  return out
}
