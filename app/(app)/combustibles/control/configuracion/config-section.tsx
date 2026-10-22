import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"

/**
 * Encabezado de una sección de la configuración: `<h2>`, descripción corta y la
 * acción de alta de ESA lista. No es una tarjeta: la separación es una regla fina.
 */
export function ConfigSection({ id, title, description, action, children }: {
  id: string
  title: string
  description: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="border-t border-[var(--color-border)] py-8 first:border-t-0 first:pt-2">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 id={`${id}-title`} className="text-h2 text-[var(--color-text)]">{title}</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? <Badge variant="success">Activo</Badge> : <Badge variant="neutral">Inactivo</Badge>
}
