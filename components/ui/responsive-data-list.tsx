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
}: {
  title: React.ReactNode
  description?: React.ReactNode
  status?: React.ReactNode
  children?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <article
      className={cn(
        "rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-[var(--color-text)]">{title}</h3>
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
