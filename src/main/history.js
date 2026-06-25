// Pure navigation-history reducer + a small stateful factory. Lives in M so
// history survives the plex iframe being re-injected; T5 persists it to disk.

const CAP = 50
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

export function pushEntry({ stack, idx }, name, cap = CAP) {
  if (idx >= 0 && same(stack[idx], name)) return { stack: stack.slice(), idx }
  const next = stack.slice(0, idx + 1)
  next.push(name)
  const overflow = next.length - cap
  const trimmed = overflow > 0 ? next.slice(overflow) : next
  return { stack: trimmed, idx: trimmed.length - 1 }
}

export function jumpTo({ stack, idx }, i) {
  const ni = i >= 0 && i < stack.length ? i : idx
  return { stack: stack.slice(), idx: ni }
}

export function serialize({ stack, idx }) {
  return JSON.stringify({ stack, idx })
}

export function deserialize(raw) {
  try {
    const o = JSON.parse(raw)
    if (!o || !Array.isArray(o.stack)) return null
    const stack = o.stack.filter((s) => typeof s === 'string')
    let idx = Number.isInteger(o.idx) ? o.idx : stack.length - 1
    if (idx < -1 || idx >= stack.length) idx = stack.length - 1
    return { stack, idx }
  } catch (e) {
    return null
  }
}

export function createHistory(onChange) {
  let state = { stack: [], idx: -1 }
  const snapshot = () => ({ list: state.stack.slice(), index: state.idx })
  return {
    state: snapshot,
    push(name) {
      state = pushEntry(state, name)
      if (onChange) onChange(state)
      return snapshot()
    },
    jump(i) {
      state = jumpTo(state, i)
      if (onChange) onChange(state)
      return { name: state.stack[state.idx] || null, ...snapshot() }
    },
    load(loaded) {
      if (loaded && Array.isArray(loaded.stack)) state = { stack: loaded.stack.slice(), idx: loaded.idx }
      return snapshot()
    },
  }
}
