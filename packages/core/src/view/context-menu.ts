// A tiny custom context menu — native menus/prompt are blocked in the sandboxed
// Logseq iframe. One menu open at a time; dismissed on outside click / Esc / scroll / blur.

// Position the menu with its top-left at `at`, clamped fully on-screen.
export function clampMenuPosition(
  at: { x: number; y: number },
  box: { w: number; h: number },
  viewport: { w: number; h: number },
) {
  const left = Math.max(0, Math.min(at.x, viewport.w - box.w))
  const top = Math.max(0, Math.min(at.y, viewport.h - box.h))
  return { left, top }
}

let openMenu: HTMLElement | null = null

function onDocDown(e: MouseEvent) {
  if (openMenu && !openMenu.contains(e.target as Node)) closeContextMenu()
}
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); closeContextMenu() }
}

export function closeContextMenu(): void {
  if (!openMenu) return
  openMenu.remove()
  openMenu = null
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('scroll', closeContextMenu, true)
  window.removeEventListener('blur', closeContextMenu, true)
}

export function openContextMenu(opts: {
  root: HTMLElement
  at: { x: number; y: number }
  items: Array<{ label: string; onSelect: () => void }>
}): void {
  closeContextMenu()
  const menu = document.createElement('div')
  menu.className = 'synapses-context-menu'
  for (const it of opts.items) {
    const row = document.createElement('div')
    row.className = 'synapses-context-menu-item'
    row.textContent = it.label
    row.addEventListener('click', () => { closeContextMenu(); it.onSelect() })
    menu.appendChild(row)
  }
  opts.root.appendChild(menu)

  const r = menu.getBoundingClientRect()
  const p = clampMenuPosition(
    opts.at,
    { w: r.width || 180, h: r.height || 40 },
    { w: window.innerWidth, h: window.innerHeight },
  )
  menu.style.position = 'fixed'
  menu.style.left = p.left + 'px'
  menu.style.top = p.top + 'px'
  openMenu = menu

  // Register dismissers next tick so the opening contextmenu event doesn't self-close.
  setTimeout(() => {
    document.addEventListener('mousedown', onDocDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', closeContextMenu, true)
    window.addEventListener('blur', closeContextMenu, true)
  }, 0)
}
