import * as React from "react"
import { cn } from "@/lib/utils"

interface PageHeaderProps {
  title:       string
  description?: string
  actions?:    React.ReactNode
  breadcrumb?: React.ReactNode
  className?:  string
}

export function PageHeader({ title, description, actions, breadcrumb, className }: PageHeaderProps) {
  return (
    <div className={cn("pb-4 mb-4 border-b border-[var(--color-border)]", className)}>
      {breadcrumb && (
        <div className="mb-2">{breadcrumb}</div>
      )}
      <div className="flex items-start justify-between gap-4 min-h-[2rem]">
        <div>
          <h1 className="font-display text-xl font-semibold text-[var(--color-text)] leading-tight">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Breadcrumbs ──────────────────────────────────────────────────────────── */
interface BreadcrumbItem {
  label: string
  href?: string
}

interface BreadcrumbsProps {
  items:      BreadcrumbItem[]
  className?: string
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Navegación estructural" className={cn("flex items-center gap-1", className)}>
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <span className="text-[var(--color-text-subtle)] text-xs" aria-hidden>/</span>
          )}
          {item.href ? (
            <a
              href={item.href}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors duration-[var(--duration-fast)]"
            >
              {item.label}
            </a>
          ) : (
            <span className="text-xs text-[var(--color-text-subtle)]" aria-current={i === items.length - 1 ? "page" : undefined}>
              {item.label}
            </span>
          )}
        </React.Fragment>
      ))}
    </nav>
  )
}
