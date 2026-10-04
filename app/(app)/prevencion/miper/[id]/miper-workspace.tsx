"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { checkMiperCompleteness, issuesByEntry } from "@/lib/prevention/miper/completeness"
import type { EditorStep } from "@/lib/prevention/miper/entry-navigation"
import { filterRows } from "@/lib/prevention/miper/grid-view"
import { hasEntryFilters, MATRIX_FILTER_KEYS, parseMatrixFilters } from "@/lib/prevention/miper/matrix-filters"
import { buildMatrixTree, findTask } from "@/lib/prevention/miper/matrix-tree"
import { CLASSIFICATION_CRITERIA } from "@/lib/prevention/miper/methodology"
import { nextStepFor, nextStepInView, type NextStepAction } from "@/lib/prevention/miper/next-step"
import { changesByEntry, type EntryChange } from "@/lib/prevention/miper/snapshot"
import { hrefToEntry, hrefToMatrixPresentation, hrefToFicha, hrefToMatrixOnly, hrefToTab, readWorkspaceView, type WorkspaceTab } from "@/lib/prevention/miper/workspace-url"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { ProgramWorkspace } from "@/lib/services/miper/program-queries"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { countOf } from "@/lib/utils"
import { openMiperRoundAction } from "../actions"
import { FichaSheet } from "./ficha-sheet"
import { HistoryPanel, type HistoryPanelProps } from "./history-panel"
import { MatrixFiltersBar, useMatrixFilterNavigation } from "./matrix-filters-bar"
import { MatrixView } from "./matrix-view"
import { NewTaskDialog } from "./new-task-dialog"
import { NextStepCard } from "./next-step-card"
import { ProgramPageActions, ProgramPanel } from "./program-panel"
import { ReviewPanel } from "./review-panel"
import { ResumenPanel } from "./resumen-panel"
import { RiskEditor } from "./risk-editor/risk-editor"
import { SummaryStrip } from "./summary-strip"
import { TaskView } from "./task-view"
import { useEntryAutosave } from "./use-entry-autosave"
import { useRowsFromSource } from "./use-rows-from-source"
import type { BulkContext } from "./bulk-shared"
import { WorkflowBar } from "./workflow-bar"
import { WorksiteSwitcher } from "./worksite-switcher"
import { navigateWorkspace, WorkspaceLink } from "./workspace-nav"

/**
 * Espacio de trabajo de la MIPER (spec 2026-10-02 §3–§5): matriz por actividad
 * y tarea → vista de la tarea → editor del riesgo, todo en la URL
 * (`fila` > `actividad` > `tarea` > `tab`). Navegar entre esas vistas no va al servidor
 * (`workspace-nav.tsx`): las filas ya están aquí y un fetch RSC por clic las
 * reiniciaba. Sólo crear, duplicar o borrar riesgos pide datos nuevos.
 */
export function MiperWorkspaceView({ workspace, history, mode, userId, program }: {
  workspace: MiperWorkspace; history: HistoryPanelProps["history"]; mode: WorkspaceMode; userId: string
  /**
   * El Programa de Trabajo, cargado por `page.tsx` junto con la matriz. Se lee
   * SIEMPRE de props, nunca se copia a un `useState`: Atrás restaura payloads
   * de renders anteriores y una copia quedaría vieja.
   */
  program: ProgramWorkspace
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view = readWorkspaceView(searchParams)
  // En revisión se muestra la FOTO enviada (lo que se decide); si no, lo vivo.
  const reviewing = mode.canReviewTechnical || mode.canApproveLegal
  const source = reviewing && workspace.openRound ? workspace.openRound.snapshot : workspace.snapshot
  /* La versión que el cliente conoce de cada fila la lleva el guardado
   * (`useEntryAutosave`), que se arma más abajo porque necesita `setRows`. Este
   * puente la deja leer a `useRowsFromSource` cuando llega una foto: una foto
   * atrasada (la que Next restaura al volver «atrás») no pisa lo ya guardado. */
  const knownVersionOf = useRef<(entryId: string) => number | undefined>(() => undefined)
  const versionOf = useCallback((entryId: string) => knownVersionOf.current(entryId), [])
  // Se resincroniza en el mismo render en que llega una foto nueva (no en un efecto): así la fila recién creada ya está cuando el editor se monta.
  const [rows, setRows] = useRowsFromSource(source, { serverVersions: workspace.entryVersions, versionOf })
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
  // Contra qué se compara: la foto de la ronda anterior (en revisión) o la última versión sellada.
  const baseline = reviewing ? workspace.reviewBaselineSnapshot : workspace.lastVersionSnapshot
  const diff = reviewing ? workspace.reviewDiff : workspace.pendingDiff
  // Sin línea base (un borrador que nunca se aprobó) todo sería «Nueva» y cada
  // actividad diría «N modificado(s)»: la marca no informa y compite con
  // «N pendientes» (QA Fase A, UX 2). Sin con qué comparar, no hay marcas.
  const changes = useMemo<Map<string, EntryChange>>(() => (baseline && diff ? changesByEntry(diff) : new Map()), [baseline, diff])
  const openObservations = workspace.observations.filter((observation) => observation.status === "open").length
  const observedEntryIds = useMemo(() => new Set(workspace.observations.flatMap((observation) => (observation.entryId && observation.status !== "resolved" ? [observation.entryId] : []))), [workspace.observations])
  const intolerable = rows.filter((row) => row.classification === "intolerable").length
  const entryIssues = useMemo(() => issuesByEntry(issues), [issues])

  useEffect(() => {
    if (reviewing && workspace.openRound && !workspace.openRound.openedAt) void openMiperRoundAction({ matrixId: workspace.matrix.id })
  }, [reviewing, workspace.openRound, workspace.matrix.id])

  // Filtros de la matriz en la URL. Un `?factor=` que no es de esta matriz se
  // trata como «Todos» (igual que la barra): ni filtra ni deja la matriz vacía.
  const filters = useMemo(() => {
    const parsed = parseMatrixFilters(searchParams)
    return parsed.factorId !== "all" && !workspace.riskFactors.some((factor) => factor.id === parsed.factorId) ? { ...parsed, factorId: "all" } : parsed
  }, [searchParams, workspace.riskFactors])
  const filtered = hasEntryFilters(filters)
  const presentation = searchParams.get("vista") === "estructura" ? "estructura" : searchParams.get("vista") === "resultados" || filtered ? "resultados" : "estructura"
  const { setFilter, setFilters } = useMatrixFilterNavigation()
  // `serverRows` con identidad estable entre fotos: `source.entries`, nunca un `.map` armado aquí.
  const autosave = useEntryAutosave({ matrixId: workspace.matrix.id, entryVersions: workspace.entryVersions, setRows, riskFactors: workspace.riskFactors, serverRows: source.entries })
  useEffect(() => { knownVersionOf.current = autosave.versionOf }, [autosave.versionOf])
  const editable = mode.canEdit && !reviewing
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  // Acciones masivas (Fase D): sólo quien edita; sin esto no hay «Seleccionar».
  const bulk: BulkContext | undefined = editable
    ? { matrixId: workspace.matrix.id, sync: autosave, setRows, riskFactors: workspace.riskFactors, responsibleOptions: workspace.responsibleOptions, measureSuggestions: workspace.dictionaries.measures, dictionaries: workspace.dictionaries, controlVersions: workspace.controlVersions }
    : undefined

  const incomplete = useMemo(() => new Set([...entryIssues].filter(([, list]) => list.some((issue) => issue.severity === "error")).map(([entryId]) => entryId)), [entryIssues])
  const modified = useMemo(() => new Set([...changes.values()].filter((change) => change.kind !== "removed").map((change) => change.entryId)), [changes])
  const matching = useMemo(() => (filtered ? new Set(filterRows(rows, filters, { observed: observedEntryIds, modified, incomplete }).map((row) => row.id)) : null), [filtered, rows, filters, observedEntryIds, modified, incomplete])
  const fullTree = useMemo(() => buildMatrixTree(rows, { incomplete, observed: observedEntryIds, modified, matching: null }), [rows, incomplete, observedEntryIds, modified])
  const tree = useMemo(() => (matching ? buildMatrixTree(rows, { incomplete, observed: observedEntryIds, modified, matching }) : fullTree), [matching, fullTree, rows, incomplete, observedEntryIds, modified])
  const task = view.taskKey ? findTask(fullTree, view.taskKey) : null

  const versionLabel = workspace.versions[0] ? `v${workspace.versions[0].versionNumber}` : "sin versión aprobada"
  // «Elaboró» (Fase B): quien envió la ronda abierta o, sin ronda, quien elaboró la última versión aprobada.
  // Con ronda abierta SÓLO su remitente, aunque falte el nombre: el de la versión anterior sería otra persona.
  const authorName = workspace.openRound ? workspace.openRound.submittedByName : workspace.versions[0]?.elaboratedByName ?? null
  const nextStep = nextStepFor({
    mode, status: workspace.matrix.status, reviewState: workspace.matrix.reviewState, hasOpenRound: Boolean(workspace.openRound),
    hasPendingChanges: workspace.pendingDiff.hasChanges, versionLabel, issues, openObservations, rows,
  })
  const hrefFor = (action: NextStepAction) =>
    action.kind === "ficha" ? hrefToFicha(pathname, searchParams, true)
      : action.kind === "riesgo" ? hrefToEntry(pathname, searchParams, action.entryId)
      : action.kind === "tab" ? hrefToTab(pathname, searchParams, action.tab)
      : hrefToMatrixOnly(pathname, searchParams, { completitud: action.completitud })
  const openFicha = () => navigateWorkspace(hrefToFicha(pathname, searchParams, true), "replace")
  const closeFicha = () => navigateWorkspace(hrefToFicha(pathname, searchParams, false), "replace")
  const openEntry = (entryId: string, step?: EditorStep) => navigateWorkspace(hrefToEntry(pathname, searchParams, entryId, step), "push")
  const atRoot = !view.taskKey && !view.entryId
  const activeIntolerable = view.entryId !== null && rows.some((row) => row.id === view.entryId && row.classification === "intolerable")
  const showIntolerable = intolerable > 0 && (activeIntolerable || (atRoot && ["resumen", "matriz", "revision"].includes(view.tab)))
  const step = nextStepInView(nextStep, { atRoot, tab: view.tab })
  const worksiteLabel = [workspace.matrix.worksiteName, workspace.matrix.period].filter(Boolean).join(" ")

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={`Matriz de riesgos · ${worksiteLabel}`}
        description={view.entryId ? workspace.label : `${workspace.label} · ${view.tab === "programa" ? "Plan de medidas · Programa de Trabajo RE-04.1" : view.tab === "revision" ? "Revisa los pendientes y las decisiones del documento" : view.tab === "historial" ? "Versiones y cambios del documento" : "MIPER · RE-04"}`}
        breadcrumb={<Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "MIPER", href: "/prevencion/miper" }, { label: worksiteLabel }]} />}
        actions={view.entryId ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="secondary"><WorkspaceLink href={hrefToTab(pathname, searchParams, "matriz")} restoreScroll>Volver al documento</WorkspaceLink></Button>
            <Button variant="secondary" onClick={openFicha}>Ficha del documento</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <WorksiteSwitcher currentWorksiteId={workspace.matrix.worksiteId} />
            {view.tab === "programa" && !view.activityId && <ProgramPageActions matrixId={workspace.matrix.id} mode={mode} users={workspace.responsibleOptions} program={program} />}
            {editable && atRoot && (view.tab === "matriz" || view.tab === "resumen") && <Button variant="secondary" onClick={() => setNewTaskOpen(true)}>Nueva tarea</Button>}
            <WorkflowBar workspace={workspace} mode={mode} issues={issues} openObservations={openObservations} onOpenEntry={openEntry} onOpenFicha={openFicha} />
          </div>
        )}
      />
      <div className="space-y-3">
        {(!view.entryId || step?.scope === "everywhere") && <NextStepCard step={step} hrefFor={hrefFor} />}
        {reviewing && !view.entryId && view.tab !== "revision" && <Callout tone="info" title="Estás revisando la versión enviada">Los cambios que la prevencionista haga después del envío quedan para la ronda siguiente.</Callout>}
        {showIntolerable && (
          <Callout tone="danger" role="alert" title={activeIntolerable ? "Riesgo Intolerable" : countOf(intolerable, "riesgo Intolerable", "riesgos Intolerables")}>
            {CLASSIFICATION_CRITERIA.intolerable}
          </Callout>
        )}
        <Tabs value={view.tab} onValueChange={(value) => navigateWorkspace(hrefToTab(pathname, searchParams, value as WorkspaceTab), "replace")}>
          {!view.entryId && <TabsList>
            <TabsTrigger value="resumen">Inicio</TabsTrigger>
            <TabsTrigger value="matriz">Riesgos</TabsTrigger>
            <TabsTrigger value="programa">Plan de medidas</TabsTrigger>
            <TabsTrigger value="revision">Revisión{openObservations > 0 ? ` (${openObservations})` : ""}</TabsTrigger>
            <TabsTrigger value="historial">Historial</TabsTrigger>
          </TabsList>}
          <TabsContent value="resumen">
            <ResumenPanel matrixId={workspace.matrix.id} rows={rows} tree={fullTree} incomplete={incomplete} programProgress={program.progress}
              editable={editable} onNewTask={() => setNewTaskOpen(true)} />
          </TabsContent>
          <TabsContent value="matriz" className="space-y-3">
            {view.entryId ? (
              <RiskEditor key={view.entryId} entryId={view.entryId} step={view.step} rows={rows} issuesByEntry={entryIssues} incomplete={incomplete} matching={matching}
                editable={editable} mode={mode} autosave={autosave} change={changes.get(view.entryId) ?? null}
                baselineEntry={baseline?.entries.find((entry) => entry.id === view.entryId) ?? null}
                data={{ worksiteName: workspace.matrix.worksiteName, matrixId: workspace.matrix.id, published: workspace.matrix.status === "published", riskFactors: workspace.riskFactors, dictionaries: workspace.dictionaries, responsibleOptions: workspace.responsibleOptions, controlVersions: workspace.controlVersions, controlActionLinks: workspace.controlActionLinks, observations: workspace.observations }} />
            ) : view.taskKey ? (
              task
                ? <TaskView key={task.key} matrixId={workspace.matrix.id} task={task} editable={editable} incomplete={incomplete} observed={observedEntryIds} changes={changes} issuesByEntry={entryIssues} bulk={bulk} />
                : <EmptyState title="Esta tarea ya no existe" description="Puede que sus riesgos se hayan movido o eliminado." action={<Button asChild><WorkspaceLink href={hrefToTab(pathname, searchParams, "matriz")} restoreScroll>Volver a la matriz</WorkspaceLink></Button>} />
            ) : (
              <>
                <SummaryStrip snapshot={liveSnapshot} authorName={authorName} submittedAt={workspace.openRound?.submittedAt ?? null} versionLabel={versionLabel}
                  taskCount={fullTree.reduce((sum, activity) => sum + activity.tasks.length, 0)} completeCount={rows.length - incomplete.size}
                  pendingActive={filters.onlyIncomplete}
                  onTogglePending={() => setFilter("completitud", filters.onlyIncomplete ? null : "pendientes")} />
                <MatrixView presentation={presentation} onPresentationChange={(next) => navigateWorkspace(hrefToMatrixPresentation(pathname, searchParams, next), "replace")} matrixId={workspace.matrix.id} tree={tree} filtered={filtered} editable={editable} incomplete={incomplete} observed={observedEntryIds} changes={changes} issuesByEntry={entryIssues} bulk={bulk}
                  onNewTask={() => setNewTaskOpen(true)}
                  onClearFilters={() => setFilters(Object.fromEntries(MATRIX_FILTER_KEYS.map((key) => [key, null])))}
                  toolbar={({ collapsedAll, toggleAll, filtered: isFiltered }) => (
                    <MatrixFiltersBar filters={filters} riskFactors={workspace.riskFactors} hasBaseline={baseline !== null} collapsedAll={collapsedAll} onToggleAll={toggleAll} filtered={isFiltered} results={presentation === "resultados"} />
                  )} />
              </>
            )}
          </TabsContent>
          <TabsContent value="programa"><ProgramPanel matrixId={workspace.matrix.id} mode={mode} userId={userId} users={workspace.responsibleOptions} program={program} rows={rows} header={source.header} activityId={view.activityId} /></TabsContent>
          <TabsContent value="revision"><ReviewPanel workspace={workspace} mode={mode} onOpenEntry={openEntry} issues={issues} onOpenFicha={openFicha} rows={rows} observed={observedEntryIds} modified={modified} hasBaseline={baseline !== null} /></TabsContent>
          <TabsContent value="historial"><HistoryPanel workspace={workspace} history={history} /></TabsContent>
        </Tabs>
      </div>
      <FichaSheet open={view.ficha} onClose={closeFicha} workspace={workspace} editable={editable} />
      <NewTaskDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} matrixId={workspace.matrix.id} rows={rows} dictionaries={workspace.dictionaries} />
    </PageContainer>
  )
}
