"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { remindInspectionReviewAction } from "../../actions"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
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
        loading={operation.pending}
        onClick={() => operation.run(
          () => remindInspectionReviewAction({ runId }),
          (result) => {
            const names = result.data?.notified
            toast.success(Array.isArray(names) && names.length > 0 ? `Recordatorio enviado a ${names.join(", ")}.` : "Recordatorio enviado.")
          },
        )}
      >
        {operation.pending ? "Enviando…" : "Recordar a quien revisa"}
      </Button>
      <p className="text-xs text-[var(--color-text-subtle)]">Se envía como máximo un recordatorio al día.</p>
      {operation.messageTone === "error" && operation.message && <p role="alert" className="text-xs text-[var(--color-danger-ink)]">{operation.message}</p>}
    </div>
  )
}

/**
 * Diálogo genérico de "acción con motivo obligatorio": cancelar, reabrir,
 * cerrar hallazgo. Las tres son la misma interacción, y el servicio exige el
 * mismo mínimo de 10 caracteres en todas.
 *
 * Se arma sobre `ConfirmDialog` y no con un formulario propio (P2-4): el botón
 * que confirma una cancelación se llamaba «Cancelar» y el que la descartaba
 * «Cerrar». Ahora confirmar repite la acción del disparador y descartar es
 * «Volver». I-20: la acción destructiva se pinta con `ghost-danger` —lo bastante
 * discreta para convivir con la primaria y lo bastante visible para no
 * confundirse con «Reabrir para rectificar», que no lo es—.
 */
export function ReasonDialog({
  trigger,
  title,
  description,
  action,
  onDone,
  variant = "ghost",
  confirmLabel,
  cancelLabel = "Volver",
  reasonLabel = "Motivo",
  confirmVariant,
  successMessage = "Cambio registrado.",
  open: controlledOpen,
  onOpenChange,
}: {
  /** Texto del botón que abre el diálogo. `null` no pinta ninguno (modo controlado). */
  trigger: string | null
  title: string
  description: string
  action: (reason: string) => Promise<{ ok: boolean; message?: string; data?: Record<string, unknown> }>
  onDone?: (result: { data?: Record<string, unknown> }) => void
  variant?: "ghost" | "secondary" | "ghost-danger"
  confirmLabel?: string
  cancelLabel?: string
  reasonLabel?: string
  /** Peso del botón que confirma. Por omisión sigue al disparador: `ghost-danger` confirma en rojo. */
  confirmVariant?: "destructive" | "warning" | "default"
  /** Aviso de éxito (toast); el diálogo se cierra, así que el resultado no puede quedarse dentro. */
  successMessage?: string
  /**
   * Modo controlado: quien lo monta decide cuándo está abierto, y lo monta una
   * sola vez para una lista entera (p. ej. «Cerrar hallazgo» de cada fila).
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [innerOpen, setInnerOpen] = React.useState(false)
  const open = controlledOpen ?? innerOpen
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInnerOpen(next)
    onOpenChange?.(next)
  }
  const operation = useOperation()

  return (
    <>
      {trigger !== null && (
        <Button
          type="button"
          size="sm"
          variant={variant}
          onClick={() => {
            // Un error de un intento anterior no debe esperar a quien vuelve a abrir.
            operation.setMessage("")
            setOpen(true)
          }}
        >
          {trigger}
        </Button>
      )}
      <ConfirmDialog
        open={open}
        // Mientras la acción corre no se cierra: sin saber si se aplicó, quien
        // desiste podría repetirla o darla por hecha.
        onOpenChange={(next) => { if (next || !operation.pending) setOpen(next) }}
        title={title}
        description={description}
        confirmLabel={confirmLabel ?? trigger ?? undefined}
        cancelLabel={cancelLabel}
        variant={confirmVariant ?? (variant === "ghost-danger" ? "destructive" : "default")}
        reasonLabel={reasonLabel}
        loading={operation.pending}
        error={operation.messageTone === "error" ? operation.message : undefined}
        onConfirm={(reason) => operation.run(() => action(reason), (result) => {
          onDone?.(result)
          toast.success(successMessage)
          setOpen(false)
        })}
      />
    </>
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
