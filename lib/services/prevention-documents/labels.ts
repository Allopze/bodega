export function buildFolderOptionLabels(folders: Array<{ id: string; name: string; parentId: string | null }>) {
  const byParent = new Map<string | null, Array<{ id: string; name: string; parentId: string | null }>>()
  for (const folder of folders) {
    const siblings = byParent.get(folder.parentId) ?? []
    siblings.push(folder)
    byParent.set(folder.parentId, siblings)
  }
  for (const siblings of byParent.values()) siblings.sort((a, b) => a.name.localeCompare(b.name, "es"))

  const labels: Array<{ id: string; label: string }> = []
  const visit = (parentId: string | null, depth: number, path: Set<string>) => {
    for (const folder of byParent.get(parentId) ?? []) {
      if (path.has(folder.id)) continue
      labels.push({ id: folder.id, label: `${"—".repeat(depth)}${depth ? " " : ""}${folder.name}` })
      visit(folder.id, depth + 1, new Set([...path, folder.id]))
    }
  }
  visit(null, 0, new Set())
  return labels
}
