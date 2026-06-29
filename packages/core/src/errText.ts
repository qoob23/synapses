// Coerce an unknown thrown value to a human-readable string. Replaces the repeated
// `(e && e.message) || e` idiom at the catch sites and lets catch clauses keep `e`
// as `unknown` instead of widening to `any`.
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message: unknown }).message
    if (typeof m === 'string') return m
  }
  try {
    return JSON.stringify(e) ?? 'unknown error'
  } catch {
    return 'unknown error'
  }
}
