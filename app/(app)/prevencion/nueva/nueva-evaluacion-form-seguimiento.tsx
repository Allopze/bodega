"use client"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/ui/field"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { MOTIVO_OPTIONS } from "./nueva-evaluacion-form.types"

interface SeguimientoSectionProps {
  motivo: string
  motivoOtro: string
  descripcionEvento: string
  equipoPatente: string
  errors: Record<string, string>
  motivoRef: React.RefObject<HTMLButtonElement | null>
  uid: string
  onMotivoChange: (v: string) => void
  onMotivoOtroChange: (v: string) => void
  onDescChange: (v: string) => void
  onPatenteChange: (v: string) => void
}

export function SeguimientoSection({
  motivo,
  motivoOtro,
  descripcionEvento,
  equipoPatente,
  errors,
  motivoRef,
  uid,
  onMotivoChange,
  onMotivoOtroChange,
  onDescChange,
  onPatenteChange,
}: SeguimientoSectionProps) {
  return (
    <>
      <Field
        label="Motivo del seguimiento"
        htmlFor={`${uid}-motivo`}
        required
        error={errors.motivo}
      >
        <Select value={motivo} onValueChange={onMotivoChange}>
          <SelectTrigger id={`${uid}-motivo`} ref={motivoRef} aria-invalid={!!errors.motivo}>
            <SelectValue placeholder="Selecciona motivo" />
          </SelectTrigger>
          <SelectContent>
            {MOTIVO_OPTIONS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {motivo === "otro" && (
        <Field
          label="Especifica el motivo"
          htmlFor={`${uid}-motivo-otro`}
        >
          <Input
            id={`${uid}-motivo-otro`}
            value={motivoOtro}
            onChange={(e) => onMotivoOtroChange(e.target.value)}
            placeholder="Describe el motivo…"
            maxLength={200}
          />
        </Field>
      )}

      <Field
        label="Descripción del evento"
        htmlFor={`${uid}-desc`}
        helper="Opcional: describe el evento que origina el seguimiento"
      >
        <Textarea
          id={`${uid}-desc`}
          value={descripcionEvento}
          onChange={(e) => onDescChange(e.target.value)}
          placeholder="Describe el evento que origina el seguimiento…"
          maxLength={500}
          rows={3}
        />
      </Field>

      <Field
        label="Patente del equipo"
        htmlFor={`${uid}-patente`}
        helper="Opcional: p. ej. ABCD12"
      >
        <Input
          id={`${uid}-patente`}
          value={equipoPatente}
          onChange={(e) => onPatenteChange(e.target.value)}
          placeholder="Ej. ABCD12"
          maxLength={20}
        />
      </Field>
    </>
  )
}
