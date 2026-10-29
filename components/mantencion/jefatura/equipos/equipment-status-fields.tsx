import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"

/**
 * Estado del equipo en la ficha: activo o dado de baja con su motivo. Dar de baja
 * saca al equipo de la app del mecánico; sus registros se conservan.
 */
export function EquipmentStatusFields({
  retired,
  reason,
  error,
  onChange,
}: {
  retired: boolean
  reason: string
  error?: string
  onChange: (patch: { retired?: boolean; retiredReason?: string }) => void
}) {
  return (
    <fieldset className="mt-6 border-t border-[var(--color-border)] pt-5">
      <legend className="mb-2 text-sm font-medium text-[var(--color-text)]">Estado del equipo</legend>
      <div className="flex flex-wrap gap-5">
        {[{ value: false, label: "Activo" }, { value: true, label: "Dado de baja" }].map((option) => (
          <label key={option.label} className="flex min-h-6 cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="status"
              value={option.value ? "baja" : "activo"}
              checked={retired === option.value}
              onChange={() => onChange({ retired: option.value })}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            {option.label}
          </label>
        ))}
      </div>
      {retired && (
        <Field label="Motivo de la baja" required htmlFor="eq-retiredReason" error={error} helper="El equipo deja de aparecer en la app del mecánico; sus registros se conservan." className="mt-3 max-w-xl">
          <Textarea id="eq-retiredReason" name="retiredReason" rows={2} value={reason} onChange={(event) => onChange({ retiredReason: event.target.value })} error={!!error} />
        </Field>
      )}
    </fieldset>
  )
}
