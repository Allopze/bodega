import type { ReactNode } from "react"

/**
 * Las dos columnas de «Por kilómetros» y «Por horas». Correctivo a la izquierda y Preventivo a la
 * derecha; bajo `xl` se apilan en el mismo orden. El encabezado es `h2` y cada bloque usa
 * `h3`, igual que el resto de los tableros.
 */
export function WorkControlTab({
  corrective,
  preventive,
  correctiveNote,
  preventiveNote,
}: {
  corrective: ReactNode
  preventive: ReactNode
  correctiveNote: string
  preventiveNote: string
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section aria-labelledby="correctivo-titulo" className="min-w-0">
        <div className="mb-3 border-b border-[var(--color-border)] pb-2">
          <h2 id="correctivo-titulo" className="text-h2 text-[var(--color-text)]">Correctivo</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{correctiveNote}</p>
        </div>
        {corrective}
      </section>
      <section aria-labelledby="preventivo-titulo" className="min-w-0">
        <div className="mb-3 border-b border-[var(--color-border)] pb-2">
          <h2 id="preventivo-titulo" className="text-h2 text-[var(--color-text)]">Preventivo</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{preventiveNote}</p>
        </div>
        {preventive}
      </section>
    </div>
  )
}
