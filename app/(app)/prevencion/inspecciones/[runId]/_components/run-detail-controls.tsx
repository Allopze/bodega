"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { remindInspectionReviewAction } from "../../actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import type { ItemInfo } from "./types"

/**
 * I-08: recordatorio manual para quien puede cerrar una inspección bloqueada.
 * `createNotifications` deduplica por día, así que el botón nunca satura —
 * clics repetidos el mismo día son inocuos.
 */
export function RemindReviewButton({ runId }: { runId: string }) {
  const operation = useOperation()
  return (
    <div className="mt-2 space-y-1">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={operation.pending}
        onClick={() => operation.run(
          () => remindInspectionReviewAction({ runId }),
          (result) => {
            const names = result.data?.notified
            if (Array.isArray(names) && names.length > 0) operation.setMessage(`Recordatorio enviado a ${names.join(", ")}.`)
          },
        )}
      >
        {operation.pending ? "Enviando…" : "Recordar a quien revisa"}
      </Button>
      <p className="text-xs text-[var(--color-text-subtle)]">Se envía como máximo un recordatorio al día.</p>
      {operation.message && <p role="status" className="text-xs">{operation.message}</p>}
    </div>
  )
}

/**
 * I-20: las 4 acciones destructivas del módulo (Cancelar, Detener, Cerrar,
 * Retirar) se veían como texto plano indistinguible de una acción neutra —
 * "ghost" a secas. Un ghost coloreado en rojo tenue es lo bastante discreto
 * para convivir con la acción primaria y lo bastante visible para no
 * confundirse con "Reabrir para rectificar", que no lo es.
 */
const GHOST_DANGER_CLASS = "text-[var(--color-danger-ink)] hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger-ink)]"

/**
 * Diálogo genérico de "acción con motivo obligatorio": cancelar, reabrir,
 * cerrar hallazgo. Las tres son la misma interacción, y el servicio exige el
 * mismo mínimo de 10 caracteres en todas.
 */
export function ReasonDialog({ trigger, title, description, action, onDone, variant = "ghost", confirmLabel }: {
  trigger: string
  title: string
  description: string
  action: (reason: string) => Promise<{ ok: boolean; message?: string; data?: Record<string, unknown> }>
  onDone?: (result: { data?: Record<string, unknown> }) => void
  variant?: "ghost" | "secondary" | "ghost-danger"
  confirmLabel?: string
}) {
  const [open, setOpen] = React.useState(false)
  const operation = useOperation()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant === "ghost-danger" ? "ghost" : variant} className={variant === "ghost-danger" ? GHOST_DANGER_CLASS : undefined}>{trigger}</Button>
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const reason = String(new FormData(event.currentTarget).get("reason") ?? "")
            operation.run(() => action(reason), (result) => {
              onDone?.(result)
              setOpen(false)
            })
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <Field label="Motivo" hint="Mínimo 10 caracteres.">
            <Textarea name="reason" required minLength={10} maxLength={3000} />
          </Field>
          {operation.message && <p role="status" className="text-sm">{operation.message}</p>}
          <DialogFooter><Button type="submit" disabled={operation.pending}>{confirmLabel ?? trigger}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Control de un ítem que no expresa conformidad (B-08).
 *
 * `observacion_planeada` es enteramente de este tipo —un relato libre— y por
 * eso ninguna observación podía completarse: el motor sólo sabía preguntar
 * "¿cumple?". `inspeccion_extintores` mezcla ambos (N° de serie, fecha de
 * vencimiento de carga, tipo).
 */
export function NonScorableField({ item, value, onChange }: {
  item: ItemInfo
  value: string
  onChange: (next: string) => void
}) {
  const label = `Respuesta de ${item.label}`
  if (item.kind === "textarea") {
    return (
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={item.placeholder ?? "Escribe aquí…"}
        aria-label={label}
        rows={4}
        maxLength={2000}
      />
    )
  }
  if (item.kind === "date") {
    return <DatePicker value={value} onChange={onChange} ariaLabel={label} />
  }
  if (item.kind === "number") {
    return (
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={item.placeholder ?? "Sin separador de miles"}
        aria-label={label}
      />
    )
  }
  if (item.kind === "select" && item.options?.length) {
    return (
      <Select value={value || "__unset__"} onValueChange={(next) => onChange(next === "__unset__" ? "" : next)}>
        <SelectTrigger aria-label={label}><SelectValue placeholder="Sin responder" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__unset__">Sin responder</SelectItem>
          {item.options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    )
  }
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={item.placeholder ?? "Escribe aquí…"}
      aria-label={label}
      maxLength={2000}
    />
  )
}
