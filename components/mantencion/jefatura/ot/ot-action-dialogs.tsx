"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  assignWorkOrderAction, changeWorkOrderEstimateAction, finishWorkOrderAction, markWorkOrderItemsAction,
  receiveWorkOrderAction, conformWorkOrderAction, reclassifyWorkOrderAction, rejectWorkOrderAction, reopenWorkOrderAction,
  startWorkOrderAction, updateWorkOrderEntryAction,
} from "@/app/(app)/mantencion/ot/[id]/actions"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Combobox } from "@/components/ui/combobox"
import { DatePicker } from "@/components/ui/date-picker"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { useOperation, type OperationResult } from "@/lib/hooks/use-operation"
import { ACTION_TYPES, ACTION_TYPE_LABELS, SPECIALTIES, SPECIALTY_LABELS, type ActionType, type Specialty } from "@/lib/mantencion/action-type"
import { OT_ITEM_KIND_LABELS, OT_ITEM_MAX_PER_KIND, OT_LABOR_HOURS_MAX, type OtItemKind } from "@/lib/mantencion/work-order-states"
import type { MantUnit } from "@/lib/mantencion/types"
import type { WorkOrderDetail, WorkOrderItemDetail } from "@/lib/services/mantencion/work-orders/types"
import { toast } from "@/lib/toast"
import { chileLocalDateTimeToUtc, chileWallClockDate } from "@/lib/utils"
import { isValidReason, REASON_MIN_LENGTH } from "@/lib/validation/reason-thresholds"

/** Datos que viajan con toda acción sobre una OT existente. */
export interface OtBase {
  workOrderId: string
  expectedVersion: number
}

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  base: OtBase
  folio: string
}

/** Hora de pared de Chile como `YYYY-MM-DDTHH:mm`, el valor del `DateTimePicker`. */
export function chileNowLocal(): string {
  return chileWallClockDate(new Date()).toISOString().slice(0, 16)
}

function isoToChileLocal(iso: string): string {
  return chileWallClockDate(new Date(iso)).toISOString().slice(0, 16)
}

/**
 * Corre una acción de la OT: el error (incluido «La OT cambió en otra sesión»)
 * queda dentro del diálogo, que sigue abierto con lo escrito; el éxito avisa con
 * un toast, cierra y refresca la página con la versión nueva. Si otra sesión se
 * adelantó, además se refresca para que el reenvío lleve la versión vigente.
 */
function useOtAction(onDone: () => void) {
  const router = useRouter()
  const operation = useOperation()
  const run = (call: () => Promise<OperationResult>, okMessage: string) => {
    operation.run(
      call,
      (result) => {
        toast.success(result.message ?? okMessage)
        onDone()
        router.refresh()
      },
      (result) => {
        if (/otra sesi[oó]n|cambi[oó]/i.test(result.message ?? "")) router.refresh()
      },
    )
  }
  return { ...operation, run }
}

function ErrorLine({ message }: { message: string }) {
  if (!message) return null
  return <p role="alert" className="mt-2 text-sm text-[var(--color-danger-ink)]">{message}</p>
}

function Footer({ pending, onCancel, submitLabel, disabled }: { pending: boolean; onCancel: () => void; submitLabel: string; disabled?: boolean }) {
  return (
    <DialogFooter>
      <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>Cancelar</Button>
      <Button type="submit" loading={pending} disabled={disabled}>{submitLabel}</Button>
    </DialogFooter>
  )
}

// ── Asignar / reasignar ──────────────────────────────────────────────────────

export function AssignDialog({
  open, onOpenChange, base, folio, mechanics, currentUserId,
}: DialogProps & { mechanics: Array<{ id: string; name: string; worksiteNames: string[] }>; currentUserId: string | null }) {
  const [mechanicId, setMechanicId] = React.useState("")
  const op = useOtAction(() => onOpenChange(false))
  const reassigning = !!currentUserId
  const options = mechanics.map((mechanic) => ({
    value: mechanic.id,
    label: mechanic.worksiteNames.length ? `${mechanic.name} · ${mechanic.worksiteNames.join(", ")}` : mechanic.name,
    textValue: mechanic.name,
  }))
  function submit(event: React.FormEvent) {
    event.preventDefault()
    op.run(() => assignWorkOrderAction({ ...base, assignedToUserId: mechanicId }), reassigning ? "Mecánico reasignado" : "Mecánico asignado")
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!op.pending) onOpenChange(next) }}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{reassigning ? "Reasignar" : "Asignar"} {folio}</DialogTitle>
            <DialogDescription>Puedes asignarla a un mecánico de cualquier faena. Le avisamos por la app.</DialogDescription>
          </DialogHeader>
          <Field label="Mecánico" htmlFor="ot-assign-mechanic" required>
            <OptionSelect id="ot-assign-mechanic" placeholder="Elige un mecánico" options={options} value={mechanicId} onValueChange={setMechanicId} />
          </Field>
          <ErrorLine message={op.message} />
          <Footer pending={op.pending} onCancel={() => onOpenChange(false)} submitLabel={reassigning ? "Reasignar" : "Asignar"} disabled={!mechanicId || mechanicId === currentUserId} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Ingreso a taller ─────────────────────────────────────────────────────────

type Entry = NonNullable<WorkOrderDetail["entry"]>

export function EntryDialog({
  open, onOpenChange, base, folio, unit, entry, catalogs, correcting,
}: DialogProps & {
  unit: MantUnit
  entry: Entry | null
  catalogs: { workshops: Array<{ id: string; name: string }>; drivers: Array<{ id: string; name: string }> }
  /** Ya hay un ingreso: el diálogo lo corrige en vez de registrarlo. */
  correcting: boolean
}) {
  const [workshopKind, setWorkshopKind] = React.useState<"interno" | "externo">(entry?.workshopKind ?? "interno")
  const [workshopId, setWorkshopId] = React.useState(entry?.workshopId ?? "")
  const [manager, setManager] = React.useState(entry?.workshopManagerName ?? "")
  const [operatorDriverId, setOperatorDriverId] = React.useState<string | null>(entry?.operatorDriverId ?? null)
  const [operatorName, setOperatorName] = React.useState(entry?.operatorName ?? "")
  const [entryAt, setEntryAt] = React.useState(entry ? isoToChileLocal(entry.entryAt) : chileNowLocal())
  const [odometer, setOdometer] = React.useState(entry?.odometer != null ? String(entry.odometer) : "")
  const [hourmeter, setHourmeter] = React.useState(entry?.hourmeter != null ? String(entry.hourmeter) : "")
  const [estimate, setEstimate] = React.useState(entry?.estimatedDeliveryDate ?? "")
  const op = useOtAction(() => onOpenChange(false))

  const readingRaw = unit === "km" ? odometer : hourmeter
  const readingOk = readingRaw.trim() !== "" && Number.isFinite(Number(readingRaw.replace(",", ".")))
  const valid = !!entryAt && !!estimate && readingOk && (workshopKind === "interno" || !!workshopId)

  const toNumber = (raw: string) => (raw.trim() === "" ? null : Number(raw.replace(",", ".")))
  const driverOptions = catalogs.drivers.map((driver) => ({ value: driver.id, label: driver.name }))
  const operatorValue = operatorDriverId ?? operatorName

  function chooseOperator(value: string) {
    const driver = catalogs.drivers.find((item) => item.id === value)
    if (driver) { setOperatorDriverId(driver.id); setOperatorName(driver.name) }
    else { setOperatorDriverId(null); setOperatorName(value) }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const input = {
      ...base,
      entry: {
        workshopKind,
        workshopId: workshopKind === "externo" ? workshopId || null : null,
        workshopManagerName: manager.trim() || null,
        operatorDriverId,
        operatorName: operatorName.trim() || null,
        entryAt: chileLocalDateTimeToUtc(entryAt),
        odometer: toNumber(odometer),
        hourmeter: toNumber(hourmeter),
        estimatedDeliveryDate: estimate,
      },
    }
    op.run(() => (correcting ? updateWorkOrderEntryAction(input) : startWorkOrderAction(input)), correcting ? "Ingreso corregido" : "Ingreso a taller registrado")
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!op.pending) onOpenChange(next) }}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{correcting ? "Corregir el ingreso de" : "Registrar ingreso de"} {folio}</DialogTitle>
            <DialogDescription>Los datos de «Ingreso a taller» del talonario. Al ingresar, el equipo pasa a mantención si estaba operativo.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Taller" htmlFor="ot-entry-kind" required>
                <OptionSelect
                  id="ot-entry-kind"
                  options={[{ value: "interno", label: "Taller interno" }, { value: "externo", label: "Taller externo" }]}
                  value={workshopKind}
                  onValueChange={(value) => setWorkshopKind(value === "externo" ? "externo" : "interno")}
                />
              </Field>
              {workshopKind === "externo" && (
                <Field label="Taller externo" htmlFor="ot-entry-workshop" required>
                  <OptionSelect id="ot-entry-workshop" placeholder="Elige el taller" options={catalogs.workshops.map((item) => ({ value: item.id, label: item.name }))} value={workshopId} onValueChange={setWorkshopId} />
                </Field>
              )}
              <Field label="Encargado" htmlFor="ot-entry-manager">
                <Input id="ot-entry-manager" value={manager} maxLength={120} onChange={(event) => setManager(event.target.value)} />
              </Field>
              <Field label="Operador" htmlFor="ot-entry-operator">
                <Combobox id="ot-entry-operator" allowCustomValue options={driverOptions} value={operatorValue} onChange={chooseOperator} clearLabel="Sin operador" placeholder="Busca o escribe el nombre" />
              </Field>
            </div>
            <Field label="Fecha y hora de ingreso" htmlFor="ot-entry-at" required>
              <DateTimePicker id="ot-entry-at" value={entryAt} onChange={setEntryAt} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kilómetro" htmlFor="ot-entry-km" required={unit === "km"}>
                <Input id="ot-entry-km" inputMode="decimal" value={odometer} onChange={(event) => setOdometer(event.target.value)} />
              </Field>
              <Field label="Horómetro" htmlFor="ot-entry-h" required={unit === "h"}>
                <Input id="ot-entry-h" inputMode="decimal" value={hourmeter} onChange={(event) => setHourmeter(event.target.value)} />
              </Field>
            </div>
            <Field label="Entrega estimada" htmlFor="ot-entry-estimate" required helper="Se puede cambiar después; cada cambio queda en el historial.">
              <DatePicker id="ot-entry-estimate" value={estimate} onChange={setEstimate} min={entryAt.slice(0, 10)} ariaLabel="Fecha estimada de entrega" />
            </Field>
          </div>
          <ErrorLine message={op.message} />
          <Footer pending={op.pending} onCancel={() => onOpenChange(false)} submitLabel={correcting ? "Guardar corrección" : "Registrar ingreso"} disabled={!valid} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Fecha estimada de entrega ────────────────────────────────────────────────

export function EstimateDialog({ open, onOpenChange, base, folio, current }: DialogProps & { current: string | null }) {
  const [estimate, setEstimate] = React.useState(current ?? "")
  const [reason, setReason] = React.useState("")
  const op = useOtAction(() => onOpenChange(false))
  const changing = !current || estimate !== current
  const reasonOk = !current || isValidReason(reason)
  function submit(event: React.FormEvent) {
    event.preventDefault()
    op.run(() => changeWorkOrderEstimateAction({ ...base, estimatedDeliveryDate: estimate, reason: reason.trim() || null }), "Entrega estimada actualizada")
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!op.pending) onOpenChange(next) }}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Cambiar la entrega estimada de {folio}</DialogTitle>
            <DialogDescription>
              {current ? "El cambio queda en el historial con su motivo." : "Indica cuándo se estima entregar el equipo."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field label="Nueva fecha estimada" htmlFor="ot-estimate-date" required>
              <DatePicker id="ot-estimate-date" value={estimate} onChange={setEstimate} ariaLabel="Nueva fecha estimada de entrega" />
            </Field>
            {current && (
              <Field label="Motivo del cambio" htmlFor="ot-estimate-reason" required helper={`Al menos ${REASON_MIN_LENGTH} caracteres.`}>
                <Textarea id="ot-estimate-reason" value={reason} rows={3} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="Ej. Llegó tarde el repuesto desde Santiago." />
              </Field>
            )}
          </div>
          <ErrorLine message={op.message} />
          <Footer pending={op.pending} onCancel={() => onOpenChange(false)} submitLabel="Guardar fecha" disabled={!estimate || !changing || !reasonOk} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Ítems SÍ / NO ────────────────────────────────────────────────────────────

interface Mark { done: "si" | "no" | null; note: string }

export function ItemsDialog({ open, onOpenChange, base, folio, items }: DialogProps & { items: WorkOrderItemDetail[] }) {
  const [marks, setMarks] = React.useState<Record<string, Mark>>(() =>
    Object.fromEntries(items.map((item) => [item.id, { done: item.done, note: item.note ?? "" }])))
  const [added, setAdded] = React.useState<Array<{ kind: OtItemKind; description: string }>>([])
  const op = useOtAction(() => onOpenChange(false))

  const countOf = (kind: OtItemKind) => items.filter((item) => item.kind === kind).length + added.filter((item) => item.kind === kind).length

  const changed = items.filter((item) => {
    const mark = marks[item.id]
    return mark?.done != null && (mark.done !== item.done || mark.note.trim() !== (item.note ?? ""))
  })
  const validAdded = added.filter((item) => item.description.trim().length >= 3)
  const nothingToSend = changed.length === 0 && validAdded.length === 0

  function submit(event: React.FormEvent) {
    event.preventDefault()
    op.run(() => markWorkOrderItemsAction({
      ...base,
      marks: changed.map((item) => ({ itemId: item.id, done: marks[item.id]!.done as "si" | "no", note: marks[item.id]!.note.trim() || null })),
      added: validAdded.map((item) => ({ kind: item.kind, description: item.description.trim() })),
    }), "Ítems actualizados")
  }

  const setMark = (id: string, patch: Partial<Mark>) => setMarks((current) => ({ ...current, [id]: { ...(current[id] ?? { done: null, note: "" }), ...patch } }))

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!op.pending) onOpenChange(next) }}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Marcar los ítems de {folio}</DialogTitle>
            <DialogDescription>Marca Sí o No en cada trabajo pedido. Para terminar la orden, todos deben quedar marcados.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {items.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">La orden no trae ítems pedidos. Puedes agregar los que se hacen en el taller.</p>}
            {items.map((item) => {
              const mark = marks[item.id] ?? { done: null, note: "" }
              return (
                <fieldset key={item.id} className="rounded-lg border border-[var(--color-border)] p-3">
                  <legend className="px-1 text-xs text-[var(--color-text-muted)]">{OT_ITEM_KIND_LABELS[item.kind]}</legend>
                  <p className="text-sm font-medium text-[var(--color-text)]">{item.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <div role="group" aria-label={`¿Realizado? ${item.description}`} className="flex gap-2">
                      {(["si", "no"] as const).map((value) => (
                        <Button
                          key={value}
                          type="button"
                          size="sm"
                          aria-pressed={mark.done === value}
                          variant={mark.done === value ? "primary" : "secondary"}
                          onClick={() => setMark(item.id, { done: value })}
                        >
                          {value === "si" ? "Sí" : "No"}
                        </Button>
                      ))}
                    </div>
                    <Input
                      aria-label={`Nota de ${item.description}`}
                      className="min-w-48 flex-1"
                      value={mark.note}
                      maxLength={300}
                      placeholder="Nota (opcional)"
                      onChange={(event) => setMark(item.id, { note: event.target.value })}
                    />
                  </div>
                </fieldset>
              )
            })}

            {added.map((item, index) => (
              <div key={index} className="grid gap-2 rounded-lg border border-dashed border-[var(--color-border)] p-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
                <OptionSelect
                  aria-label={`Lista del ítem agregado ${index + 1}`}
                  options={(["mantencion", "anexo"] as const).map((kind) => ({ value: kind, label: OT_ITEM_KIND_LABELS[kind], disabled: countOf(kind) >= OT_ITEM_MAX_PER_KIND && item.kind !== kind }))}
                  value={item.kind}
                  onValueChange={(value) => setAdded((current) => current.map((entry, i) => (i === index ? { ...entry, kind: value === "anexo" ? "anexo" : "mantencion" } : entry)))}
                />
                <Input
                  aria-label={`Descripción del ítem agregado ${index + 1}`}
                  value={item.description}
                  maxLength={300}
                  placeholder="Trabajo agregado en el taller"
                  onChange={(event) => setAdded((current) => current.map((entry, i) => (i === index ? { ...entry, description: event.target.value } : entry)))}
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => setAdded((current) => current.filter((_, i) => i !== index))}>Quitar</Button>
              </div>
            ))}

            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={countOf("mantencion") >= OT_ITEM_MAX_PER_KIND && countOf("anexo") >= OT_ITEM_MAX_PER_KIND}
                onClick={() => setAdded((current) => [...current, { kind: countOf("mantencion") < OT_ITEM_MAX_PER_KIND ? "mantencion" : "anexo", description: "" }])}
              >
                Agregar ítem de taller
              </Button>
            </div>
          </div>
          <ErrorLine message={op.message} />
          <Footer pending={op.pending} onCancel={() => onOpenChange(false)} submitLabel="Guardar marcas" disabled={nothingToSend} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Salida de taller ─────────────────────────────────────────────────────────

export function FinishDialog({
  open, onOpenChange, base, folio, entryAt, savedWorkPerformed = null, savedLaborHours = null,
}: DialogProps & {
  entryAt: string | null
  /**
   * Lo que la OT ya tiene guardado de una salida anterior (tras un rechazo o una reapertura). Se precarga:
   * antes el diálogo salía vacío y, al reenviar, un «2» pisaba en silencio un «8» (OTN-3).
   */
  savedWorkPerformed?: string | null
  savedLaborHours?: number | null
}) {
  const [exitAt, setExitAt] = React.useState(chileNowLocal)
  const [note, setNote] = React.useState("")
  const [workPerformed, setWorkPerformed] = React.useState(savedWorkPerformed ?? "")
  const [laborHours, setLaborHours] = React.useState(savedLaborHours != null ? String(savedLaborHours) : "")
  const [hoursError, setHoursError] = React.useState<string | undefined>()
  const op = useOtAction(() => onOpenChange(false))
  function submit(event: React.FormEvent) {
    event.preventDefault()
    const hoursText = laborHours.trim().replace(",", ".")
    const hours = hoursText === "" ? null : Number(hoursText)
    if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > OT_LABOR_HOURS_MAX)) {
      setHoursError(`Indica horas entre 0 y ${OT_LABOR_HOURS_MAX.toLocaleString("es-CL")}.`)
      return
    }
    setHoursError(undefined)
    op.run(() => finishWorkOrderAction({
      ...base, exitAt: chileLocalDateTimeToUtc(exitAt), note: note.trim() || null, workPerformed: workPerformed.trim() || null, laborHours: hours,
    }), "Salida de taller registrada")
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!op.pending) onOpenChange(next) }}>
      <DialogContent>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Registrar la salida de {folio}</DialogTitle>
            <DialogDescription>Exige todos los ítems marcados y al menos un registro de mantención vigente enlazado a la orden.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field label="Fecha y hora de salida" htmlFor="ot-exit-at" required>
              <DateTimePicker id="ot-exit-at" value={exitAt} onChange={setExitAt} min={entryAt ? isoToChileLocal(entryAt) : undefined} />
            </Field>
            <Field label="Trabajo realizado (opcional)" htmlFor="ot-exit-work" helper={savedWorkPerformed || savedLaborHours != null ? "Ya había datos de una salida anterior: revísalos y corrige lo que cambió." : "Qué se hizo, en palabras de quien lo hizo."}>
              <Textarea id="ot-exit-work" value={workPerformed} rows={3} maxLength={4000} onChange={(event) => setWorkPerformed(event.target.value)} />
            </Field>
            <Field label="Horas hombre (opcional)" htmlFor="ot-exit-hours" error={hoursError} helper="Total de horas de trabajo de las personas que intervinieron.">
              <Input id="ot-exit-hours" type="number" inputMode="decimal" min={0} max={OT_LABOR_HOURS_MAX} step="0.25" value={laborHours} onChange={(event) => setLaborHours(event.target.value)} />
            </Field>
            <Field label="Nota (opcional)" htmlFor="ot-exit-note">
              <Textarea id="ot-exit-note" value={note} rows={2} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </div>
          <ErrorLine message={op.message} />
          <Footer pending={op.pending} onCancel={() => onOpenChange(false)} submitLabel="Registrar salida" disabled={!exitAt} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Recepción y recepción en faena (conformidad) ─────────────────────────────

export function ReceiptDialog({
  open, onOpenChange, base, folio, mode, defaultName,
}: DialogProps & { mode: "receive" | "conform"; defaultName: string }) {
  const [at, setAt] = React.useState(chileNowLocal)
  const [name, setName] = React.useState(defaultName)
  const op = useOtAction(() => onOpenChange(false))
  const conform = mode === "conform"
  function submit(event: React.FormEvent) {
    event.preventDefault()
    const when = chileLocalDateTimeToUtc(at)
    op.run(
      () => (conform
        ? conformWorkOrderAction({ ...base, faenaReceivedAt: when, faenaReceiverName: name.trim() })
        : receiveWorkOrderAction({ ...base, receivedAt: when, receiverName: name.trim() })),
      conform ? "Conformidad registrada: la orden quedó cerrada" : "Equipo recibido",
    )
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!op.pending) onOpenChange(next) }}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{conform ? "Dar conformidad a" : "Recibir equipo"} {folio}</DialogTitle>
            <DialogDescription>
              {conform
                ? "Es la conformidad en faena: confirma que el equipo llegó bien y cierra la orden."
                : "La registra quien retira el equipo del taller."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field label="Fecha y hora" htmlFor="ot-receipt-at" required>
              <DateTimePicker id="ot-receipt-at" value={at} onChange={setAt} />
            </Field>
            <Field label="Recibió" htmlFor="ot-receipt-name" required>
              <Input id="ot-receipt-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
            </Field>
          </div>
          <ErrorLine message={op.message} />
          <Footer pending={op.pending} onCancel={() => onOpenChange(false)} submitLabel={conform ? "Dar conformidad" : "Recibir equipo"} disabled={!at || name.trim().length < 2} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Rechazar / reabrir (con motivo) ──────────────────────────────────────────

export function ReasonDialog({
  open, onOpenChange, base, folio, mode,
}: DialogProps & { mode: "reject" | "reopen" }) {
  const [reason, setReason] = React.useState("")
  const op = useOtAction(() => onOpenChange(false))
  const reject = mode === "reject"
  function submit(event: React.FormEvent) {
    event.preventDefault()
    op.run(() => (reject ? rejectWorkOrderAction({ ...base, reason: reason.trim() }) : reopenWorkOrderAction({ ...base, reason: reason.trim() })), reject ? "Orden devuelta al taller" : "Orden reabierta")
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!op.pending) onOpenChange(next) }}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{reject ? "Rechazar" : "Reabrir"} {folio}</DialogTitle>
            <DialogDescription>
              {reject
                ? "La orden vuelve a «En taller» con el mismo mecánico, que verá tu motivo. Avisamos a la jefatura de mantención."
                : "La orden cerrada vuelve a «En taller»."}
            </DialogDescription>
          </DialogHeader>
          <Field label={reject ? "¿Qué hay que corregir?" : "Motivo de la reapertura"} htmlFor="ot-reason" required helper={`Al menos ${REASON_MIN_LENGTH} caracteres.`}>
            <Textarea id="ot-reason" value={reason} rows={4} maxLength={1000} autoFocus onChange={(event) => setReason(event.target.value)} />
          </Field>
          <ErrorLine message={op.message} />
          <Footer pending={op.pending} onCancel={() => onOpenChange(false)} submitLabel={reject ? "Rechazar" : "Reabrir"} disabled={!isValidReason(reason)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}


// ── Corregir la clasificación ────────────────────────────────────────────────

/** Lo guardado que el diálogo precarga: tipo de acción, especialidades, faena de ejecución y horas hombre. */
export interface OtClassificationSnapshot {
  actionType: ActionType | null
  specialties: Specialty[]
  executionWorksiteId: string | null
  laborHours: number | null
  /** La OT ya pasó por la salida de taller: sólo entonces hay horas hombre que corregir. */
  hasExit: boolean
}

/**
 * «Corregir clasificación» (sólo jefatura): para una OT que ya no admite «Editar solicitud» (en taller, por
 * recibir, por conformidad o cerrada). Precarga lo guardado, pide un motivo y deja el cambio en el historial.
 * Envía la versión del momento de abrir: un conflicto («cambió en otra sesión») queda dentro del diálogo y no
 * pisa en silencio lo de la otra sesión.
 */
export function ReclassifyDialog({
  open, onOpenChange, base, folio, classification, executionWorksites, actionTypeRequired,
}: DialogProps & {
  classification: OtClassificationSnapshot
  /** Faenas elegibles como «Faena de ejecución» (ya sin la del equipo). */
  executionWorksites: Array<{ id: string; name: string }>
  actionTypeRequired: boolean
}) {
  const [actionType, setActionType] = React.useState<ActionType | "">(classification.actionType ?? "")
  const [specialties, setSpecialties] = React.useState<Specialty[]>(classification.specialties)
  const [executionWorksiteId, setExecutionWorksiteId] = React.useState(classification.executionWorksiteId ?? "")
  const [laborHours, setLaborHours] = React.useState(classification.laborHours != null ? String(classification.laborHours) : "")
  const [reason, setReason] = React.useState("")
  const [hoursError, setHoursError] = React.useState<string | undefined>()
  const [expectedVersion] = React.useState(base.expectedVersion)
  const op = useOtAction(() => onOpenChange(false))

  const toggleSpecialty = (specialty: Specialty, checked: boolean) => setSpecialties((current) => SPECIALTIES.filter((value) => (value === specialty ? checked : current.includes(value))))
  const hoursText = laborHours.trim().replace(",", ".")
  const hours = hoursText === "" ? null : Number(hoursText)
  const changed = (actionType || null) !== classification.actionType
    || JSON.stringify(specialties) !== JSON.stringify(classification.specialties)
    || (executionWorksiteId || null) !== classification.executionWorksiteId
    || (classification.hasExit && hours !== classification.laborHours)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (classification.hasExit && hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > OT_LABOR_HOURS_MAX)) {
      setHoursError(`Indica horas entre 0 y ${OT_LABOR_HOURS_MAX.toLocaleString("es-CL")}.`)
      return
    }
    setHoursError(undefined)
    op.run(() => reclassifyWorkOrderAction({
      workOrderId: base.workOrderId,
      expectedVersion,
      actionType: actionType || null,
      specialties,
      executionWorksiteId: executionWorksiteId || null,
      ...(classification.hasExit ? { laborHours: hours } : {}),
      reason: reason.trim(),
    }), "Clasificación corregida")
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!op.pending) onOpenChange(next) }}>
      <DialogContent>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>Corregir la clasificación de {folio}</DialogTitle>
            <DialogDescription>
              Tipo de acción, especialidades, faena de ejecución{classification.hasExit ? " y horas hombre" : ""}. Alimentan el Panel y el Excel; el cambio queda en el historial con su motivo.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field label="Tipo de acción" htmlFor="ot-reclass-tipo" required={actionTypeRequired}>
              <OptionSelect
                id="ot-reclass-tipo"
                emptyLabel={actionTypeRequired ? undefined : "Sin definir"}
                placeholder="Elige el tipo de acción"
                options={ACTION_TYPES.map((type) => ({ value: type, label: ACTION_TYPE_LABELS[type] }))}
                value={actionType}
                onValueChange={(value) => setActionType((ACTION_TYPES as readonly string[]).includes(value) ? (value as ActionType) : "")}
              />
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-medium text-[var(--color-text)]">Especialidades</legend>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {SPECIALTIES.map((specialty) => (
                  <Checkbox
                    key={specialty}
                    id={`ot-reclass-esp-${specialty}`}
                    label={SPECIALTY_LABELS[specialty]}
                    checked={specialties.includes(specialty)}
                    onChange={(event) => toggleSpecialty(specialty, event.target.checked)}
                  />
                ))}
              </div>
            </fieldset>
            {(executionWorksites.length > 0 || executionWorksiteId) && (
              <Field label="Faena de ejecución (opcional)" htmlFor="ot-reclass-faena" helper="Sólo si el trabajo se hizo en el taller de otra faena. Vacío = la del equipo.">
                <OptionSelect
                  id="ot-reclass-faena"
                  emptyLabel="La misma del equipo"
                  options={executionWorksites.map((worksite) => ({ value: worksite.id, label: worksite.name }))}
                  value={executionWorksiteId}
                  onValueChange={setExecutionWorksiteId}
                />
              </Field>
            )}
            {classification.hasExit && (
              <Field label="Horas hombre" htmlFor="ot-reclass-hours" error={hoursError} helper="Total de horas de trabajo de las personas que intervinieron.">
                <Input id="ot-reclass-hours" type="number" inputMode="decimal" min={0} max={OT_LABOR_HOURS_MAX} step="0.25" value={laborHours} onChange={(event) => setLaborHours(event.target.value)} />
              </Field>
            )}
            <Field label="Motivo de la corrección" htmlFor="ot-reclass-reason" required helper={`Al menos ${REASON_MIN_LENGTH} caracteres.`}>
              <Textarea id="ot-reclass-reason" value={reason} rows={3} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="Ej. Se registró como correctiva, pero fue una mantención programada." />
            </Field>
          </div>
          <ErrorLine message={op.message} />
          <Footer pending={op.pending} onCancel={() => onOpenChange(false)} submitLabel="Guardar corrección" disabled={!changed || !isValidReason(reason)} />
        </form>
      </DialogContent>
    </Dialog>
  )
}
