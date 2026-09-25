"use client"

import * as React from "react"
import { WarningCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  PDTP_DEVIATION_KIND_HINTS,
  PDTP_DEVIATION_KIND_LABELS,
  type PdtpDeviationKindValue,
} from "@/lib/prevention/pdtp"
import { MONTH_LABELS } from "@/lib/utils"
import { recordPdtpDeviationAction } from "./actions"

type FormState = { ok: boolean; message?: string; fieldErrors?: Record<string, string[]> } | null

type PdtpDeviationFormProps = {
  activityId: string
  activityN: number
  activityName: string
  worksiteId: string
  year: number
  defaultMonth: number
  defaultWeek: number
  /** `prevention:pdtp:execute` (o, en celdas `mechanism = 'constancia'`,
   *  `prevention:constancias:execute`): habilita declarar "no realizada". */
  canDeclareNotPerformed?: boolean
  /** `prevention:pdtp:override:manage`: habilita "reprogramar" (mueve lo
   *  planificado a otro período — sigue siendo exclusivo de quien administra
   *  metas por faena) y, salvo que `canDeclareNotApplicable` ya la habilite,
   *  también "no aplica". */
  canManagePlanning?: boolean
  /** `prevention:constancias:execute` sobre una celda `mechanism =
   *  'constancia'` (Task 9, M2.1): habilita "no aplica" SIN habilitar
   *  "reprogramar" — Constancias declara hechos sobre su propia celda, no
   *  reprograma planificación, que sigue siendo de quien administra metas
   *  (`canManagePlanning`). Es aditivo a `canManagePlanning`, no lo reemplaza. */
  canDeclareNotApplicable?: boolean
}

const WEEKS = [1, 2, 3, 4]

/**
 * Declara un desvío sobre una celda (actividad × faena × mes/semana): "no
 * realizada" con motivo, "no aplica" o "reprogramada".
 *
 * Los tres tipos no son intercambiables y la diferencia importa más que el
 * formulario: "no realizada" deja el planificado en pie (la semana se sigue
 * exigiendo y sigue contando en cero, sólo queda el motivo registrado), "no
 * aplica" saca la celda del cálculo y "reprogramada" la traslada. Por eso cada
 * opción lleva su consecuencia escrita al lado, en vez de tres etiquetas que
 * se leen igual de inocuas.
 *
 * El selector de tipo es un grupo de radios, no un `Select`: cambiarlo cambia
 * el formulario (aparece el destino) y las tres opciones tienen que poder
 * compararse a la vista, no de a una detrás de un desplegable.
 */
export function PdtpDeviationForm({
  activityId,
  activityN,
  activityName,
  worksiteId,
  year,
  defaultMonth,
  defaultWeek,
  canDeclareNotPerformed = false,
  canManagePlanning = false,
  canDeclareNotApplicable = false,
}: PdtpDeviationFormProps) {
  const availableKinds: PdtpDeviationKindValue[] = [
    ...(canDeclareNotPerformed ? (["not_performed"] as const) : []),
    ...(canManagePlanning || canDeclareNotApplicable ? (["not_applicable"] as const) : []),
    ...(canManagePlanning ? (["reprogrammed"] as const) : []),
  ]
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState<PdtpDeviationKindValue>(availableKinds[0] ?? "not_performed")
  const [month, setMonth] = React.useState(String(defaultMonth))
  const [week, setWeek] = React.useState(String(defaultWeek))
  const [targetMonth, setTargetMonth] = React.useState(String(defaultMonth))
  const [targetWeek, setTargetWeek] = React.useState(String(Math.min(4, defaultWeek + 1)))

  const [state, formAction] = React.useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const { toast } = await import("@/lib/toast")
      const result = await recordPdtpDeviationAction(formData)
      if (!result.ok) {
        toast.error(result.message ?? "No se pudo registrar el desvío.")
      } else {
        toast.success("Desvío registrado.")
        setOpen(false)
        // El diálogo sigue montado: el desvío siguiente parte de la celda, no del último usado.
        setKind(availableKinds[0] ?? "not_performed")
        setMonth(String(defaultMonth))
        setWeek(String(defaultWeek))
        setTargetMonth(String(defaultMonth))
        setTargetWeek(String(Math.min(4, defaultWeek + 1)))
      }
      return result
    },
    null,
  )
  const [pending, startTransition] = React.useTransition()

  if (availableKinds.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" aria-label={`Declarar desvío en la actividad N°${activityN}`}>
          <WarningCircle size={13} className="mr-1" />
          Declarar desvío
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Declarar desvío · N°{activityN}</DialogTitle>
          <DialogDescription>{activityName}</DialogDescription>
        </DialogHeader>
        <form
          action={(fd) => startTransition(() => formAction(fd))}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="activityId" value={activityId} />
          <input type="hidden" name="worksiteId" value={worksiteId} />
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="week" value={week} />
          {kind === "reprogrammed" && (
            <>
              <input type="hidden" name="targetMonth" value={targetMonth} />
              <input type="hidden" name="targetWeek" value={targetWeek} />
            </>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-medium text-[var(--color-text-muted)]">Tipo de desvío</legend>
            {availableKinds.map((option) => (
              <label
                key={option}
                htmlFor={`deviation-kind-${option}`}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
              >
                <input
                  id={`deviation-kind-${option}`}
                  type="radio"
                  name="kind"
                  value={option}
                  checked={kind === option}
                  onChange={() => setKind(option)}
                  // El nombre accesible es el tipo a secas; la consecuencia va
                  // en el texto visible. Sin esto, el lector de pantalla (y
                  // `getByLabelText`) reciben la etiqueta y la explicación
                  // pegadas en una sola frase.
                  aria-label={PDTP_DEVIATION_KIND_LABELS[option]}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-[var(--color-text)]">{PDTP_DEVIATION_KIND_LABELS[option]}</span>
                  <span className="block text-[11px] text-[var(--color-text-muted)]">{PDTP_DEVIATION_KIND_HINTS[option]}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Mes" htmlFor="deviation-month">
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger id="deviation-month" className="h-9 text-sm" aria-label="Mes">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_LABELS.map((label, index) => (
                    <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Semana" htmlFor="deviation-week">
              <Select value={week} onValueChange={setWeek}>
                <SelectTrigger id="deviation-week" className="h-9 text-sm" aria-label="Semana">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKS.map((value) => (
                    <SelectItem key={value} value={String(value)}>{value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {kind === "reprogrammed" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mes de destino" htmlFor="deviation-target-month">
                <Select value={targetMonth} onValueChange={setTargetMonth}>
                  <SelectTrigger id="deviation-target-month" className="h-9 text-sm" aria-label="Mes de destino">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_LABELS.map((label, index) => (
                      <SelectItem key={label} value={String(index + 1)}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Semana de destino" htmlFor="deviation-target-week">
                <Select value={targetWeek} onValueChange={setTargetWeek}>
                  <SelectTrigger id="deviation-target-week" className="h-9 text-sm" aria-label="Semana de destino">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKS.map((value) => (
                      <SelectItem key={value} value={String(value)}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}

          <Field label="Motivo" htmlFor="deviation-reason">
            <Textarea
              id="deviation-reason"
              name="reason"
              required
              minLength={10}
              maxLength={1000}
              rows={3}
              placeholder="Explica por qué la actividad no se ejecutó, no aplica o se traslada"
              aria-label="Motivo"
              className="min-h-0"
            />
          </Field>

          {state && !state.ok && state.message && (
            <p role="alert" className="text-xs text-[var(--color-danger)]">{state.message}</p>
          )}

          <DialogFooter>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Registrando…" : "Registrar desvío"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type PdtpDeviationListProps = {
  deviations: Array<{
    id: string
    month: number
    week: number
    kind: string
    reason: string
    targetMonth: number | null
    targetWeek: number | null
  }>
  /** Sólo se ofrece "Retirar" a quien puede declarar algún desvío. */
  canWithdraw?: boolean
}

/**
 * Desvíos vigentes de una actividad, con la opción de retirarlos. Retirar
 * exige su propio motivo: el desvío cambió el cálculo mientras estuvo activo y
 * deshacerlo también es una decisión que alguien tiene que firmar.
 */
export function PdtpDeviationList({ deviations, canWithdraw = false }: PdtpDeviationListProps) {
  if (deviations.length === 0) return null
  return (
    <ul className="mt-2 space-y-1.5">
      {deviations.map((deviation) => (
        <li
          key={deviation.id}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[11px]"
        >
          <div className="flex flex-wrap items-center gap-1.5 text-[var(--color-text-subtle)]">
            <span className="font-medium text-[var(--color-text)]">
              {PDTP_DEVIATION_KIND_LABELS[deviation.kind as PdtpDeviationKindValue] ?? deviation.kind}
            </span>
            <span className="font-mono">
              {MONTH_LABELS[deviation.month - 1]} · Sem {deviation.week}
            </span>
            {deviation.targetMonth !== null && deviation.targetWeek !== null && (
              <span className="font-mono">
                → {MONTH_LABELS[deviation.targetMonth - 1]} · Sem {deviation.targetWeek}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[var(--color-text-muted)]">{deviation.reason}</p>
          {canWithdraw && <PdtpDeviationWithdrawButton deviationId={deviation.id} />}
        </li>
      ))}
    </ul>
  )
}

function PdtpDeviationWithdrawButton({ deviationId }: { deviationId: string }) {
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const [state, formAction] = React.useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const { toast } = await import("@/lib/toast")
      const { withdrawPdtpDeviationAction } = await import("./actions")
      const result = await withdrawPdtpDeviationAction(formData)
      if (!result.ok) {
        toast.error(result.message ?? "No se pudo retirar el desvío.")
      } else {
        toast.success("Desvío retirado.")
        setOpen(false)
      }
      return result
    },
    null,
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="mt-1 h-6 px-1.5 text-[11px]">
          Retirar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retirar desvío</DialogTitle>
          <DialogDescription>
            La celda vuelve a comportarse como si el desvío nunca se hubiera declarado, y el retiro queda en el
            control de cambios del programa.
          </DialogDescription>
        </DialogHeader>
        <form action={(fd) => startTransition(() => formAction(fd))} className="flex flex-col gap-4">
          <input type="hidden" name="deviationId" value={deviationId} />
          <Field label="Motivo del retiro" htmlFor={`withdraw-reason-${deviationId}`}>
            <Textarea
              id={`withdraw-reason-${deviationId}`}
              name="reason"
              required
              minLength={10}
              maxLength={1000}
              rows={3}
              placeholder="Explica por qué el desvío deja de aplicar"
              aria-label="Motivo del retiro"
              className="min-h-0"
            />
          </Field>
          {state && !state.ok && state.message && (
            <p role="alert" className="text-xs text-[var(--color-danger)]">{state.message}</p>
          )}
          <DialogFooter>
            <Button type="submit" size="sm" variant="secondary" disabled={pending}>
              {pending ? "Retirando…" : "Retirar desvío"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
