// Pure decision for where to write a link property, given whether the key already
// lives in YAML frontmatter and/or as an inline `key::` line:
//   - 'frontmatter' — edit the existing frontmatter value in place
//   - 'inline'      — replace the existing inline line in place
//   - 'default'     — add a new inline field (after the frontmatter fence)
// Frontmatter wins when the key exists in both places.

type WriteTarget = 'frontmatter' | 'inline' | 'default'

export function chooseWriteTarget(opts: {
  hasFrontmatterKey: boolean
  hasInlineKey: boolean
}): WriteTarget {
  if (opts.hasFrontmatterKey) return 'frontmatter'
  if (opts.hasInlineKey) return 'inline'
  return 'default'
}
