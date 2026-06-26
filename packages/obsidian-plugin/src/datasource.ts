import { App, TFile } from 'obsidian'
import type { DataviewApi } from 'obsidian-dataview'
import type { DataSource, PageEntry, PropMap } from '@logseq-synapses/core'
import { upsertInlineField, removeInlineField } from './inline-fields'
import { pageToPropMap } from './dataview-map'

export function createObsidianDataSource(app: App): DataSource {
  const dv = (): DataviewApi | undefined => (app as any).plugins?.plugins?.dataview?.api

  function resolveFile(name: string): TFile | null {
    const byLink = app.metadataCache.getFirstLinkpathDest(name, '')
    if (byLink) return byLink
    const path = name.endsWith('.md') ? name : `${name}.md`
    const byPath = app.vault.getAbstractFileByPath(path)
    return byPath instanceof TFile ? byPath : null
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
        const name = (page as any)?.file?.name
        if (!name) continue
        out.push({ name, props: pageToPropMap(page as unknown as Record<string, unknown>) })
      }
      return out
    },
    getPageProps: (name) => readProps(name),
    async ensurePage(name) {
      if (resolveFile(name)) return
      await app.vault.create(`${name}.md`, '')
    },
    async setPropertyLinks(name, key, targets) {
      let file = resolveFile(name)
      if (!file) { await app.vault.create(`${name}.md`, ''); file = resolveFile(name) }
      if (!file) return
      await app.vault.process(file, (data) => upsertInlineField(data, key, targets))
    },
    async removePropertyKey(name, key) {
      const file = resolveFile(name); if (!file) return
      await app.vault.process(file, (data) => removeInlineField(data, key))
    },
    async searchPages(q) {
      const query = String(q || '').toLowerCase().trim(); if (!query) return []
      const out: string[] = []
      for (const f of app.vault.getMarkdownFiles()) {
        if (f.basename.toLowerCase().includes(query)) out.push(f.basename)
        if (out.length >= 20) break
      }
      return out
    },
  }
}
