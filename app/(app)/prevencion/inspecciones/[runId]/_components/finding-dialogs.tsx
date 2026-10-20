"use client"

import * as React from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  addDays,
  capaPriorityForCriticality,
  criticalityBadgeVariant,
  FINDING_CRITICALITY_LABELS,
} from "@/lib/prevention/inspections"
import { formatDate, todayInChile } from "@/lib/utils"
import { createFindingCapaAction, stopVehicleForFindingAction } from "../../actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import type { FindingInfo } from "./types"

/* ── Derivar hallazgo a CAPA ──────────────────────────────────────────────── */

/**
 * Puede usarse de dos maneras: con su propio botón (`trigger` por omisión) o
 * controlado desde afuera (`open`/`onOpenChange`, y `trigger={null}` para no
 * pintar ninguno), que es como lo usan la lista de hallazgos y el diálogo de
 * revisión: ahí hay un solo `CapaDialog` y no uno por fila o por bloqueo, y el
 * de la revisión vive fuera del `<form>` de la revisión.
 */
export function CapaDialog({ finding, assignees, hasVehicle, open, onOpenChange, trigger }: {
  finding: FindingInfo
  assignees: { id: string; name: string }[]
  hasVehicle: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Botón que lo abre. `null` no pinta ninguno (modo controlado). */
  trigger?: React.ReactElement | null
}) {
  const [innerOpen, setInnerOpen] = React.useState(false)
  const [responsibleUserId, setResponsibleUserId] = React.useState("")
  const operation = useOperation()
  const capaRule = capaPriorityForCriticality(finding.criticality)
  const targetDate = addDays(todayInChile(), capaRule.dueInDays)
  const isOpen = open ?? innerOpen

  function changeOpen(next: boolean) {
    // Un error de un intento anterior no debe esperar a quien vuelve a abrir.
    operation.setMessage("")
    if (!next) setResponsibleUserId("")
    if (open === undefined) setInnerOpen(next)
    onOpenChange?.(next)
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // El diálogo vive en un portal, pero React propaga los eventos por el árbol
    // de componentes y no por el DOM: sin esto, el `submit` llegaba al `<form>`
    // de la revisión que lo contiene y enviaba también «Revisar y cerrar».
    event.stopPropagation()
    const form = new FormData(event.currentTarget)
    const responsibleUserId = String(form.get("responsibleUserId") ?? "").trim()
    const immediateMeasure = String(form.get("immediateMeasure") ?? "").trim()
    operation.run(() => createFindingCapaAction({
      findingId: finding.id,
      actionDescription: form.get("actionDescription"),
      responsibleUserId,
      immediateMeasure: immediateMeasure || null,
    }), () => {
      toast.success("Hallazgo derivado a CAPA.")
      changeOpen(false)
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={changeOpen}>
      {trigger !== null && (
        <DialogTrigger asChild>{trigger ?? <Button size="sm" variant="secondary">Derivar a CAPA</Button>}</DialogTrigger>
      )}
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Derivar hallazgo a CAPA</DialogTitle>
            <DialogDescription>{finding.description}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">
            <div><span className="block text-xs text-[var(--color-text-subtle)]">Gravedad</span><MetaBadge meta={{ label: `${FINDING_CRITICALITY_LABELS[finding.criticality] ?? finding.criticality}`, variant: criticalityBadgeVariant(finding.criticality) }} className="mt-1" /></div>
            {/* I-24: "Compromiso automático" no explicaba por qué ese plazo — es
                política según gravedad, no un dato libre; se mantiene no editable. */}
            <div><span className="block text-xs text-[var(--color-text-subtle)]">Plazo según gravedad</span><span className="mt-1 block font-semibold">{capaRule.dueInDays} días · {formatDate(targetDate)}</span></div>
            {capaRule.requiresImmediateStop && <p className="col-span-2 text-xs font-medium text-[var(--color-danger-ink)]">La criticidad exige detener de inmediato la tarea o el equipo afectado.</p>}
          </div>
          <Field label="Acción correctiva" hint="Mínimo 10 caracteres." error={operation.fieldError("actionDescription")}>
            <Textarea name="actionDescription" required minLength={10} maxLength={3000} />
          </Field>
          {/* I-24: el único campo obligatorio del formulario iba después de uno
              opcional, y sin asterisco. */}
          <Field label="Responsable" required hint="Debe quedar una persona a cargo antes de derivar." error={operation.fieldError("responsibleUserId")}>
            <Select value={responsibleUserId} onValueChange={setResponsibleUserId}><SelectTrigger aria-label="Responsable de la CAPA"><SelectValue placeholder="Selecciona responsable" /></SelectTrigger><SelectContent>{assignees.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><input type="hidden" name="responsibleUserId" value={responsibleUserId} />
          </Field>
          <Field label="Medida inmediata" hint="Opcional." error={operation.fieldError("immediateMeasure")}>
            <Textarea name="immediateMeasure" maxLength={3000} />
          </Field>
          {hasVehicle && (
            <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm text-[var(--color-text-subtle)]">
              Se abrirá automáticamente una OT correctiva para este equipo con el mismo plazo de la CAPA. Al completarla, se cerrará el hallazgo y la acción quedará pendiente de verificación.
            </p>
          )}
          {operation.messageTone === "error" && operation.message && <Callout tone="danger" role="alert">{operation.message}</Callout>}
          <DialogFooter><Button type="submit" loading={operation.pending} disabled={!responsibleUserId}>Derivar con responsable</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Confirma la propuesta de sacar el equipo de servicio.
 *
 * Es un diálogo aparte y no una casilla del anterior porque detener un equipo
 * para la faena: lo decide quien administra la flota, no quien digita el
 * reporte, y exige dejar dicho por qué.
 */
export function StopVehicleDialog({ finding, subjectLabel, open, onOpenChange, trigger }: {
  finding: FindingInfo
  subjectLabel: string | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Botón que lo abre. `null` no pinta ninguno (modo controlado). */
  trigger?: React.ReactElement | null
}) {
  const [innerOpen, setInnerOpen] = React.useState(false)
  const operation = useOperation()
  const isOpen = open ?? innerOpen

  function changeOpen(next: boolean) {
    operation.setMessage("")
    if (open === undefined) setInnerOpen(next)
    onOpenChange?.(next)
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Misma razón que en `CapaDialog`: el portal no corta la propagación de React.
    event.stopPropagation()
    const form = new FormData(event.currentTarget)
    operation.run(() => stopVehicleForFindingAction({
      findingId: finding.id,
      reason: form.get("reason"),
    }), () => {
      toast.success("Equipo sacado de servicio.")
      changeOpen(false)
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={changeOpen}>
      {trigger !== null && (
        <DialogTrigger asChild>{trigger ?? <Button size="sm" variant="secondary">Sacar de servicio</Button>}</DialogTrigger>
      )}
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Sacar el equipo de servicio</DialogTitle>
            <DialogDescription>
              {subjectLabel ? `${subjectLabel} — ` : ""}{finding.description}
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo" hint="Mínimo 10 caracteres. Queda en el historial del equipo." error={operation.fieldError("reason")}>
            <Textarea name="reason" required minLength={10} maxLength={3000} />
          </Field>
          {operation.messageTone === "error" && operation.message && <Callout tone="danger" role="alert">{operation.message}</Callout>}
          <DialogFooter><Button type="submit" loading={operation.pending}>Confirmar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
