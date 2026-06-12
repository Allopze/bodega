"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useShellHeader } from "@/components/layout/header-context"
import { cn } from "@/lib/utils"

interface PageHeaderProps {
  title:       string
  description?: string
  actions?:    React.ReactNode
  breadcrumb?: React.ReactNode
  className?:  string
  /** Optional eyebrow text rendered above the title (e.g., section number). */
  eyebrow?:    string
}

export function PageHeader({ title, description, actions, breadcrumb, className, eyebrow }: PageHeaderProps) {
  const pathname = usePathname()
  const { setHeader } = useShellHeader()

  React.useEffect(() => {
    setHeader({ title, description, breadcrumb })

    return () => {
      setHeader({})
    }
  }, [breadcrumb, description, pathname, setHeader, title])

  return (
    <div className={cn(actions ? "pb-2 mb-3" : "sr-only", className)}>
      <div className="flex min-h-[2rem] flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-eyebrow mb-1.5">{eyebrow}</p>
          )}
          <h1 className={cn("text-h1 text-[var(--color-text)]", actions && "sr-only")}>
            {title}
          </h1>
          {description && !actions && (
            <p className="mt-1.5 max-w-[68ch] text-sub">
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
}
