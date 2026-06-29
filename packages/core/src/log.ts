// Minimal logger: keep the '[synapses]' prefix in one place so plugin logs stay greppable
// across the console. warn/error are used for swallowed/degraded paths that should stay
// visible to a developer (they don't surface to the user).
export const log = {
  warn: (...args: unknown[]) => console.warn('[synapses]', ...args),
  error: (...args: unknown[]) => console.error('[synapses]', ...args),
}
