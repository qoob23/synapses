// In-iframe connector-color popover: a native color picker + reset (×) per row,
// for the CURRENT theme mode. Native menus/prompt are blocked in the sandboxed
// Logseq iframe, so this mirrors the context-menu overlay pattern (full-bleed
// overlay + positioned box, dismissed by clicking the bare overlay or Escape).
import { rgbToHex } from './color'

export interface ColorRow {
  label: string
  value: string | undefined // stored override (any CSS color), or undefined = auto-derive
  fallback: string // the auto-derived color, shown in the swatch when there's no override
  // value === null => reset this row to auto.
  onChange: (value: string | null) => void
}

let openOverlay: HTMLElement | null = null

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); closeColorsPopover() }
}

export function closeColorsPopover(): void {
  if (!openOverlay) return
  openOverlay.remove()
  openOverlay = null
  document.removeEventListener('keydown', onKeyDown, true)
}

export function openColorsPopover(opts: {
  root: HTMLElement
  at: { x: number; y: number }
  title: string
  rows: ColorRow[]
}): void {
  closeColorsPopover()

  const overlay = document.createElement('div')
  overlay.className = 'synapses-colors-overlay'
  const box = document.createElement('div')
  box.className = 'synapses-colors'

  const head = document.createElement('div')
  head.className = 'synapses-colors-head'
  head.textContent = opts.title
  box.appendChild(head)

  for (const row of opts.rows) {
    const r = document.createElement('div')
    r.className = 'synapses-colors-row'

    const label = document.createElement('span')
    label.className = 'synapses-colors-label'
    label.textContent = row.label

    // <input type="color"> only accepts #rrggbb. With no override, show the
    // auto-derived color so the swatch reflects the actual connector color.
    const input = document.createElement('input')
    input.type = 'color'
    input.className = 'synapses-colors-swatch'
    const setSwatch = (override?: string) => {
      input.value = rgbToHex(override) || rgbToHex(row.fallback) || '#888888'
    }
    setSwatch(row.value)

    const reset = document.createElement('button')
    reset.className = 'synapses-colors-reset'
    reset.textContent = '×'
    reset.setAttribute('aria-label', 'Reset to auto')
    reset.dataset.tip = 'Reset to auto'
    reset.disabled = !row.value

    // 'change' (not 'input') so we persist once when the OS picker closes, not on
    // every drag frame.
    input.addEventListener('change', () => {
      row.value = input.value
      reset.disabled = false
      row.onChange(input.value)
    })
    reset.addEventListener('click', () => {
      row.value = undefined
      setSwatch(undefined)
      reset.disabled = true
      row.onChange(null)
    })

    r.append(label, input, reset)
    box.appendChild(r)
  }

  overlay.appendChild(box)
  opts.root.appendChild(overlay)

  // Convert the viewport-space anchor into overlay-local coords (robust to a
  // transformed containing block), then clamp the box inside the overlay.
  const orect = overlay.getBoundingClientRect()
  const brect = box.getBoundingClientRect()
  const vw = orect.width || window.innerWidth
  const vh = orect.height || window.innerHeight
  box.style.left = Math.max(0, Math.min(opts.at.x - orect.left, vw - (brect.width || 240))) + 'px'
  box.style.top = Math.max(0, Math.min(opts.at.y - orect.top, vh - (brect.height || 120))) + 'px'
  openOverlay = overlay

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeColorsPopover() })
  document.addEventListener('keydown', onKeyDown, true)
}
