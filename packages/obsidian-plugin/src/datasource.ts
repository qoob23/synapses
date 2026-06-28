import { App, TFile } from 'obsidian'
import type { DataviewApi } from 'obsidian-dataview'
import type { DataSource, PageEntry, PropMap } from '@logseq-synapses/core'
import { isInLogseqFolder, matchesIgnoreFilters } from '@logseq-synapses/core'
import { upsertInlineField, removeInlineField, hasInlineField } from './inline-fields'
import { newNotePath } from './paths'
import { chooseWriteTarget } from './write-target'
import { pageToPropMap } from './dataview-map'

export function createObsidianDataSource(app: App): DataSource {
  const dv = (): DataviewApi | undefined => (app as any).plugins?.plugins?.dataview?.api

  // Obsidian's "Excluded files" setting (Settings → Files and links). Dataview does not
  // honor it, so we read it ourselves and apply it to listPages/searchPages.
  const userIgnoreFilters = (): string[] => {
    try { return (app.vault as any).getConfig?.('userIgnoreFilters') || [] } catch { return [] }
  }
  // A path is hidden if it lives in a logseq/ folder (always — Logseq's bak/recycle
  // markdown backups must never surface as thoughts) or matches the user's excluded files.
  const isIgnoredPath = (path: string): boolean =>
    isInLogseqFolder(path) || matchesIgnoreFilters(path, userIgnoreFilters())

  function resolveFile(name: string): TFile | null {
    const byLink = app.metadataCache.getFirstLinkpathDest(name, '')
    if (byLink) return byLink
    const path = name.endsWith('.md') ? name : `${name}.md`
    const byPath = app.vault.getAbstractFileByPath(path)
    return byPath instanceof TFile ? byPath : null
  }

  // Build the create path for a new note in Obsidian's configured "Default
  // location for new notes" (root path may be '/' or ''; newNotePath normalizes).
  function createPathFor(name: string): string {
    const parent = app.fileManager.getNewFileParent('')
    return newNotePath(parent?.path ?? '', name)
  }

  function frontmatterHasKey(file: TFile, key: string): boolean {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter
    return !!fm && key in fm
  }

  async function readProps(name: string): Promise<PropMap> {
    const api = dv(); if (!api) return {}
    const file = resolveFile(name)
    const page = file ? api.page(file.path) : api.page(name)
    return page ? pageToPropMap(page as unknown as Record<string, unknown>) : {}
  }

  return {
    async listPages(): Promise<PageEntry[]> {
      const api = dv(); if (!api) return []
      const out: PageEntry[] = []
      for (const page of api.pages()) {
        const path = (page as any)?.file?.path
        if (path && isIgnoredPath(path)) continue // excluded folder / logseq backups
        const name = (page as any)?.file?.name
        if (!name) continue
        out.push({ name, props: pageToPropMap(page as unknown as Record<string, unknown>) })
      }
      return out
    },
    getPageProps: (name) => readProps(name),
    async ensurePage(name) {
      if (resolveFile(name)) return
      await app.vault.create(createPathFor(name), '')
    },
    async setPropertyLinks(name, key, targets) {
      let file = resolveFile(name)
      if (!file) { await app.vault.create(createPathFor(name), ''); file = resolveFile(name) }
      if (!file) return
      const text = await app.vault.read(file)
      const target = chooseWriteTarget({
        hasFrontmatterKey: frontmatterHasKey(file, key),
        hasInlineKey: hasInlineField(text, key),
      })
      if (target === 'frontmatter') {
        await app.fileManager.processFrontMatter(file, (fm) => {
          fm[key] = targets.map((t) => `[[${t}]]`)
        })
      } else {
        // 'inline' replaces the existing key:: line in place; 'default' prepends
        // a new one after the frontmatter fence — both via upsertInlineField.
        await app.vault.process(file, (data) => upsertInlineField(data, key, targets))
      }
    },
    async removePropertyKey(name, key) {
      const file = resolveFile(name); if (!file) return
      if (frontmatterHasKey(file, key)) {
        await app.fileManager.processFrontMatter(file, (fm) => { delete fm[key] })
      }
      await app.vault.process(file, (data) => removeInlineField(data, key))
    },
    async pageExists(name) {
      return !!resolveFile(name)
    },
    async searchPages(q) {
      const query = String(q || '').toLowerCase().trim(); if (!query) return []
      const out: string[] = []
      for (const f of app.vault.getMarkdownFiles()) {
        if (isIgnoredPath(f.path)) continue // don't offer excluded files / logseq backups as link targets
        if (f.basename.toLowerCase().includes(query)) out.push(f.basename)
        if (out.length >= 20) break
      }
      return out
    },
  }
}
