"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useShellHeader } from "@/components/layout/header-context"
import { cn } from "@/lib/utils"

export interface BreadcrumbItem {
  label: string
  href?: string
}

interface PageHeaderProps {
  title:       string
  description?: string
  actions?:    React.ReactNode
  headerActions?: React.ReactNode
  breadcrumb?: React.ReactNode | BreadcrumbItem[]
  className?:  string
  /** Optional eyebrow text rendered above the title (e.g., section number). */
  eyebrow?:    string
  /**
   * M-13: ruta de creación para el atajo `n`.
   *
   * Es explícito a propósito. Un `n` global que buscara "el botón primario" del
   * header sería una heurística peligrosa: en Aprobaciones habría disparado
   * "Aprobar todos". La página declara su destino o no hay atajo.
   */
  newShortcutHref?: string
}

export function PageHeader({ title, description, actions, headerActions, breadcrumb, className, eyebrow, newShortcutHref }: PageHeaderProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { setHeader } = useShellHeader()

  // M-13: `n` crea una entidad nueva. Mismas guardas que `/` en el TopBar — no
  // dispara si el foco está en un control ni con modificadores.
  React.useEffect(() => {
    const href = newShortcutHref
    if (!href) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "n" || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable) return
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      event.preventDefault()
      router.push(href)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [newShortcutHref, router])
  // `headerActions ?? actions` dejaba sin acción principal, en desktop, a toda
  // página que pasara AMBOS props: el shell mostraba sólo `headerActions` y la
  // copia local de `actions` es `lg:hidden`, así que el CTA no existía en
  // ninguna parte a ≥1024px. Afectaba a compras, bodega, solicitudes y tres
  // catálogos de admin (lo detectó admin-flow.spec.ts esperando 150s por un
  // botón "Nuevo proveedor" inexistente). Con ambos presentes van los dos, las
  // señales primero y el CTA al final, que es el orden del resto del header.
  const desktopActions = React.useMemo(
    () => (headerActions && actions
      ? <>{headerActions}{actions}</>
      : headerActions ?? actions),
    [headerActions, actions],
  )
  const breadcrumbNode = React.useMemo(
    () => Array.isArray(breadcrumb) ? <Breadcrumbs items={breadcrumb} /> : breadcrumb,
    [breadcrumb],
  )

  React.useEffect(() => {
    setHeader({ title, description, breadcrumb: breadcrumbNode, actions: desktopActions })

    return () => {
      setHeader({})
    }
  }, [breadcrumbNode, description, desktopActions, pathname, setHeader, title])

  return (
    <div className={cn("mb-3 pb-2 lg:sr-only", className)}>
      <div className="flex min-h-[2rem] flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-eyebrow mb-1.5">{eyebrow}</p>
          )}
          <h1 className="text-h1 text-[var(--color-text)] break-words">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-[68ch] text-sub">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 lg:hidden">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

interface BreadcrumbsProps {
  items:      BreadcrumbItem[]
  className?: string
}

const BreadcrumbsInner = React.memo(function BreadcrumbsInner({ items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Navegación estructural" className={cn("flex items-center gap-1.5", className)}>
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <span className="text-[var(--color-text-faint)] text-xs font-mono" aria-hidden>/</span>
          )}
          {item.href ? (
            <Link
              href={item.href}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors duration-[var(--duration-fast)]"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-xs text-[var(--color-text-subtle)]" aria-current={i === items.length - 1 ? "page" : undefined}>
              {item.label}
            </span>
          )}
        </React.Fragment>
      ))}
    </nav>
  )
})

export const Breadcrumbs = BreadcrumbsInner
