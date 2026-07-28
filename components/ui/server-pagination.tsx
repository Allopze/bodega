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
      className={cn("flex items-center justify-between gap-4 border-t border-[var(--color-border)] px-4 py-3", className)}
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
            <span key={`ellipsis-${index}`} className="w-8 text-center text-xs text-[var(--color-text-subtle)]">...</span>
          ) : (
            <PageLink
              key={page}
              href={hrefForPage(page)}
              active={page === pagination.page}
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

function PageLink({
  children,
  href,
  active,
  disabled,
  ariaLabel,
}: {
  children: ReactNode
  href: string
  active?: boolean
  disabled?: boolean
  ariaLabel: string
}) {
  const className = cn(
    "inline-flex h-11 min-w-11 sm:h-7 sm:min-w-7 items-center justify-center rounded-[var(--radius)] px-2 text-xs font-medium",
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
    >
      {children}
    </Link>
  )
}
