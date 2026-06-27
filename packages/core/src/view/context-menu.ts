// A tiny custom context menu — native menus/prompt are blocked in the sandboxed
// Logseq iframe. Mirrors the create-dialog pattern: a full-bleed transparent overlay
// (robust against transformed/`contain`ed containing blocks, and a single dismiss
// surface) with the menu absolutely positioned inside it. One menu open at a time.

// Clamp a top-left point so a `box` stays fully inside `viewport`.
export function clampMenuPosition(
  at: { x: number; y: number },
  box: { w: number; h: number },
  viewport: { w: number; h: number },
) {
  const left = Math.max(0, Math.min(at.x, viewport.w - box.w))
  const top = Math.max(0, Math.min(at.y, viewport.h - box.h))
  return { left, top }
}

let openOverlay: HTMLElement | null = null

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); closeContextMenu() }
}

export function closeContextMenu(): void {
  if (!openOverlay) return
  openOverlay.remove()
  openOverlay = null
  document.removeEventListener('keydown', onKeyDown, true)
}

export function openContextMenu(opts: {
  root: HTMLElement
  at: { x: number; y: number }
  items: Array<{ label: string; onSelect: () => void }>
}): void {
  closeContextMenu()

  const overlay = document.createElement('div')
  overlay.className = 'synapses-context-overlay'
  const menu = document.createElement('div')
  menu.className = 'synapses-context-menu'
  for (const it of opts.items) {
    const row = document.createElement('div')
    row.className = 'synapses-context-menu-item'
    row.textContent = it.label
    row.addEventListener('click', () => { closeContextMenu(); it.onSelect() })
    menu.appendChild(row)
  }
  overlay.appendChild(menu)
  opts.root.appendChild(overlay)

  // The overlay fills its containing block (transformed or not). Convert the
  // viewport-space click point into overlay-local coordinates so the menu lands under
  // the cursor regardless of any transformed ancestor, then clamp inside the overlay.
  const orect = overlay.getBoundingClientRect()
  const mrect = menu.getBoundingClientRect()
  const p = clampMenuPosition(
    { x: opts.at.x - orect.left, y: opts.at.y - orect.top },
    { w: mrect.width || 180, h: mrect.height || 40 },
    { w: orect.width || window.innerWidth, h: orect.height || window.innerHeight },
  )
  menu.style.left = p.left + 'px'
  menu.style.top = p.top + 'px'
  openOverlay = overlay

  // Dismiss by pressing the bare overlay (not the menu) or Escape — same model as the
  // dialog. No scroll/blur/document-capture listeners that could tear the menu down
  // mid-click.
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeContextMenu() })
  document.addEventListener('keydown', onKeyDown, true)
}
