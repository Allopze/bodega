"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ExportButton } from "@/components/ui/export-button"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { formatNumber, plural, unitName } from "@/lib/mantencion/format"
import type { AssignCandidate } from "@/lib/services/mantencion/schedule-assign"
import type { ScheduleEditorModel } from "@/lib/services/mantencion/schedules"
import { toast } from "@/lib/toast"
import { deleteScheduleAction, exportSchedulesAction } from "@/app/(app)/mantencion/pautas/actions"
import { discardScheduleDraftAction, publishScheduleAction } from "@/app/(app)/mantencion/pautas/[id]/actions"
import { AssignEquipmentDialog } from "./assign-equipment-dialog"
import { DRAFT_BAR_OFFSET, draftChangeCount, ScheduleDraftBar } from "./schedule-draft-bar"
import { ScheduleBrandRules } from "./schedule-brand-rules"
import { ScheduleEquipmentPanel } from "./schedule-equipment-panel"
import { ScheduleIntervalsCard } from "./schedule-intervals-card"
import { ScheduleMatrix } from "./schedule-matrix"
import { ScheduleNameCard } from "./schedule-name-card"
import { useScheduleEdit } from "./use-schedule-edit"

/**
 * Editor de una pauta (§10). Cada cambio se guarda al instante, pero como BORRADOR:
 * el teléfono, el panel y los equipos siguen viendo la versión publicada hasta que
 * se pulsa «Publicar versión N+1» (encabezado de la página, regla 5). Una barra
 * fija lista los cambios sin publicar y ofrece «Descartar cambios», que pide
 * confirmar porque pierde trabajo. «Asignar equipos» y el Excel también viven en
 * el encabezado, y «Eliminar pauta» al final, lejos de lo que se toca a diario.
 */
export function ScheduleEditor({ model, candidates, canExport }: { model: ScheduleEditorModel; candidates: AssignCandidate[]; canExport: boolean }) {
  const router = useRouter()
  const [assignOpen, setAssignOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [discardOpen, setDiscardOpen] = React.useState(false)
  const { pending, edit } = useScheduleEdit()
  const dirty = model.draft.dirty
  const changeCount = draftChangeCount(model.draft.changes)

  function publish() {
    edit(
      () => publishScheduleAction({ scheduleId: model.id }),
      (outcome) => toast.success(outcome.message ?? "Versión publicada."),
    )
  }

  function discard() {
    edit(
      () => discardScheduleDraftAction({ scheduleId: model.id }),
      (outcome) => { toast.success(outcome.message ?? "Cambios descartados."); setDiscardOpen(false) },
      () => setDiscardOpen(false),
    )
  }

  function remove() {
    edit(
      () => deleteScheduleAction({ scheduleId: model.id }),
      (outcome) => {
        toast.success(outcome.message ?? "Pauta eliminada.")
        setDeleteOpen(false)
        router.replace("/mantencion/pautas")
      },
      () => setDeleteOpen(false),
    )
  }

  const equipmentCount = model.equipment.total
  return (
    <PageContainer width="workbench">
      <PageHeader
        title={model.name}
        description={`Pauta en ${unitName(model.unit)} · versión ${formatNumber(model.version)} publicada${dirty ? ` · cambios sin publicar (${formatNumber(changeCount)})` : ""}`}
        breadcrumb={[{ label: "Control operacional", href: "/control-operacional" }, { label: "Pautas", href: "/mantencion/pautas" }, { label: model.name }]}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {canExport && <ExportButton action={exportSchedulesAction} filters={{ scheduleId: model.id }} label="Exportar a Excel" />}
            <Button size="sm" variant={dirty ? "secondary" : "primary"} onClick={() => setAssignOpen(true)}>Asignar equipos</Button>
            {dirty && <Button size="sm" loading={pending} onClick={publish}>Publicar versión {formatNumber(model.version + 1)}</Button>}
          </div>
        )}
      />
      <div className="flex flex-col gap-5">
        {dirty && <ScheduleDraftBar version={model.version} changes={model.draft.changes} pending={pending} onDiscard={() => setDiscardOpen(true)} />}
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <ScheduleNameCard scheduleId={model.id} name={model.name} origin={model.origin} />
          <ScheduleIntervalsCard scheduleId={model.id} unit={model.unit} intervals={model.intervals} equipmentCount={equipmentCount} />
        </div>
        <ScheduleMatrix scheduleId={model.id} unit={model.unit} intervals={model.intervals} groups={model.groups} headerTop={dirty ? DRAFT_BAR_OFFSET : "top-0"} />
        {model.brandRules.rows.length > 0 && (
          <ScheduleBrandRules scheduleId={model.id} brands={model.brandRules.brands} rows={model.brandRules.rows} />
        )}
        <ScheduleEquipmentPanel scheduleId={model.id} equipment={model.equipment} onAssign={() => setAssignOpen(true)} />
        <div>
          <Button variant="ghost-danger" onClick={() => setDeleteOpen(true)}>Eliminar pauta</Button>
        </div>
      </div>
      <AssignEquipmentDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        scheduleId={model.id}
        scheduleName={model.name}
        unit={model.unit}
        candidates={candidates}
      />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="¿Descartar los cambios sin publicar?"
        description={`La pauta vuelve a la versión ${formatNumber(model.version)}, tal como la ven el teléfono y los equipos. Se pierden ${plural(changeCount, "cambio", "cambios")}.`}
        confirmLabel="Descartar cambios"
        variant="destructive"
        loading={pending}
        onConfirm={discard}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`¿Eliminar la pauta «${model.name}»?`}
        description={`${equipmentCount > 0 ? `${plural(equipmentCount, "equipo quedará", "equipos quedarán")} sin pauta y no se les podrá registrar preventivas. ` : ""}Los registros ya firmados no cambian.`}
        confirmLabel="Eliminar pauta"
        variant="destructive"
        loading={pending}
        onConfirm={remove}
      />
    </PageContainer>
  )
}
