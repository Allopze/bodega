import Link from "next/link"
import { memo, type ReactNode } from "react"
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr"
import { buildPageWindow, type PaginationState } from "@/lib/pagination"
import { cn } from "@/lib/utils"

type ServerPaginationProps = {
  pagination: PaginationState
  hrefForPage: (page: number) => string
  className?: string
}

export const ServerPagination = memo(function ServerPagination({ pagination, hrefForPage, className }: ServerPaginationProps) {
  if (pagination.totalPages <= 1) return null

  return (
    <nav
      className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[var(--color-border)] px-4 py-3", className)}
      aria-label="Paginación"
    >
      <p className="text-xs text-[var(--color-text-subtle)]">
        <span className="font-mono tabular-nums">{pagination.from}</span>
        {" - "}
        <span className="font-mono tabular-nums">{pagination.to}</span>
        {" de "}
        <span className="font-mono tabular-nums">{pagination.totalItems}</span>
      </p>
      <div className="flex items-center gap-1">
        <PageLink
          href={hrefForPage(pagination.page - 1)}
          disabled={pagination.page <= 1}
          ariaLabel="Página anterior"
        >
          <CaretLeft size={14} weight="bold" />
        </PageLink>
        {buildPageWindow(pagination.page, pagination.totalPages).map((page, index) =>
          page === "…" ? (
            <span key={`ellipsis-${index}`} className="hidden w-8 text-center text-xs text-[var(--color-text-subtle)] sm:inline">...</span>
          ) : (
            <PageLink
              key={page}
              href={hrefForPage(page)}
              active={page === pagination.page}
              hideOnMobile={page !== pagination.page}
              ariaLabel={`Ir a página ${page}`}
            >
              {page}
            </PageLink>
          ),
        )}
        <PageLink
          href={hrefForPage(pagination.page + 1)}
          disabled={pagination.page >= pagination.totalPages}
          ariaLabel="Página siguiente"
        >
          <CaretRight size={14} weight="bold" />
        </PageLink>
      </div>
    </nav>
  )
})

/**
 * 44 × 44 px bajo `sm` (WCAG 2.5.5). Con ese tamaño la ventana completa —siete
 * enlaces más anterior/siguiente— medía unos 400 px y se salía 129 px del pozo
 * a 320 px: el pozo la recortaba y "Página siguiente" quedaba inalcanzable. Por
 * eso bajo `sm` sólo quedan anterior, la actual y siguiente (`hideOnMobile`).
 */
function PageLink({
  children,
  href,
  active,
  disabled,
  hideOnMobile,
  ariaLabel,
}: {
  children: ReactNode
  href: string
  active?: boolean
  disabled?: boolean
  hideOnMobile?: boolean
  ariaLabel: string
}) {
  const className = cn(
    "h-11 min-w-11 sm:h-7 sm:min-w-7 items-center justify-center rounded-[var(--radius)] px-2 text-xs font-medium",
    hideOnMobile ? "hidden sm:inline-flex" : "inline-flex",
    "transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
    "",
    disabled && "pointer-events-none opacity-35",
    active
      ? "bg-[var(--color-primary)] text-white"
      : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
  )

  if (disabled) {
    return (
      <span className={className} role="link" aria-label={ariaLabel} aria-disabled="true">
        {children}
      </span>
    )
  }

  return (
    <Link
      href={href}
      className={className}
      aria-label={ariaLabel}
      aria-current={active ? "page" : undefined}
      prefetch={false}
      scroll={false}
    >
      {children}
    </Link>
  )
}
