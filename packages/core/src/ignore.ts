// Pure path-ignore matchers, shared by both editor adapters' `listPages`.
// Editor-agnostic (plain string logic, no editor imports) so they live in core
// and are unit-tested without a live editor.

// True when `path` is inside a `logseq/` folder at any depth — i.e. Logseq's own
// metadata directory. It holds config plus `bak/` and `.recycle/` markdown BACKUPS
// of real pages, which Obsidian's Dataview would otherwise index as phantom notes
// (and whose stale property blocks inject phantom links into the real pages). Matches
// the folder, never a file merely named `logseq.md`.
export function isInLogseqFolder(path: string): boolean {
  return /(^|\/)logseq\//i.test(String(path || ''))
}

// Mirror Obsidian's "Excluded files" (`userIgnoreFilters`) matching: each entry is
// either a `/regex/` (matched anywhere in the path, as-written/case-sensitive) or a
// folder/file path that matches itself and everything beneath it. Dataview does NOT
// honor this setting, so we apply it ourselves when listing pages.
export function matchesIgnoreFilters(path: string, filters: string[]): boolean {
  const p = String(path || '')
  for (const raw of filters || []) {
    let f = String(raw || '').trim()
    if (!f) continue
    if (f.length >= 2 && f.startsWith('/') && f.endsWith('/')) {
      try { if (new RegExp(f.slice(1, -1)).test(p)) return true } catch { /* invalid regex → skip */ }
      continue
    }
    f = f.replace(/\/+$/, '') // a folder filter may be stored with a trailing slash
    if (f && (p === f || p.startsWith(f + '/'))) return true
  }
  return false
}
