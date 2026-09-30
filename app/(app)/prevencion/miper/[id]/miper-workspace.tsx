"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Callout } from "@/components/ui/callout"
import { checkMiperCompleteness, issuesByEntry } from "@/lib/prevention/miper/completeness"
import { CLASSIFICATION_CRITERIA } from "@/lib/prevention/miper/methodology"
import { changesByEntry, type EntryChange, type MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperHistoryEvent, MiperWorkspace } from "@/lib/services/miper/queries"
import { openMiperRoundAction } from "../actions"
import { AntecedentesForm } from "./antecedentes-form"
import { EntrySheet } from "./entry-sheet"
import { HistoryPanel } from "./history-panel"
import { MatrixGrid } from "./matrix-grid"
import { ReviewPanel } from "./review-panel"
import { SummaryStrip } from "./summary-strip"
import { WorkflowBar } from "./workflow-bar"

const TABS = new Set(["antecedentes", "matriz", "revision", "historial"])

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
  const issues = useMemo(() => checkMiperCompleteness(liveSnapshot), [liveSnapshot])
  const diff = reviewing ? workspace.reviewDiff : workspace.pendingDiff
  const changes = useMemo<Map<string, EntryChange>>(() => (diff ? changesByEntry(diff) : new Map()), [diff])
  const openObservations = workspace.observations.filter((observation) => observation.status === "open").length
  const observedEntryIds = useMemo(() => new Set(workspace.observations.flatMap((observation) => (observation.entryId && observation.status !== "resolved" ? [observation.entryId] : []))), [workspace.observations])
  const intolerable = rows.filter((row) => row.classification === "intolerable").length

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
        <SummaryStrip snapshot={liveSnapshot} authorName={workspace.openRound ? workspace.versions[0]?.elaboratedByName ?? null : null} submittedAt={workspace.openRound?.submittedAt ?? null} versionLabel={versionLabel} />
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
              issuesByEntry={issuesByEntry(issues)}
              observedEntryIds={observedEntryIds}
              changeByEntry={changes}
              canObserve={mode.canObserve}
              onOpenEntry={openEntry}
              onStructureChanged={() => router.refresh()}
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
