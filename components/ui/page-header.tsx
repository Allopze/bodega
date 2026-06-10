import * as React from "react"
import Link from "next/link"
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
      <div className="flex min-h-[2rem] flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-h1 text-[var(--color-text)]">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 text-sub">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
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
}
