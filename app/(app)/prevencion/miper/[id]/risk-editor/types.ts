import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { EditorStep } from "@/lib/prevention/miper/entry-navigation"
import type { EntryChange, MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperObservationView, MiperWorkspace } from "@/lib/services/miper/queries"
import type { EntryAutosave } from "../use-entry-autosave"

/** Lo que el editor necesita del espacio de trabajo: un subconjunto, para poder probarlo sin un `MiperWorkspace` completo. */
export type RiskEditorData = {
  matrixId: string
  worksiteName?: string
  published: boolean
  riskFactors: MiperWorkspace["riskFactors"]
  dictionaries: MiperWorkspace["dictionaries"]
  responsibleOptions: MiperWorkspace["responsibleOptions"]
  controlVersions: Record<string, number>
  controlActionLinks: MiperWorkspace["controlActionLinks"]
  observations: readonly MiperObservationView[]
}

export type RiskEditorProps = {
  data: RiskEditorData
  rows: MiperEntrySnapshot[]
  entryId: string
  step: EditorStep | null
  issuesByEntry: Map<string, CompletenessIssue[]>
  incomplete: ReadonlySet<string>
  /** Conjunto filtrado: «Siguiente pendiente» recorre sólo esto. `null` = sin filtros. */
  matching: ReadonlySet<string> | null
  editable: boolean
  mode: WorkspaceMode
  change: EntryChange | null
  baselineEntry: MiperEntrySnapshot | null
  autosave: EntryAutosave
}

export type StepProps = { entry: MiperEntrySnapshot; data: RiskEditorData; editable: boolean; autosave: EntryAutosave; issues: CompletenessIssue[] }
