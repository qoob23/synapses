export type Role = 'parent' | 'child' | 'jump'

export interface Graph {
  focus: string
  parents: string[]
  children: string[]
  jumps: string[]
  siblings: string[]
  siblingsTruncated: boolean
  siblingParent: Record<string, string>
}

export interface HistoryState { list: string[]; index: number }
export interface HistoryJump { name: string | null; list: string[]; index: number }
export type Adjacency = Record<string, { parents: string[]; children: string[]; jumps: string[] }>

export interface Palette {
  mode: 'light' | 'dark'
  bg?: string; bg2?: string; text?: string; text2?: string; border?: string; accent?: string
  // User-configured connector color overrides, already resolved for the current
  // mode by the editor adapter (blank setting => undefined => auto-derived).
  // primaryEdge = parent/child connectors; secondaryEdge = jump/sibling connectors.
  primaryEdge?: string; secondaryEdge?: string
}

export type BackendEvent = 'recenter' | 'theme' | 'refresh' | 'uimode'

export interface UiMode { mobile: boolean }

export interface SynapsesBackend {
  getActivePage(): Promise<string | null>
  getTheme(): Promise<Palette>
  getUiMode(): Promise<UiMode>
  buildGraph(name: string): Promise<Graph>
  nodeAdjacency(names: string[]): Promise<Adjacency>
  rebuildIndex(): Promise<void> // hard refresh: discard in-memory index + patches, rebuild from the editor
  histState(): Promise<HistoryState>
  histPush(name: string): Promise<HistoryState>
  histJump(i: number): Promise<HistoryJump | null>
  histRemove(name: string): Promise<HistoryState>
  histRemoveMissing(names: string[]): Promise<{ removed: string[]; state: HistoryState }>
  navigate(name: string): Promise<boolean>
  createChild(focus: string, name: string): Promise<boolean>
  createParent(focus: string, name: string): Promise<boolean>
  createJump(focus: string, name: string): Promise<boolean>
  linkExisting(focus: string, name: string, role: Role): Promise<boolean>
  removeLink(focus: string, name: string, role: Role): Promise<boolean>
  searchPages(q: string): Promise<string[]>
  getSize(): Promise<number | null>
  setSize(level: number | null): Promise<void> // discrete card/text size level; null resets to default
  on(event: BackendEvent, handler: (payload?: any) => void): () => void
}

// ----- Seam B (editor-implemented) -----
export type PropMap = Record<string, string[]>   // link-valued fields only; plain target names (no [[ ]])
export interface PageEntry { name: string; props: PropMap }

export interface DataSource {
  listPages(): Promise<PageEntry[]>
  getPageProps(name: string): Promise<PropMap>
  ensurePage(name: string): Promise<void>
  setPropertyLinks(name: string, key: string, targets: string[]): Promise<void>
  removePropertyKey(name: string, key: string): Promise<void>
  searchPages(q: string): Promise<string[]>
  pageExists(name: string): Promise<boolean>
}

export interface Persistence {
  load(key: string): Promise<string | null>
  save(key: string, value: string): Promise<void>
}

export interface OntologyConfig { parent: string[]; child: string[]; jump: string[] }

export interface EditorServices {
  getActivePageName(): Promise<string | null> | (string | null)
  onActivePageChange(cb: (name: string | null) => void): void
  navigateTo(name: string): Promise<void>
  getTheme(): Palette | Promise<Palette>
  onThemeChange(cb: (palette: Palette) => void): void
  getUiMode(): UiMode
  onUiModeChange(cb: () => void): void
  onGraphChange(cb: () => void): void
  getOntology(): OntologyConfig
  onOntologyChange(cb: () => void): void
  persistence: Persistence
}
