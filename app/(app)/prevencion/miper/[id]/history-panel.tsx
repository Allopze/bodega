import type { MiperHistoryEvent, MiperWorkspace } from "@/lib/services/miper/queries"

/**
 * STUB de la Task 19: las versiones selladas y la bitácora de eventos las
 * implementa esa tarea. Se declaran aquí las props exactas con que
 * `miper-workspace.tsx` lo invoca, para que la página compile.
 */
export type HistoryPanelProps = {
  workspace: MiperWorkspace
  history: MiperHistoryEvent[]
}

export function HistoryPanel(_props: HistoryPanelProps) {
  return null
}
