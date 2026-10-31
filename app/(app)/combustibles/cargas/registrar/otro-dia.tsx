"use client"

import { CaretDown } from "@phosphor-icons/react"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { formatDate, cn } from "@/lib/utils"
import { MAX_PAST_LOAD_DAYS } from "@/lib/combustibles/field-load-rules"
import { PAST_LOAD_REASON_MAX, PAST_LOAD_REASON_MIN } from "@/lib/validation/fuel-tae"

/** Lo que la persona escribe en el bloque «¿Es una carga de otro día?». `open` = la carga es de otro día. */
export interface OtroDiaValue {
  open: boolean
  /** Hora de pared de Chile: `2026-10-12T14:30`. */
  loadedAt: string
  reason: string
}

export const EMPTY_OTRO_DIA: OtroDiaValue = { open: false, loadedAt: "", reason: "" }

/**
 * Bloque plegado del paso 1, visible sólo con `combustibles:register_past_load`
 * (la página decide si se pinta; el servidor vuelve a exigir el permiso).
 * Abrirlo es declarar que la carga ya se hizo: la fecha y la hora las pone la
 * persona, el motivo queda en la auditoría y las fotos pasan a ser opcionales.
 */
export function OtroDia({
  value,
  onChange,
  window: bounds,
  errors = {},
}: {
  value: OtroDiaValue
  onChange: (next: OtroDiaValue) => void
  /** Primer y último día en que se puede fechar la carga (días civiles de Chile). */
  window: { earliestDay: string; latestDay: string }
  errors?: { loadedAt?: string; reason?: string }
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      <button
        type="button"
        aria-expanded={value.open}
        aria-controls={value.open ? "registrar-otro-dia" : undefined}
        onClick={() => onChange({ ...value, open: !value.open })}
        className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-lg)] px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
      >
        <span className="min-w-0">
          <span className="block text-base font-semibold">¿Es una carga de otro día?</span>
          <span className="block text-sm text-[var(--color-text-muted)]">Solo si la carga ya se hizo y la registras después.</span>
        </span>
        <CaretDown size={20} aria-hidden="true" className={cn("shrink-0 transition-transform", value.open && "rotate-180")} />
      </button>
      {value.open && (
        <div id="registrar-otro-dia" className="space-y-4 border-t border-[var(--color-border)] px-4 py-4">
          <Field
            label="Fecha y hora de la carga"
            htmlFor="registrar-otro-dia-fecha-date"
            hint={`Hora de Chile. Hasta ${MAX_PAST_LOAD_DAYS} días atrás, desde el ${formatDate(bounds.earliestDay)}.`}
            error={errors.loadedAt}
          >
            <DateTimePicker
              id="registrar-otro-dia-fecha"
              value={value.loadedAt}
              onChange={(loadedAt) => onChange({ ...value, loadedAt })}
              min={`${bounds.earliestDay}T00:00`}
              max={`${bounds.latestDay}T23:59`}
              error={Boolean(errors.loadedAt)}
            />
          </Field>
          <Field
            label="Motivo"
            htmlFor="registrar-otro-dia-motivo"
            hint={`Cuenta por qué se registra después (al menos ${PAST_LOAD_REASON_MIN} caracteres). Queda en la auditoría.`}
            error={errors.reason}
          >
            <Textarea
              id="registrar-otro-dia-motivo"
              rows={3}
              maxLength={PAST_LOAD_REASON_MAX}
              value={value.reason}
              onChange={(event) => onChange({ ...value, reason: event.target.value })}
              error={Boolean(errors.reason)}
            />
          </Field>
          <p className="text-sm text-[var(--color-text-muted)]">
            Las fotos son opcionales. La carga queda con la fecha que indicas, por decidir en «Por revisar», y la plataforma anota además el día en que la ingresas.
          </p>
        </div>
      )}
    </div>
  )
}
