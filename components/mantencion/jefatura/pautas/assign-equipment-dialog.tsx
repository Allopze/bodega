"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { unitName } from "@/lib/mantencion/format"
import { nameKey } from "@/lib/mantencion/normalize"
import type { MantUnit } from "@/lib/mantencion/types"
import type { AssignCandidate } from "@/lib/services/mantencion/schedule-assign"
import { toast } from "@/lib/toast"
import { assignEquipmentAction } from "@/app/(app)/mantencion/pautas/[id]/actions"
import { AssignEquipmentList } from "./assign-equipment-list"
import { assignmentSummary, assignmentSummaryText } from "./assign-summary"
import { useScheduleEdit } from "./use-schedule-edit"

/**
 * «Asignar equipos» (modal). Lista SÓLO equipos activos que se miden en la
 * unidad de la pauta, agrupados por faena, con filtros. Cada fila dice qué le
 * pasaría: «Se agrega», «Cambia desde «X»» o «Quedará sin pauta»; el pie resume
 * el total. Este buscador es propio del modal: la búsqueda de la barra superior
 * filtra la página, no el contenido de un diálogo. El servidor recalcula los
 * cambios al guardar, no confía en el resumen de la pantalla.
 */
export function AssignEquipmentDialog({ open, onOpenChange, scheduleId, scheduleName, unit, candidates }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scheduleId: string
  scheduleName: string
  unit: MantUnit
  candidates: AssignCandidate[]
}) {
  const initial = React.useMemo(() => new Set(candidates.filter((item) => item.scheduleId === scheduleId).map((item) => item.vehicleId)), [candidates, scheduleId])
  const [selected, setSelected] = React.useState<Set<string>>(initial)
  const [query, setQuery] = React.useState("")
  const [worksiteId, setWorksiteId] = React.useState("")
  const [typeName, setTypeName] = React.useState("")
  const { pending, edit } = useScheduleEdit()

  // Cada vez que se abre parte del estado real; no hereda marcas de una apertura anterior.
  React.useEffect(() => {
    if (open) { setSelected(new Set(initial)); setQuery(""); setWorksiteId(""); setTypeName("") }
  }, [open, initial])

  const worksites = React.useMemo(() => [...new Map(candidates.map((item) => [item.worksiteId, item.worksiteName])).entries()].map(([value, label]) => ({ value, label })), [candidates])
  const types = React.useMemo(() => [...new Set(candidates.map((item) => item.typeName))].sort((a, b) => a.localeCompare(b, "es")).map((value) => ({ value, label: value })), [candidates])
  const visible = React.useMemo(() => {
    const needle = nameKey(query)
    return candidates.filter((item) =>
      (!worksiteId || item.worksiteId === worksiteId)
      && (!typeName || item.typeName === typeName)
      && (!needle || nameKey(`${item.code} ${item.plate} ${item.brandName}`).includes(needle)))
  }, [candidates, query, worksiteId, typeName])

  const summary = assignmentSummary(candidates, selected, scheduleId)

  function setMany(ids: string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      for (const id of ids) { if (on) next.add(id); else next.delete(id) }
      return next
    })
  }

  function save() {
    edit(
      () => assignEquipmentAction({ scheduleId, vehicleIds: [...selected] }),
      (outcome) => { toast.success(outcome.message ?? "Asignación guardada."); onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(90dvh,48rem)] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="mb-0 px-6 pt-6">
          <DialogTitle>Asignar equipos a «{scheduleName}»</DialogTitle>
          <DialogDescription>
            Solo equipos activos que se miden en {unitName(unit)}. Los marcados quedan con esta pauta; si desmarcas uno que la tenía, queda sin pauta.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-2 px-6 pt-3">
          <Input
            type="search" aria-label="Buscar por código, patente o marca" placeholder="Código, patente o marca" value={query}
            className="h-11 w-full text-xs sm:h-8 sm:w-52" onChange={(event) => setQuery(event.target.value)}
          />
          <OptionSelect aria-label="Filtrar por faena" className="h-11 w-full text-xs sm:h-8 sm:w-44" emptyLabel="Todas las faenas" options={worksites} value={worksiteId} onValueChange={setWorksiteId} />
          <OptionSelect aria-label="Filtrar por tipo de equipo" className="h-11 w-full text-xs sm:h-8 sm:w-44" emptyLabel="Todos los tipos" options={types} value={typeName} onValueChange={setTypeName} />
        </div>
        <div className="flex gap-4 px-6 pt-2 text-sm">
          <button type="button" className="font-medium text-[var(--color-primary-ink)] hover:underline" onClick={() => setMany(visible.map((item) => item.vehicleId), true)}>Marcar los filtrados</button>
          <button type="button" className="font-medium text-[var(--color-primary-ink)] hover:underline" onClick={() => setMany(visible.map((item) => item.vehicleId), false)}>Desmarcar los filtrados</button>
        </div>
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto border-y border-[var(--color-border)] px-6 py-2">
          <AssignEquipmentList candidates={visible} selected={selected} scheduleId={scheduleId} onToggle={(ids, on) => setMany(ids, on)} />
        </div>
        <DialogFooter className="mt-0 items-center gap-3 px-6 py-4">
          <p className="mr-auto text-sm text-[var(--color-text)]" aria-live="polite">{assignmentSummaryText(summary)}</p>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
          <Button onClick={save} loading={pending}>Guardar asignación</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
