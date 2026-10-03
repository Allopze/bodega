"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import type { ProgramScheduleKind } from "@/lib/prevention/miper/schedule"
import type { ProgramActionView } from "@/lib/services/miper/program-queries"
import { todayInChile } from "@/lib/utils"
import { retireProgramActionAction, saveProgramActionAction } from "../actions"

/** Frecuencia de la actividad (§7.4). El enum nunca se muestra crudo. */
export const SCHEDULE_KIND_LABEL: Record<ProgramScheduleKind, string> = {
  once: "Una vez",
  monthly: "Mensual",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
}

export const PROGRAM_SCHEDULE_OPTIONS = (Object.keys(SCHEDULE_KIND_LABEL) as ProgramScheduleKind[])
  .map((kind) => ({ value: kind, label: SCHEDULE_KIND_LABEL[kind] }))

const text = (value: FormDataEntryValue | null) => {
  const trimmed = String(value ?? "").trim()
  return trimmed === "" ? null : trimmed
}

/**
 * Alta y edición de una actividad del Programa de Trabajo RE-04.1 (§7.2).
 *
 * La fecha programada es obligatoria —sin ella no hay agenda de ocurrencias— y
 * la frecuencia define cada cuánto vuelve a exigirse. El proceso sale del
 * diccionario de la faena (el mismo que alimenta la columna «Proceso» del
 * RE-04.1); el responsable puede ser una persona de la faena o un nombre suelto
 * (un comité, un cargo) que el servicio congela junto a la actividad.
 */
export function ProgramActionDialog({
  matrixId,
  processes,
  users,
  action,
  defaultLocationLabel,
  trigger,
  onSaved,
}: {
  matrixId: string
  processes: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string }>
  /** Presente al editar; ausente al crear. */
  action?: ProgramActionView
  /** Centro de trabajo con que se prellena una actividad nueva. */
  defaultLocationLabel: string | null
  trigger: React.ReactNode
  /** Opcional: la acción revalida la ruta y llega un `program` nuevo por props. */
  onSaved?: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [processId, setProcessId] = React.useState("")
  const [responsibleUserId, setResponsibleUserId] = React.useState("")
  const [scheduleKind, setScheduleKind] = React.useState<string>("monthly")
  const [startsOn, setStartsOn] = React.useState(todayInChile())
  const operation = useOperation()

  // Al reabrir, el formulario vuelve a la actividad de la fila: el diálogo queda
  // montado entre ediciones y heredaría el estado de la anterior.
  function handleOpenChange(value: boolean) {
    if (value && action) {
      setProcessId(action.processId ?? "")
      setResponsibleUserId(action.responsibleUserId ?? "")
      setScheduleKind(action.scheduleKind)
      setStartsOn(action.startsOn)
    } else if (value) {
      setProcessId("")
      setResponsibleUserId("")
      setScheduleKind("monthly")
      setStartsOn(todayInChile())
    }
    operation.setMessage("")
    setOpen(value)
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const user = users.find((candidate) => candidate.id === responsibleUserId)
    operation.run(() => saveProgramActionAction({
      matrixId,
      ...(action ? { actionId: action.id, expectedVersion: action.version } : {}),
      processId: processId || null,
      description: String(form.get("description") ?? "").trim(),
      responsibleUserId: responsibleUserId || null,
      responsibleName: responsibleUserId ? user?.name ?? null : text(form.get("responsibleName")),
      locationLabel: text(form.get("locationLabel")),
      scheduleKind,
      startsOn,
    }), () => { setOpen(false); onSaved?.() })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{action ? `Actividad N° ${action.actionNumber}` : "Nueva actividad del programa"}</DialogTitle>
            <DialogDescription>
              La actividad es la que se ejecuta y se registra. Su fecha programada y su frecuencia generan las ocurrencias que se exigen cada período.
            </DialogDescription>
          </DialogHeader>
          <Field label="Actividad" hint="Qué se hace, en concreto.">
            <Textarea name="description" required minLength={3} maxLength={3000} rows={3} defaultValue={action?.description ?? ""} />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Proceso" hint="Del diccionario de la MIPER.">
              <OptionSelect
                aria-label="Proceso de la actividad"
                value={processId}
                onValueChange={setProcessId}
                emptyLabel="Sin proceso"
                placeholder="Sin proceso"
                options={processes.map((process) => ({ value: process.id, label: process.name }))}
              />
            </Field>
            <Field label="Frecuencia" hint="Cada cuánto se exige la actividad.">
              <OptionSelect
                aria-label="Frecuencia de la actividad"
                value={scheduleKind}
                onValueChange={setScheduleKind}
                options={PROGRAM_SCHEDULE_OPTIONS}
              />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Responsable" hint="Quien ejecuta la actividad.">
              <OptionSelect
                aria-label="Responsable de la actividad"
                value={responsibleUserId}
                onValueChange={setResponsibleUserId}
                emptyLabel="Sin responsable"
                placeholder="Sin responsable"
                options={users.map((user) => ({ value: user.id, label: user.name }))}
              />
            </Field>
            <Field label="Fecha programada" hint="Primera vez que se exige.">
              <DatePicker name="startsOn" value={startsOn} onChange={setStartsOn} ariaLabel="Fecha programada de la actividad" />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Centro de trabajo" hint="Dónde se ejecuta.">
              <Input name="locationLabel" maxLength={300} defaultValue={action?.locationLabel ?? defaultLocationLabel ?? ""} />
            </Field>
            <Field label="Responsable sin usuario" hint="Opcional. Para un comité o un cargo sin cuenta.">
              <Input name="responsibleName" maxLength={300} disabled={responsibleUserId !== ""} placeholder="Comité paritario, jefatura de turno" />
            </Field>
          </div>
          {operation.message && <p role="status" className="text-sm text-[var(--color-text-muted)]">{operation.message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={operation.pending}>{action ? "Guardar actividad" : "Agregar actividad"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Retiro de una actividad (§7.4): exige motivo y detiene las ocurrencias
 * futuras. Lo ya registrado —con su evidencia— se conserva.
 *
 * El diálogo es controlado por la fila que lo abre: el botón de la fila lleva el
 * N° de la actividad en su nombre accesible, así que no se duplica acá.
 */
export function RetireActionDialog({
  matrixId,
  action,
  open,
  onOpenChange,
  onRetired,
}: {
  matrixId: string
  action: ProgramActionView
  open: boolean
  onOpenChange: (open: boolean) => void
  onRetired?: () => void
}) {
  const operation = useOperation({ feedback: "toast" })
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Retirar la actividad N° ${action.actionNumber}`}
      description="Deja de generar ocurrencias: las pendientes quedan fuera y lo ya registrado, con su evidencia, se conserva en el historial."
      confirmLabel="Retirar actividad"
      variant="warning"
      loading={operation.pending}
      reasonLabel="Motivo del retiro"
      reasonPlaceholder="Por qué se retira la actividad (al menos 10 caracteres)"
      onConfirm={(reason) => operation.run(
        () => retireProgramActionAction({ matrixId, actionId: action.id, expectedVersion: action.version, reason }),
        () => { onOpenChange(false); onRetired?.() },
      )}
    />
  )
}
