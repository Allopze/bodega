import type { ReactNode } from "react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * Tarjeta de sección de las pantallas de jefatura: un título de nivel 2, una
 * bajada opcional y el contenido. Es el contenedor flotante de la regla 7 de
 * AGENTS.md (borde fino, radio 2xl, sombra suave) con el encabezado que
 * repetían el panel y el detalle.
 */
export function SectionCard({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <Card className={cn("p-5 shadow-xs", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h3 text-[var(--color-text)]">{title}</h2>
          {description && <p className="mt-0.5 text-sub">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  )
}
