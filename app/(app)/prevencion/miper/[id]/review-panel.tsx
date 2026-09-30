"use client"

import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperWorkspace } from "@/lib/services/miper/queries"

/**
 * STUB de la Task 19: el panel de revisión (observaciones por responder y
 * decidir) lo implementa esa tarea. Se declaran aquí las props exactas con que
 * `miper-workspace.tsx` lo invoca, para que la página compile.
 */
export type ReviewPanelProps = {
  workspace: MiperWorkspace
  mode: WorkspaceMode
  onOpenEntry: (entryId: string) => void
}

export function ReviewPanel(_props: ReviewPanelProps) {
  return null
}
