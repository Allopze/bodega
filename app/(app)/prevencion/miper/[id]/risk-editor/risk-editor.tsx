"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EDITOR_STEPS, EDITOR_STEP_LABEL, errorCountByStep, firstStepWithErrors, isEditorStep, nextPendingId, siblingsInTask, type EditorStep } from "@/lib/prevention/miper/entry-navigation"
import { taskKeyOf } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { hrefToEntry, hrefToMatrix, hrefToTask } from "@/lib/prevention/miper/workspace-url"
import { toast } from "@/lib/toast"
import { deleteMiperEntryAction, duplicateMiperEntryAction } from "../../actions"
import { navigateWorkspace, WorkspaceLink } from "../workspace-nav"
import { EvaluationStep } from "./evaluation-step"
import { FollowUpStep } from "./follow-up-step"
import { IdentificationStep } from "./identification-step"
import { MeasuresStep } from "./measures-step"
import { RiskAside } from "./risk-aside"
import { SaveStatusIndicator } from "./save-status"
import type { RiskEditorProps } from "./types"

export type { RiskEditorData, RiskEditorProps } from "./types"

/** Si el `fila` no está, se recarga una vez y, pasado este tiempo, se avisa. */
const MISSING_AFTER_MS = 2500

/**
 * Editor del riesgo a página completa (spec §5.4). El workspace lo monta con
 * `key={entryId}`: así el paso inicial —el primero con errores— se calcula una
 * vez por riesgo y no salta de paso cuando el usuario corrige el último error.
 */
export function RiskEditor(props: RiskEditorProps) {
  const { data, rows, entryId, step, issuesByEntry, incomplete, matching, editable, mode, change, baselineEntry, autosave } = props
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const entry = rows.find((row) => row.id === entryId) ?? null
  const [fallbackStep] = useState<EditorStep>(() => firstStepWithErrors(issuesByEntry.get(entryId) ?? []))
  const [missing, setMissing] = useState(false)
  const refreshed = useRef(false)

  useEffect(() => {
    if (entry) return
    if (!refreshed.current) { refreshed.current = true; router.refresh() }
    const timer = setTimeout(() => setMissing(true), MISSING_AFTER_MS)
    return () => clearTimeout(timer)
  }, [entry, router])

  if (!entry) {
    if (!missing) return <div aria-busy="true" className="space-y-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-48 w-full" /></div>
    return <EmptyState title="Este riesgo ya no existe" description="Puede haberse eliminado o ser de otra versión de la MIPER." action={<Button asChild><WorkspaceLink href={hrefToMatrix(pathname, params)}>Volver a la matriz</WorkspaceLink></Button>} />
  }

  const issues = issuesByEntry.get(entry.id) ?? []
  const current: EditorStep = isEditorStep(step) ? step : fallbackStep
  const counts = errorCountByStep(issues)
  const siblings = siblingsInTask(rows, entry.id)
  const nextPending = nextPendingId(rows, entry.id, incomplete, matching)
  const taskHref = hrefToTask(pathname, params, taskKeyOf(entry))
  // Borrar el único riesgo de la tarea deja la tarea vacía: se vuelve a la matriz, no a «Esta tarea ya no existe».
  const afterDeleteHref = siblings?.total === 1 ? hrefToMatrix(pathname, params) : taskHref
  // Cambiar de paso es estado de la vista: replace y sin ida al servidor (las filas ya están aquí).
  const goToStep = (next: string) => navigateWorkspace(hrefToEntry(pathname, params, entry.id, next as EditorStep), "replace")
  const stepProps = { entry, data, editable, autosave, issues }
  // El de ESTE riesgo: un rechazo en otro riesgo no se anuncia aquí.
  const saveStatus = autosave.statusOf(entry.id)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <WorkspaceLink href={taskHref} className="text-sm font-medium text-[var(--color-primary-ink)] hover:underline">‹ Volver a la tarea</WorkspaceLink>
        <div className="flex items-center gap-2">
          <SaveStatusIndicator status={saveStatus} editable={editable} />
          {editable && saveStatus.state === "error" && <Button size="sm" variant="secondary" onClick={() => { autosave.clearErrors(entry.id); router.refresh() }}>Recargar riesgo</Button>}
        </div>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">{entry.hazard ?? "Peligro sin describir"}</h2>
          <p className="text-sm text-[var(--color-text-subtle)]">Riesgo #{entry.rowNumber} · {entry.task ?? "Sin tarea"}{entry.position ? ` · ${entry.position}` : ""}</p>
        </div>
        {editable && <EntryMenu matrixId={data.matrixId} entry={entry} version={autosave.versionOf(entry.id)} afterDeleteHref={afterDeleteHref} entryHref={(id) => hrefToEntry(pathname, params, id)} />}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <Tabs value={current} onValueChange={goToStep} className="min-w-0">
          <TabsList aria-label="Pasos del riesgo">
            {EDITOR_STEPS.map((value, index) => (
              <TabsTrigger key={value} value={value}>
                {index + 1}. {EDITOR_STEP_LABEL[value]}{value === "medidas" ? ` (${entry.controls.length})` : ""}
                {counts[value] > 0
                  ? <><span className="sr-only"> · </span><span className="ml-1.5 rounded-full bg-[var(--color-warning-tint)] px-1.5 tabular-nums text-[var(--color-warning-ink)]">{counts[value]}<span className="sr-only"> pendientes</span></span></>
                  : <span className="ml-1.5 text-[var(--color-success-ink)]"><span aria-hidden>✓</span><span className="sr-only"> · completo</span></span>}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="identificacion"><IdentificationStep {...stepProps} /></TabsContent>
          <TabsContent value="evaluacion"><EvaluationStep {...stepProps} /></TabsContent>
          <TabsContent value="medidas"><MeasuresStep {...stepProps} /></TabsContent>
          <TabsContent value="seguimiento"><FollowUpStep issues={issues} entry={entry} data={data} mode={mode} change={change} baselineEntry={baselineEntry} /></TabsContent>
        </Tabs>
        <RiskAside entry={entry} issues={issues} onGoToStep={goToStep} canObserve={mode.canObserve} />
      </div>
      <nav aria-label="Recorrer riesgos" className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] py-3">
        <div className="flex items-center gap-2">
          {siblings?.previousId ? <Button asChild size="sm" variant="secondary"><WorkspaceLink href={hrefToEntry(pathname, params, siblings.previousId)}>‹ Anterior</WorkspaceLink></Button> : <Button size="sm" variant="secondary" disabled>‹ Anterior</Button>}
          <span className="text-xs tabular-nums text-[var(--color-text-subtle)]">{siblings?.position} de {siblings?.total} en la tarea</span>
          {siblings?.nextId ? <Button asChild size="sm" variant="secondary"><WorkspaceLink href={hrefToEntry(pathname, params, siblings.nextId)}>Siguiente ›</WorkspaceLink></Button> : <Button size="sm" variant="secondary" disabled>Siguiente ›</Button>}
        </div>
        {nextPending
          ? <Button asChild size="sm"><WorkspaceLink href={hrefToEntry(pathname, params, nextPending)}>Siguiente pendiente</WorkspaceLink></Button>
          : <p className="text-sm text-[var(--color-success-ink)]">No quedan otros riesgos pendientes{matching ? " en este filtro" : ""}.</p>}
      </nav>
    </div>
  )
}

function EntryMenu({ matrixId, entry, version, afterDeleteHref, entryHref }: { matrixId: string; entry: MiperEntrySnapshot; version: number | undefined; afterDeleteHref: string; entryHref: (id: string) => string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  async function duplicate() {
    setBusy(true)
    let state
    try { state = await duplicateMiperEntryAction({ matrixId, entryId: entry.id }) } catch { toast.error("No se pudo duplicar el riesgo."); return } finally { setBusy(false) }
    if (!state.ok) { toast.error(state.message ?? "No se pudo duplicar el riesgo."); return }
    toast.success(`Riesgo #${entry.rowNumber} duplicado.`)
    const id = (state.data as { id?: unknown } | undefined)?.id
    if (typeof id === "string") router.push(entryHref(id))
    else router.refresh()
  }
  async function remove() {
    setBusy(true)
    let state
    try { state = await deleteMiperEntryAction({ matrixId, entryId: entry.id, expectedVersion: version }) } catch { toast.error("No se pudo eliminar el riesgo."); return } finally { setBusy(false); setConfirming(false) }
    if (!state.ok) { toast.error(state.message ?? "No se pudo eliminar el riesgo."); return }
    toast.success(`Riesgo #${entry.rowNumber} eliminado.`)
    // Con ida al servidor: la matriz o la tarea tienen que llegar sin el riesgo borrado.
    router.replace(afterDeleteHref)
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" variant="secondary" disabled={busy} aria-label={`Más acciones del riesgo ${entry.rowNumber}`}>Más</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => { void duplicate() }}>Duplicar riesgo</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirming(true)}>Eliminar riesgo</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={`Eliminar el riesgo #${entry.rowNumber}`}
        description="Se elimina el riesgo con sus medidas. Si tiene marcadores en el mapa de riesgos o medidas vinculadas al PDTP, el servidor rechaza el borrado."
        confirmLabel="Eliminar riesgo" variant="destructive" loading={busy} onConfirm={() => { void remove() }} />
    </>
  )
}
