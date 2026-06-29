import { mountSynapses } from '@logseq-synapses/core'
import { ItemView } from 'obsidian'
import type SynapsesPlugin from './main'
import type { WorkspaceLeaf } from 'obsidian'

export const VIEW_TYPE_SYNAPSES = 'synapses-view'

export class SynapsesView extends ItemView {
  private plugin: SynapsesPlugin
  private teardown: (() => void) | null = null
  constructor(leaf: WorkspaceLeaf, plugin: SynapsesPlugin) { super(leaf); this.plugin = plugin }
  getViewType() { return VIEW_TYPE_SYNAPSES }
  getDisplayText() { return 'Synapses' }
  getIcon() { return 'brain' }
  async onOpen() {
    this.teardown?.()
    this.teardown = null
    const backend = this.plugin.getBackend()
    if (!backend) {
      this.contentEl.empty()
      this.contentEl.createEl('div', {
        text: 'Synapses requires the Dataview plugin to be installed and enabled.',
        attr: { style: 'padding:12px' },
      })
      return
    }
    this.teardown = mountSynapses(this.contentEl, backend)
  }
  async onClose() { this.teardown?.(); this.teardown = null }
}
