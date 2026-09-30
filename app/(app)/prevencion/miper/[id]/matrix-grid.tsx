"use client"

import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { EntryChange, MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { MiperWorkspace } from "@/lib/services/miper/queries"

/**
 * STUB de la Task 18: la grilla editable de la matriz la implementa esa tarea.
 * Se declaran aquí las props exactas con que `miper-workspace.tsx` la invoca,
 * para que la página compile y se pueda probar la pestaña Antecedentes.
 */
export type MatrixGridProps = {
  matrixId: string
  rows: MiperEntrySnapshot[]
  onRowsChange: (updater: (rows: MiperEntrySnapshot[]) => MiperEntrySnapshot[]) => void
  entryVersions: Record<string, number>
  editable: boolean
  riskFactors: MiperWorkspace["riskFactors"]
  dictionaries: MiperWorkspace["dictionaries"]
  issuesByEntry: Map<string, CompletenessIssue[]>
  observedEntryIds: Set<string>
  changeByEntry: Map<string, EntryChange>
  canObserve: boolean
  onOpenEntry: (entryId: string) => void
  onStructureChanged: () => void
}

export function MatrixGrid(_props: MatrixGridProps) {
  return null
}
