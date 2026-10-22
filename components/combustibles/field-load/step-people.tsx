"use client"

import { BigButton, BigField, BigInput } from "./big-controls"
import type { FieldIdentity } from "./use-field-identity"
import type { StepViewProps } from "./step-props"

function PersonBlock({
  title,
  rutLabel,
  nameLabel,
  inputId,
  identity,
  name,
  error,
  canVerify,
  onName,
}: {
  title: string
  rutLabel: string
  nameLabel: string
  inputId: string
  identity: FieldIdentity
  name: string
  error?: string
  canVerify: boolean
  onName: (value: string) => void
}) {
  return (
    <section className="space-y-3" aria-labelledby={`${inputId}-title`}>
      <h3 id={`${inputId}-title`} className="text-lg font-semibold">{title}</h3>
      {identity.matched ? (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border-2 border-[var(--color-success)] bg-[var(--color-success-tint)] px-4 py-3">
          <span className="text-lg font-semibold">Verificado: {identity.matched.name}</span>
          <button type="button" className="min-h-14 px-3 text-base font-semibold text-[var(--color-primary-ink)] underline" onClick={() => { identity.clear(); onName("") }}>Cambiar</button>
        </div>
      ) : (
        <>
          {canVerify && (
            <BigField id={`${inputId}-rut`} label={rutLabel} hint="Con guion, por ejemplo 12345678-9. Es lo más rápido.">
              <div className="flex gap-2">
                <BigInput id={`${inputId}-rut`} value={identity.rut} onChange={(event) => identity.setRut(event.target.value)} placeholder="12345678-9" autoComplete="off" />
                <BigButton type="button" variant="secondary" onClick={identity.verify} disabled={identity.verifying || !identity.rut}>{identity.verifying ? "Buscando…" : "Verificar"}</BigButton>
              </div>
            </BigField>
          )}
          <BigField id={inputId} label={canVerify ? "o escribe el nombre completo" : nameLabel} error={error}>
            <BigInput id={inputId} value={name} onChange={(event) => onName(event.target.value)} placeholder="Nombre completo" autoComplete="off" error={Boolean(error)} />
          </BigField>
        </>
      )}
    </section>
  )
}

/** Paso 5: quién condujo y quién supervisó. Con RUT verificado no hace falta escribir el nombre. */
export function StepPeople({ draft, errors, patch, driver, supervisor, canVerifyIdentity }: StepViewProps & { canVerifyIdentity: boolean }) {
  return (
    <div className="space-y-8">
      <PersonBlock title="Conductor u operador" rutLabel="RUT del conductor" nameLabel="Nombre completo del conductor" inputId="tae-driver" identity={driver} name={draft.driverName} error={errors.driverName} canVerify={canVerifyIdentity} onName={(value) => patch({ driverName: value })} />
      <PersonBlock title="Supervisor o líder" rutLabel="RUT del supervisor o líder" nameLabel="Nombre completo del supervisor o líder" inputId="tae-supervisor" identity={supervisor} name={draft.supervisorName} error={errors.supervisorName} canVerify={canVerifyIdentity} onName={(value) => patch({ supervisorName: value })} />
    </div>
  )
}
