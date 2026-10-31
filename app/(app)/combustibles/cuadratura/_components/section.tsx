import type { ReactNode } from "react"
import { Callout } from "@/components/ui/callout"

/** Bloque de una vista del control: `<h2>` + la pregunta que responde en una línea. */
export function ControlSection({ id, title, question, children, actions }: { id?: string; title: string; question: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section aria-labelledby={id ? `${id}-title` : undefined} className="mt-10 first:mt-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="text-lg font-semibold text-[var(--color-text)]">{title}</h2>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{question}</p>
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

/** Estado de error de un bloque cuya consulta falló: no se pinta como «sin datos». */
export function SectionError({ what }: { what: string }) {
  return (
    <Callout tone="danger" role="alert">
      {`No se pudo cargar ${what}. Recarga la página; si persiste, avisa a soporte. Los demás bloques siguen siendo válidos.`}
    </Callout>
  )
}
