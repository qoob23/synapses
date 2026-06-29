// Minimal logger: keep the '[synapses]' prefix in one place so plugin logs stay greppable
// across the console. warn/error are used for swallowed/degraded paths that should stay
// visible to a developer (they don't surface to the user).
export const log = {
  // Intentional, user-facing breadcrumb (e.g. where the debug log file lives) — kept
  // here so the '[synapses]' prefix stays in one place.
  info: (...args: unknown[]) => console.info('[synapses]', ...args),
  warn: (...args: unknown[]) => console.warn('[synapses]', ...args),
  error: (...args: unknown[]) => console.error('[synapses]', ...args),
}
