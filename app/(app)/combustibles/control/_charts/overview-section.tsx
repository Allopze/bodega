import type { ReactNode } from "react"

/**
 * Sección de una vista del control: un `<h2>` con la pregunta que contesta y,
 * a la derecha, las acciones propias de la sección (exportar). Sin tarjeta: la
 * jerarquía sale de la tipografía y de las reglas finas.
 */
export function ViewSection({ id, title, question, actions, children }: { id: string; title: string; question: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mb-10 scroll-mt-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-h2 text-[var(--color-text)]">{title}</h2>
          <p className="mt-0.5 max-w-[68ch] text-sub">{question}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** Aviso de un widget cuya consulta falló: nunca se deja un hueco vacío que parezca «sin datos». */
export function SectionError({ what }: { what: string }) {
  return (
    <div role="alert" className="rounded-[var(--radius-lg)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-4 py-6 text-sm text-[var(--color-danger-ink)]">
      <p className="font-semibold">No se pudo cargar {what}.</p>
      <p className="mt-1">Recarga la página; si el problema sigue, avisa a soporte. Los demás datos de la vista no se ven afectados.</p>
    </div>
  )
}
