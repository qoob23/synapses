// Pure helpers to upsert/remove Dataview INLINE fields (`key:: [[A]], [[B]]`) in a
// note's markdown text. New fields go after the YAML frontmatter fence if present,
// else at the top. Only line-level fields are handled (not bracketed in-prose fields).

const FENCE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

function esc(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function replaceRegex(key: string): RegExp {
  return new RegExp(`^[ \\t]*${esc(key)}::[ \\t]*.*$`, 'im')
}
function removeRegex(key: string): RegExp {
  return new RegExp(`^[ \\t]*${esc(key)}::[ \\t]*.*\\r?\\n?`, 'im')
}
function format(targets: string[]): string {
  return targets.map((t) => `[[${t}]]`).join(', ')
}

export function upsertInlineField(text: string, key: string, targets: string[]): string {
  const line = `${key}:: ${format(targets)}`
  const re = replaceRegex(key)
  if (re.test(text)) return text.replace(re, line)
  const m = text.match(FENCE)
  if (m) {
    const idx = m[0].length
    return text.slice(0, idx) + line + '\n' + text.slice(idx)
  }
  return text ? `${line}\n${text}` : `${line}\n`
}

export function removeInlineField(text: string, key: string): string {
  return text.replace(removeRegex(key), '')
}
