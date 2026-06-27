// Pure path helper for placing new notes. `parentPath` is the folder a new note
// should be created in (Obsidian's configured "Default location for new notes",
// resolved via `app.fileManager.getNewFileParent`). The vault root is either ''
// or '/', both of which yield a bare `${name}.md`.

export function newNotePath(parentPath: string, name: string): string {
  const parent = parentPath === '/' ? '' : parentPath
  return parent ? `${parent}/${name}.md` : `${name}.md`
}
