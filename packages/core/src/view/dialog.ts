import type { Role, SynapsesBackend } from '../types'

function div(cls: string) {
  const d = document.createElement('div')
  d.className = cls
  return d
}

// Clamp a highlight index by `delta` within [0, len-1]; -1 when the list is empty.
export function nextHighlight(current: number, len: number, delta: number): number {
  if (len <= 0) return -1
  const next = current + delta
  if (next < 0) return 0
  if (next > len - 1) return len - 1
  return next
}

// Position a dialog box with its top-center at `at`, clamped fully on-screen.
export function clampDialogPosition(
  at: { x: number; y: number },
  box: { w: number; h: number },
  viewport: { w: number; h: number },
) {
  const left = Math.max(0, Math.min(at.x - box.w / 2, viewport.w - box.w))
  const top = Math.max(0, Math.min(at.y, viewport.h - box.h))
  return { left, top }
}

// A real in-iframe create/link dialog (replaces window.prompt, which is blocked
// in the sandboxed plugin iframe). Resolves to true if the graph changed.
// `sourcePage` is the note the new link attaches to (may differ from the active note
// when triggered from a drag handle on a non-active card).
// `at` is an optional { x, y } screen point; when provided the dialog is positioned
// with its top-center at that point instead of the default centered layout.
export function openCreateDialog({
  root,
  role,
  sourcePage,
  backend,
  at,
}: {
  root: HTMLElement
  role: Role
  sourcePage: string
  backend: SynapsesBackend
  at?: { x: number; y: number } | null
}): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = div('synapses-dialog-overlay')
    const box = div('synapses-dialog')
    const title = div('synapses-dialog-title')
    title.textContent = `Add ${role} of "${sourcePage}"`
    const input = document.createElement('input')
    input.className = 'synapses-dialog-input'
    input.placeholder = 'Type a note name…'
    const results = div('synapses-dialog-results')
    const hint = div('synapses-dialog-hint')
    hint.textContent = '↑↓ move · Enter select · Esc cancel'
    box.append(title, input, results, hint)
    overlay.appendChild(box)
    root.appendChild(overlay)

    // If an `at` point is provided, position the dialog at that screen location.
    // The overlay is `position:fixed; inset:0`, so it fills its containing block —
    // the viewport in Logseq's iframe, but Obsidian's *transformed* sidebar pane
    // (offset from the viewport). `at` is viewport-space (clientX/clientY) and the
    // box is `position:absolute` inside the overlay, so we must convert `at` into
    // overlay-local coordinates and clamp against the overlay's own box — otherwise
    // the dialog lands far off to the right / behind the view in Obsidian. Mirrors
    // the same fix already in view/context-menu.ts (clampMenuPosition).
    //
    // Clamp against the box's *eventual* height (its current empty-chrome height plus
    // the results list's max-height), not its current height: results render lazily as
    // the user types. Reserving that space up front positions the dialog high enough
    // from the start, so it never has to jump up once matches appear.
    if (at) {
      const orect = overlay.getBoundingClientRect()
      const brect = box.getBoundingClientRect()
      const maxResults = parseFloat(getComputedStyle(results).maxHeight) || 180
      const p = clampDialogPosition(
        { x: at.x - orect.left, y: at.y - orect.top },
        { w: brect.width || 420, h: (brect.height || 200) + maxResults },
        { w: orect.width || window.innerWidth, h: orect.height || window.innerHeight },
      )
      overlay.classList.add('is-anchored')
      box.classList.add('is-anchored')
      box.style.left = p.left + 'px'
      box.style.top = p.top + 'px'
    }

    input.focus()

    let token = 0
    let highlight = 0
    let rows: Array<{ el: HTMLElement; act: () => void }> = []

    function paint() {
      for (let i = 0; i < rows.length; i++) rows[i].el.classList.toggle('is-active', i === highlight)
      if (rows[highlight]) rows[highlight].el.scrollIntoView({ block: 'nearest' })
    }

    function setHighlight(i: number) {
      highlight = i
      paint()
    }

    // Render an ordered list: a "create" row first (when the query is non-empty), then matches.
    function render(matches: string[]) {
      results.innerHTML = ''
      rows = []
      const q = input.value.trim()
      if (q) {
        const createRow = div('synapses-dialog-result')
        createRow.textContent = `✛ Create "${q}"`
        const act = () => finish(q, false)
        createRow.addEventListener('click', act)
        createRow.addEventListener('mousemove', () => setHighlight(0))
        results.appendChild(createRow)
        rows.push({ el: createRow, act })
      }
      for (const m of matches) {
        if (m.toLowerCase() === sourcePage.toLowerCase()) continue
        const idx = rows.length
        const r = div('synapses-dialog-result')
        r.textContent = m
        const act = () => finish(m, true)
        r.addEventListener('click', act)
        r.addEventListener('mousemove', () => setHighlight(idx))
        results.appendChild(r)
        rows.push({ el: r, act })
      }
      if (highlight > rows.length - 1) highlight = rows.length - 1
      if (highlight < 0) highlight = rows.length ? 0 : -1
      paint()
    }

    async function search() {
      const mine = ++token
      const q = input.value.trim()
      if (!q) { render([]); return }
      let matches: string[] = []
      try {
        matches = await backend.searchPages(q)
      } catch (e) {
        /* ignore */
      }
      if (mine !== token) return
      highlight = 0 // default highlight = the create row
      render(matches || [])
    }

    async function finish(name: string, existing: boolean) {
      try {
        if (existing) {
          await backend.linkExisting(sourcePage, name, role)
        } else if (role === 'parent') {
          await backend.createParent(sourcePage, name)
        } else if (role === 'jump') {
          await backend.createJump(sourcePage, name)
        } else {
          await backend.createChild(sourcePage, name)
        }
        close(true)
      } catch (e: any) {
        hint.textContent = 'Failed: ' + ((e && e.message) || e)
        hint.classList.add('err')
      }
    }

    function close(changed: boolean) {
      overlay.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(changed)
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); close(false); return }
      const ctrl = e.ctrlKey && !e.metaKey
      const down = e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey) || (ctrl && (e.key === 'j' || e.key === 'n'))
      const up = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) || (ctrl && (e.key === 'k' || e.key === 'p'))
      if (down) { e.preventDefault(); setHighlight(nextHighlight(highlight, rows.length, 1)); return }
      if (up) { e.preventDefault(); setHighlight(nextHighlight(highlight, rows.length, -1)); return }
      if (e.key === 'Enter') {
        e.preventDefault()
        const row = rows[highlight]
        if (row) row.act()
      }
    }

    input.addEventListener('input', search)
    document.addEventListener('keydown', onKey, true)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false)
    })
  })
}
