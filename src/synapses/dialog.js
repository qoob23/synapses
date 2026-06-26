function div(cls) {
  const d = document.createElement('div')
  d.className = cls
  return d
}

// Position a dialog box with its top-center at `at`, clamped fully on-screen.
export function clampDialogPosition(at, box, viewport) {
  const left = Math.max(0, Math.min(at.x - box.w / 2, viewport.w - box.w))
  const top = Math.max(0, Math.min(at.y, viewport.h - box.h))
  return { left, top }
}

// A real in-iframe create/link dialog (replaces window.prompt, which is blocked
// in the sandboxed plugin iframe). Resolves to true if the graph changed.
// `sourcePage` is the thought the new link attaches to (may differ from the active thought
// when triggered from a drag handle on a non-active card).
// `at` is an optional { x, y } screen point; when provided the dialog is positioned
// with its top-center at that point instead of the default centered layout.
export function openCreateDialog({ root, role, sourcePage, client, at }) {
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
    hint.textContent = 'Enter = create new · click a match = link existing · Esc = cancel'
    box.append(title, input, results, hint)
    overlay.appendChild(box)
    root.appendChild(overlay)

    // If an `at` point is provided, position the dialog at that screen location.
    if (at) {
      const r = box.getBoundingClientRect()
      const p = clampDialogPosition(
        at,
        { w: r.width || 420, h: r.height || 200 },
        { w: window.innerWidth, h: window.innerHeight },
      )
      overlay.style.alignItems = 'flex-start'
      overlay.style.justifyContent = 'flex-start'
      overlay.style.paddingTop = '0'
      box.style.position = 'absolute'
      box.style.left = p.left + 'px'
      box.style.top = p.top + 'px'
    }

    input.focus()

    let token = 0
    async function search() {
      const q = input.value.trim()
      const mine = ++token
      results.innerHTML = ''
      if (!q) return
      let matches = []
      try {
        matches = await client.call('searchPages', q)
      } catch (e) {
        /* ignore */
      }
      if (mine !== token) return
      for (const m of matches || []) {
        if (m.toLowerCase() === sourcePage.toLowerCase()) continue
        const r = div('synapses-dialog-result')
        r.textContent = m
        r.addEventListener('click', () => finish(m, true))
        results.appendChild(r)
      }
    }

    async function finish(name, existing) {
      try {
        if (existing) {
          await client.call('linkExisting', sourcePage, name, role)
        } else {
          const method =
            role === 'parent' ? 'createParent' : role === 'jump' ? 'createJump' : 'createChild'
          await client.call(method, sourcePage, name)
        }
        close(true)
      } catch (e) {
        hint.textContent = 'Failed: ' + ((e && e.message) || e)
        hint.classList.add('err')
      }
    }

    function close(changed) {
      overlay.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(changed)
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(false)
      } else if (e.key === 'Enter' && document.activeElement === input) {
        const v = input.value.trim()
        if (v) finish(v, false)
      }
    }

    input.addEventListener('input', search)
    document.addEventListener('keydown', onKey, true)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false)
    })
  })
}
