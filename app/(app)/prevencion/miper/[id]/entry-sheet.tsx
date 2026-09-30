"use client"

import type { EntryChange, MiperEntrySnapshot, MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperWorkspace } from "@/lib/services/miper/queries"

/**
 * STUB de la Task 19: el panel lateral de una fila (edición, medidas y
 * observaciones) lo implementa esa tarea. Se declaran aquí las props exactas
 * con que `miper-workspace.tsx` lo invoca, para que la página compile.
 */
export type EntrySheetProps = {
  workspace: MiperWorkspace
  entry: MiperEntrySnapshot | null
  baseline: MiperSnapshot | null
  change: EntryChange | null
  mode: WorkspaceMode
  userId: string
  onClose: () => void
  onChanged: () => void
}

export function EntrySheet(_props: EntrySheetProps) {
  return null
}
