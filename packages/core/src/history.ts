// Pure navigation-history reducer + a small stateful factory. Lives in the
// editor-agnostic core so history survives the synapses iframe being re-injected;
// the editor adapter persists it to disk.

import type { HistoryState, HistoryJump } from './types'

// The reducer's internal shape (distinct from the snapshot `HistoryState`).
export interface HistoryStack {
  stack: string[]
  idx: number
}

const CAP = 50
const same = (a: string, b: string): boolean => String(a).toLowerCase() === String(b).toLowerCase()

export function pushEntry({ stack, idx }: HistoryStack, name: string, cap = CAP): HistoryStack {
  if (idx >= 0 && same(stack[idx], name)) return { stack: stack.slice(), idx }
  // Drop forward history past the current position, then make the activated thought
  // the right-most (most-recent) entry — de-duping so a re-activated thought MOVES
  // to the right rather than appearing twice.
  const next = stack.slice(0, idx + 1).filter((s) => !same(s, name))
  next.push(name)
  const overflow = next.length - cap
  const trimmed = overflow > 0 ? next.slice(overflow) : next
  return { stack: trimmed, idx: trimmed.length - 1 }
}

export function jumpTo({ stack, idx }: HistoryStack, i: number): HistoryStack {
  const ni = i >= 0 && i < stack.length ? i : idx
  return { stack: stack.slice(), idx: ni }
}

export function serialize({ stack, idx }: HistoryStack): string {
  return JSON.stringify({ stack, idx })
}

export function deserialize(raw: string): HistoryStack | null {
  try {
    const o = JSON.parse(raw)
    if (!o || !Array.isArray(o.stack)) return null
    const stack = o.stack.filter((s: unknown) => typeof s === 'string')
    let idx = Number.isInteger(o.idx) ? o.idx : stack.length - 1
    if (idx < -1 || idx >= stack.length) idx = stack.length - 1
    return { stack, idx }
  } catch (e) {
    return null
  }
}

export interface History {
  state(): HistoryState
  push(name: string): HistoryState
  jump(i: number): HistoryJump | null
  load(loaded: HistoryStack | null | undefined): HistoryState
}

export function createHistory(onChange?: (s: HistoryStack) => void): History {
  let state: HistoryStack = { stack: [], idx: -1 }
  const snapshot = (): HistoryState => ({ list: state.stack.slice(), index: state.idx })
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
