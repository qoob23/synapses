import type { DvPage } from './dataview-map'
import type { App } from 'obsidian'

// The slice of Dataview's API we actually use. The published `DataviewApi` type does not
// resolve in this build (its declaration uses bare-specifier imports that need Dataview's
// own `baseUrl`), so we model just what we touch.
export interface DvApi {
  page(path: string): DvPage | undefined
  pages(query?: string): Iterable<DvPage>
}

// Reach Dataview's live API/instance off Obsidian's plugin registry, typed.
//
// We deliberately do NOT import obsidian-dataview's `getAPI`/`isPluginEnabled` as VALUES:
// a value import makes esbuild inline the entire Dataview library into the plugin's
// main.js. Dataview is a peer plugin resolved at runtime, so we read the live instance
// (typed via this local interface) — the same access getAPI performs internally.
interface AppWithDataview {
  plugins?: { plugins?: { dataview?: { api?: DvApi } } }
}

export function getDataviewApi(app: App): DvApi | undefined {
  return (app as unknown as AppWithDataview).plugins?.plugins?.dataview?.api
}

export function isDataviewEnabled(app: App): boolean {
  return !!(app as unknown as AppWithDataview).plugins?.plugins?.dataview
}
