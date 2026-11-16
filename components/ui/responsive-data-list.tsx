import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Contrato móvil para una fila de DataTable. La tabla conserva todas sus
 * columnas en escritorio; bajo `md` se muestran identidad, estado, los datos
 * que permiten decidir y una acción que se pueda pulsar sin precisión fina.
 */
export function ResponsiveDataListCard({
  title,
  description,
  status,
  children,
  actions,
  className,
  headingLevel = 3,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  status?: React.ReactNode
  children?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  /**
   * Nivel del título de la tarjeta. Por omisión `h3`, para una lista dentro de una sección con
   * su `h2`. Una lista que es el contenido principal de la página —directo bajo el `h1` de
   * `PageHeader`— pasa `2`: si no, la página salta de `h1` a `h3` (crítica 2026-11-15, paso 6).
   */
  headingLevel?: 2 | 3 | 4
}) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4"
  return (
    <article
      className={cn(
        "rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* `[&>a]:block [&>a]:truncate`: casi todas las listas pasan el título
              como `<Link>`. Inline dentro del `truncate`, su caja conservaba el
              ancho completo del texto: el recorte era sólo visual y el enlace
              medía más que el pozo (14 px en /prevencion/emergencias a 390). Como
              bloque, la caja del enlace es la del título y la elipsis cae en él. */}
          <Heading className="truncate text-sm font-medium text-[var(--color-text)] [&>a]:block [&>a]:truncate">{title}</Heading>
          {description && (
            <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{description}</div>
          )}
        </div>
        {status && <div className="shrink-0">{status}</div>}
      </div>

      {children && (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          {children}
        </dl>
      )}

      {actions && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
          {actions}
        </div>
      )}
    </article>
  )
}

export function ResponsiveDataListField({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[var(--color-text-subtle)]">{label}</dt>
      <dd className="mt-0.5 break-words text-[var(--color-text-muted)]">{children}</dd>
    </div>
  )
}
