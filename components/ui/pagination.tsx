"use client"

import * as React from "react"
import { CaretLeft, CaretRight } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

interface PaginationProps {
  page:        number
  total:       number
  perPage:     number
  onPage:      (page: number) => void
  className?:  string
}

const PaginationInner = React.memo(function PaginationInner({ page, total, perPage, onPage, className }: PaginationProps) {
  const totalPages = Math.ceil(total / perPage)
  const from = (page - 1) * perPage + 1
  const to   = Math.min(page * perPage, total)

  const goPrev = React.useCallback(() => onPage(page - 1), [onPage, page])
  const goNext = React.useCallback(() => onPage(page + 1), [onPage, page])
  const goToPage = React.useCallback(
    (p: number) => () => onPage(p),
    [onPage],
  )

  const pageNums = React.useMemo(() => buildPageNums(page, totalPages), [page, totalPages])

  if (totalPages <= 1) return null

  return (
    // `flex-wrap`: salvaguarda. Con sólo tres controles bajo `sm` la fila cabe
    // en 320 px, pero un rango de cinco dígitos no debe volver a sacarla del pozo.
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 px-4 border-t border-[var(--color-border)]", className)}>
      <p className="text-xs text-[var(--color-text-subtle)]">
        <span className="font-mono tabular-nums">{from}</span>
        {" – "}
        <span className="font-mono tabular-nums">{to}</span>
        {" de "}
        <span className="font-mono tabular-nums">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <PageButton
          onClick={goPrev}
          disabled={page <= 1}
          aria-label="Página anterior"
        >
          <CaretLeft size={14} weight="bold" />
        </PageButton>
        {pageNums.map((p, i) =>
          p === "…" ? (
            <span key={`ellipsis-${i}`} className="hidden w-8 text-center text-xs text-[var(--color-text-subtle)] sm:inline">…</span>
          ) : (
            <PageButton
              key={p}
              onClick={goToPage(p as number)}
              active={p === page}
              hideOnMobile={p !== page}
              aria-label={`Ir a página ${p}`}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </PageButton>
          )
        )}
        <PageButton
          onClick={goNext}
          disabled={page >= totalPages}
          aria-label="Página siguiente"
        >
          <CaretRight size={14} weight="bold" />
        </PageButton>
      </div>
    </div>
  )
})

export const Pagination = PaginationInner

/**
 * Bajo `sm` cada control mide 44 × 44 px (WCAG 2.5.5, como `ServerPagination`
 * y los `icon-mobile`) y sólo se ven anterior, la actual y siguiente: siete
 * controles de 44 px no caben en 320 px. Desde `sm` vuelven los números a 28 px,
 * que sigue sobre el mínimo AA de 24 px (WCAG 2.5.8).
 */
function PageButton({
  children, active, disabled, onClick, hideOnMobile, ...rest
}: {
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  hideOnMobile?: boolean
  onClick?: () => void
  "aria-label"?: string
  "aria-current"?: "page" | undefined
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-11 min-w-11 sm:h-7 sm:min-w-7 items-center justify-center px-2 rounded-[var(--radius)] text-xs font-medium",
        hideOnMobile ? "hidden sm:inline-flex" : "inline-flex",
        // Emil: specify exact properties, not 'all'
        "transition-[color,background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "disabled:pointer-events-none disabled:opacity-35",
        // Emil: press feedback
        "",
        active
          ? "bg-[var(--color-primary)] text-white"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

function buildPageNums(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "…")[] = [1]
  if (current > 3) pages.push("…")
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i)
  }
  if (current < total - 2) pages.push("…")
  pages.push(total)
  return pages
}
