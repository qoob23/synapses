function div(cls) {
  const d = document.createElement('div')
  d.className = cls
  return d
}

// A real in-iframe create/link dialog (replaces window.prompt, which is blocked
// in the sandboxed plugin iframe). Resolves to true if the graph changed.
export function openCreateDialog({ root, role, focus, client }) {
  return new Promise((resolve) => {
    const overlay = div('plex-dialog-overlay')
    const box = div('plex-dialog')
    const title = div('plex-dialog-title')
    title.textContent = `Add ${role} of "${focus}"`
    const input = document.createElement('input')
    input.className = 'plex-dialog-input'
    input.placeholder = 'Type a note name…'
    const results = div('plex-dialog-results')
    const hint = div('plex-dialog-hint')
    hint.textContent = 'Enter = create new · click a match = link existing · Esc = cancel'
    box.append(title, input, results, hint)
    overlay.appendChild(box)
    root.appendChild(overlay)
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
        if (m.toLowerCase() === focus.toLowerCase()) continue
        const r = div('plex-dialog-result')
        r.textContent = m
        r.addEventListener('click', () => finish(m, true))
        results.appendChild(r)
      }
    }

    async function finish(name, existing) {
      try {
        if (existing) {
          await client.call('linkExisting', focus, name, role)
        } else {
          const method =
            role === 'parent' ? 'createParent' : role === 'jump' ? 'createJump' : 'createChild'
          await client.call(method, focus, name)
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
