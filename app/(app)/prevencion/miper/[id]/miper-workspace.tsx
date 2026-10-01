"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Callout } from "@/components/ui/callout"
import { checkMiperCompleteness, issuesByEntry } from "@/lib/prevention/miper/completeness"
import { EMPTY_FILTERS, type GridFilters } from "@/lib/prevention/miper/grid-view"
import { CLASSIFICATION_CRITERIA, type RiskClassification } from "@/lib/prevention/miper/methodology"
import { changesByEntry, type EntryChange, type MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperHistoryEvent, MiperWorkspace } from "@/lib/services/miper/queries"
import { openMiperRoundAction } from "../actions"
import { AntecedentesForm } from "./antecedentes-form"
import { EntrySheet } from "./entry-sheet"
import { HistoryPanel } from "./history-panel"
import { MatrixGrid } from "./matrix-grid"
import { ProgramPanel } from "./program-panel"
import { ReviewPanel } from "./review-panel"
import { SummaryStrip } from "./summary-strip"
import { WorkflowBar } from "./workflow-bar"

const TABS = new Set(["antecedentes", "matriz", "programa", "revision", "historial"])

export function MiperWorkspaceView({ workspace, history, mode, userId }: { workspace: MiperWorkspace; history: MiperHistoryEvent[]; mode: WorkspaceMode; userId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = TABS.has(searchParams.get("tab") ?? "") ? searchParams.get("tab")! : "matriz"
  const openEntryId = searchParams.get("fila")
  // En revisión se muestra la FOTO enviada (lo que se decide); si no, lo vivo.
  const reviewing = mode.canReviewTechnical || mode.canApproveLegal
  const source = reviewing && workspace.openRound ? workspace.openRound.snapshot : workspace.snapshot
  const [rows, setRows] = useState<MiperEntrySnapshot[]>(source.entries)
  useEffect(() => { setRows(source.entries) }, [source])
  const liveSnapshot = useMemo(() => ({ header: source.header, entries: rows }), [source.header, rows])
  /**
   * El mismo conjunto que el servicio entrega al validador al enviar
   * (`programLinkedControlIds`): los controles del MIPER que ya tienen una
   * actividad del Programa de Trabajo. Sin él, la UI no cuenta el pendiente del
   * Intolerable y el bloqueo recién aparece cuando el servidor rechaza el envío
   * (H2-01 del informe): la regla vive en el servicio y la pantalla la refleja.
   * Depende de `workspace` —y no de `liveSnapshot`— porque el vínculo lo cambia
   * el panel del programa, que revalida la ruta y trae un `workspace` nuevo.
   */
  const linkedControlIds = useMemo(
    () => new Set(workspace.controlActionLinks.map((link) => link.controlId)),
    [workspace.controlActionLinks],
  )
  const issues = useMemo(
    () => checkMiperCompleteness(liveSnapshot, { linkedControlIds, requireProgramLink: true }),
    [liveSnapshot, linkedControlIds],
  )
  const diff = reviewing ? workspace.reviewDiff : workspace.pendingDiff
  const changes = useMemo<Map<string, EntryChange>>(() => (diff ? changesByEntry(diff) : new Map()), [diff])
  const openObservations = workspace.observations.filter((observation) => observation.status === "open").length
  const observedEntryIds = useMemo(() => new Set(workspace.observations.flatMap((observation) => (observation.entryId && observation.status !== "resolved" ? [observation.entryId] : []))), [workspace.observations])
  const intolerable = rows.filter((row) => row.classification === "intolerable").length
  const [filters, setFilters] = useState<GridFilters>(EMPTY_FILTERS)
  const entryIssues = useMemo(() => issuesByEntry(issues), [issues])

  useEffect(() => {
    if (reviewing && workspace.openRound && !workspace.openRound.openedAt) void openMiperRoundAction({ matrixId: workspace.matrix.id })
  }, [reviewing, workspace.openRound, workspace.matrix.id])

  const setParam = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

  /**
   * Abre la ficha de una fila. Va en UNA escritura de la URL —con la pestaña
   * incluida— porque dos `setParam` seguidos sobre el mismo `searchParams`
   * perderían el primero: es el mismo cuidado que exige el filtrado.
   */
  const openEntry = useCallback((entryId: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", "matriz")
    params.set("fila", entryId)
    router.replace(`?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

  /** Filtrar desde la franja siempre lleva a la matriz, que es lo que se filtra. */
  const filterFromStrip = (next: GridFilters) => {
    setFilters(next)
    if (tab !== "matriz") setParam("tab", null)
  }
  const toggleClassification = (cls: RiskClassification) => filterFromStrip({
    ...filters,
    classifications: filters.classifications.includes(cls) ? filters.classifications.filter((item) => item !== cls) : [...filters.classifications, cls],
  })

  const versionLabel = workspace.versions[0] ? `v${workspace.versions[0].versionNumber}` : "sin versión aprobada"
  return (
    <PageContainer width="full">
      <PageHeader
        title={`MIPER ${[workspace.matrix.worksiteName, workspace.matrix.period].filter(Boolean).join(" ")}`}
        description={workspace.label}
        breadcrumb={<Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "MIPER", href: "/prevencion/miper" }, { label: [workspace.matrix.worksiteName, workspace.matrix.period].filter(Boolean).join(" ") }]} />}
        actions={<WorkflowBar workspace={workspace} mode={mode} issues={issues} openObservations={openObservations} onOpenEntry={openEntry} />}
      />
      <div className="space-y-3">
        <SummaryStrip snapshot={liveSnapshot} authorName={workspace.openRound ? workspace.versions[0]?.elaboratedByName ?? null : null} submittedAt={workspace.openRound?.submittedAt ?? null} versionLabel={versionLabel}
          activeClassifications={filters.classifications} onToggleClassification={toggleClassification}
          uncontrolledActive={filters.controlled === "no"} onToggleUncontrolled={() => filterFromStrip({ ...filters, controlled: filters.controlled === "no" ? "all" : "no" })} />
        {reviewing && <Callout tone="info" title="Estás revisando la versión enviada">Los cambios que la prevencionista haga después del envío quedan para la ronda siguiente.</Callout>}
        {intolerable > 0 && (
          <Callout tone="danger" role="alert" title={`${intolerable} riesgo(s) Intolerable(s)`}>
            {CLASSIFICATION_CRITERIA.intolerable}
          </Callout>
        )}
        <Tabs value={tab} onValueChange={(value) => setParam("tab", value === "matriz" ? null : value)}>
          <TabsList>
            <TabsTrigger value="antecedentes">Antecedentes</TabsTrigger>
            <TabsTrigger value="matriz">Matriz ({rows.length})</TabsTrigger>
            <TabsTrigger value="programa">Programa</TabsTrigger>
            <TabsTrigger value="revision">Revisión{openObservations > 0 ? ` (${openObservations})` : ""}</TabsTrigger>
            <TabsTrigger value="historial">Historial</TabsTrigger>
          </TabsList>
          <TabsContent value="antecedentes"><AntecedentesForm workspace={workspace} editable={mode.canEdit && !reviewing} /></TabsContent>
          <TabsContent value="matriz">
            <MatrixGrid
              matrixId={workspace.matrix.id}
              rows={rows}
              onRowsChange={setRows}
              entryVersions={workspace.entryVersions}
              editable={mode.canEdit && !reviewing}
              riskFactors={workspace.riskFactors}
              dictionaries={workspace.dictionaries}
              issuesByEntry={entryIssues}
              observedEntryIds={observedEntryIds}
              changeByEntry={changes}
              canObserve={mode.canObserve}
              onOpenEntry={openEntry}
              onStructureChanged={() => router.refresh()}
              filters={filters}
              onFiltersChange={setFilters}
              hasBaseline={(reviewing ? workspace.reviewBaselineSnapshot : workspace.lastVersionSnapshot) !== null}
            />
          </TabsContent>
          <TabsContent value="programa">
            <ProgramPanel
              matrixId={workspace.matrix.id}
              mode={mode}
              userId={userId}
              users={workspace.responsibleOptions}
              onOpenRiskEntry={openEntry}
            />
          </TabsContent>
          <TabsContent value="revision"><ReviewPanel workspace={workspace} mode={mode} onOpenEntry={(entryId) => { setParam("fila", entryId) }} /></TabsContent>
          <TabsContent value="historial"><HistoryPanel workspace={workspace} history={history} /></TabsContent>
        </Tabs>
      </div>
      <EntrySheet
        workspace={workspace}
        entry={rows.find((row) => row.id === openEntryId) ?? null}
        baseline={reviewing ? workspace.reviewBaselineSnapshot : workspace.lastVersionSnapshot}
        change={openEntryId ? changes.get(openEntryId) ?? null : null}
        mode={mode}
        userId={userId}
        onClose={() => setParam("fila", null)}
        onChanged={() => router.refresh()}
      />
    </PageContainer>
  )
}
