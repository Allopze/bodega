"use client"

import * as React from "react"
import { UserCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { MetaBadge } from "@/components/states/state-badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { listPdtpAssigneeCandidatesAction, setPdtpActivityAssigneesAction } from "./actions"

type FormState = { ok: boolean; message?: string; fieldErrors?: Record<string, string[]> } | null

type Candidate = { userId: string; name: string; roleLabels: string[] }

type PdtpAssigneePickerProps = {
  activityId: string
  activityN: number
  activityName: string
  worksiteId: string
  /** Asignados vigentes hoy en esta faena. Son las casillas ya marcadas. */
  currentAssignees?: Array<{ userId: string; name: string }>
  /** Día chileno de hoy (`AAAA-MM-DD`), calculado en el servidor. */
  today: string
}

const EMPTY_ASSIGNEES: Array<{ userId: string; name: string }> = []

/**
 * "Asignar a…": le pone nombre y apellido a una actividad del programa en una
 * faena.
 *
 * La advertencia del diálogo no es decorativa. Con un asignado vigente, los
 * demás usuarios del mismo rol dejan de ver esa fila en Pendientes — es el
 * punto de asignar, y también la forma de dejar trabajo invisible si se elige
 * mal. Por eso se dice en el propio formulario, antes de guardar.
 *
 * Los candidatos se piden al abrir, no al pintar la tabla: cargarlos para las
 * 87 filas de la planilla serían 87 consultas para una lista que casi nadie
 * abre. El servidor los revalida igual al guardar, así que esta lista es una
 * comodidad, no el control.
 */
export function PdtpAssigneePicker({
  activityId,
  activityN,
  activityName,
  worksiteId,
  currentAssignees = EMPTY_ASSIGNEES,
  today,
}: PdtpAssigneePickerProps) {
  const [open, setOpen] = React.useState(false)
  const [candidates, setCandidates] = React.useState<Candidate[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<string[]>(currentAssignees.map((person) => person.userId))
  const [validFrom, setValidFrom] = React.useState(today)

  React.useEffect(() => {
    setSelected(currentAssignees.map((person) => person.userId))
  }, [currentAssignees])

  React.useEffect(() => {
    if (!open || candidates !== null) return
    let cancelled = false
    void (async () => {
      const result = await listPdtpAssigneeCandidatesAction(activityId, worksiteId)
      if (cancelled) return
      if (result.ok) setCandidates(result.candidates)
      else setLoadError(result.message)
    })()
    return () => { cancelled = true }
  }, [open, candidates, activityId, worksiteId])

  const [state, formAction] = React.useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const { toast } = await import("@/lib/toast")
      const result = await setPdtpActivityAssigneesAction(formData)
      if (!result.ok) {
        toast.error(result.message ?? "No se pudo guardar la asignación.")
      } else {
        toast.success("Asignación guardada.")
        setOpen(false)
      }
      return result
    },
    null,
  )
  const [pending, startTransition] = React.useTransition()

  const toggle = (userId: string) => {
    setSelected((previous) => previous.includes(userId)
      ? previous.filter((id) => id !== userId)
      : [...previous, userId])
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" aria-label={`Asignar la actividad N°${activityN} a una persona`}>
          <UserCircle size={13} className="mr-1" />
          Asignar a…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar actividad · N°{activityN}</DialogTitle>
          <DialogDescription>{activityName}</DialogDescription>
        </DialogHeader>
        <form action={(fd) => startTransition(() => formAction(fd))} className="flex flex-col gap-4">
          <input type="hidden" name="activityId" value={activityId} />
          <input type="hidden" name="worksiteId" value={worksiteId} />
          {selected.map((userId) => (
            <input key={userId} type="hidden" name="userIds" value={userId} />
          ))}

          <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[11px] text-[var(--color-text-muted)]">
            Con una persona asignada, esta actividad deja de aparecer en Pendientes para el resto de quienes
            comparten su cargo en esta faena. Sin nadie asignado, la siguen viendo todos, como hasta ahora.
          </p>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-medium text-[var(--color-text-muted)]">
              Personas de la faena que pueden hacerse cargo
            </legend>
            {loadError && <p role="alert" className="text-xs text-[var(--color-danger)]">{loadError}</p>}
            {!loadError && candidates === null && (
              <p className="text-xs text-[var(--color-text-muted)]">Cargando personas…</p>
            )}
            {candidates?.length === 0 && (
              <p className="text-xs text-[var(--color-text-muted)]">
                Nadie de esta faena tiene el cargo responsable de esta actividad. Revisa los roles del equipo
                antes de asignarla.
              </p>
            )}
            {candidates?.map((candidate) => (
              <label
                key={candidate.userId}
                htmlFor={`assignee-${activityId}-${candidate.userId}`}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
              >
                <input
                  id={`assignee-${activityId}-${candidate.userId}`}
                  type="checkbox"
                  checked={selected.includes(candidate.userId)}
                  onChange={() => toggle(candidate.userId)}
                  aria-label={candidate.name}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-[var(--color-text)]">{candidate.name}</span>
                  <span className="block text-[11px] text-[var(--color-text-muted)]">
                    {candidate.roleLabels.join(" · ")}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <Field
            label="Rige desde"
            htmlFor={`assignee-valid-from-${activityId}`}
            helper="Quien deja de estar asignado conserva su registro hasta el día anterior: el historial de responsables no se borra."
          >
            <Input
              id={`assignee-valid-from-${activityId}`}
              type="date"
              name="validFrom"
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
              aria-label="Rige desde"
            />
          </Field>

          {state && !state.ok && state.message && (
            <p role="alert" className="text-xs text-[var(--color-danger)]">{state.message}</p>
          )}

          <DialogFooter>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Guardando…" : selected.length === 0 ? "Dejar sin asignar" : "Guardar asignación"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * "Asignada a: Nombre" en la fila de la planilla. La vista de actividades sigue
 * mostrando TODAS las actividades —a diferencia de Pendientes, que sólo muestra
 * lo propio—, así que este chip es la forma de saber de quién es cada una sin
 * abrir nada.
 */
export function PdtpAssigneeChip({ names }: { names: string[] }) {
  if (names.length === 0) return null
  return (
    <MetaBadge
      meta={{ label: `Asignada a: ${names.join(", ")}`, variant: "primary" }}
      title="Sólo esta persona ve la actividad en Pendientes para esta faena."
    />
  )
}
