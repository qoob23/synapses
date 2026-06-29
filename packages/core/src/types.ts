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
  // The user-configured connector color override, already resolved for the current
  // mode by the adapter (blank setting => undefined => auto-derived). It drives all
  // connectors (jump/sibling are the same color, just more transparent) plus the
  // structural accents (card borders, active card, handles) via --synapses-primary.
  primaryEdge?: string
}

// Payload shape per backend event — drives the generic `on`/`emit` so subscribers
// get a typed payload instead of `any`. `void` events carry no payload.
export interface BackendEventPayloads {
  recenter: { page: string }
  theme: Palette
  refresh: void
  uimode: void
}
export type BackendEvent = keyof BackendEventPayloads

export interface UiMode { mobile: boolean }

// The user connector-color override, persisted per mode. A missing key means
// "auto-derive from the theme" for that mode.
export interface ConnectorColors {
  primaryLight?: string; primaryDark?: string
}

export interface SynapsesBackend {
  getActivePage(): Promise<string | null>
  getTheme(): Promise<Palette>
  getUiMode(): Promise<UiMode>
  buildGraph(name: string): Promise<Graph>
  nodeAdjacency(names: string[]): Promise<Adjacency>
  histState(): Promise<HistoryState>
  histPush(name: string): Promise<HistoryState>
  histJump(i: number): Promise<HistoryJump | null>
  histRemove(name: string): Promise<HistoryState>
  navigate(name: string): Promise<boolean>
  createChild(focus: string, name: string): Promise<boolean>
  createParent(focus: string, name: string): Promise<boolean>
  createJump(focus: string, name: string): Promise<boolean>
  linkExisting(focus: string, name: string, role: Role): Promise<boolean>
  removeLink(focus: string, name: string, role: Role): Promise<boolean>
  repairSymmetryOnce(): Promise<void>   // one-time link-symmetry normalization per graph/vault (persisted flag), then no-ops
  searchPages(q: string): Promise<string[]>
  getSize(): Promise<number | null>
  setSize(level: number | null): Promise<void> // discrete card/text size level; null resets to default
  getConnectorColors(): Promise<ConnectorColors>
  setConnectorColors(colors: ConnectorColors): Promise<void> // persisted verbatim; omit a key to reset it to auto
  on<K extends BackendEvent>(event: K, handler: (payload: BackendEventPayloads[K]) => void): () => void
}

// ----- Seam B (editor-implemented) -----
export type PropMap = Record<string, string[]>   // link-valued fields only; plain target names (no [[ ]])
export interface PageEntry { name: string; props: PropMap }

export interface DataSource {
  getPageProps(name: string): Promise<PropMap>
  ensurePage(name: string): Promise<void>
  setPropertyLinks(name: string, key: string, targets: string[]): Promise<void>
  removePropertyKey(name: string, key: string): Promise<void>
  searchPages(q: string): Promise<string[]>
  // One-time full enumeration for the symmetry-repair migration only (NOT used by the
  // on-demand read path). Returns every real page with its link-valued props.
  listAllPages?(): Promise<PageEntry[]>
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
