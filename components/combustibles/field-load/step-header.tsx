import type * as React from "react"

/**
 * Cabecera de cada paso: «Paso N de M», la barra de avance y el título (que
 * recibe el foco al cambiar de paso). La usa el formulario por pasos y el paso
 * «Dónde» del registro autenticado, para que el avance se vea idéntico.
 */
export function StepHeader({
  position,
  total,
  title,
  headingRef,
}: {
  position: number
  total: number
  title: string
  headingRef?: React.Ref<HTMLHeadingElement>
}) {
  const progress = (position / total) * 100
  return (
    <div>
      <p className="text-base font-semibold text-[var(--color-text-muted)]" aria-live="polite">Paso {position} de {total}</p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]" role="progressbar" aria-label="Avance del formulario" aria-valuemin={1} aria-valuemax={total} aria-valuenow={position}>
        <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${progress}%` }} />
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="mt-3 text-2xl font-semibold outline-none">{title}</h2>
    </div>
  )
}
